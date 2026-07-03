import { Test } from '@nestjs/testing';
import { TicketPdfService } from './ticket-pdf.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { renderHtmlsToPdfs } from './pdf-render.util';

// Mock only the Chromium render calls; keep escapeHtml (used by buildTicketHtml) real.
jest.mock('./pdf-render.util', () => {
  const actual = jest.requireActual('./pdf-render.util');
  return {
    ...actual,
    renderHtmlToPdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
    renderHtmlsToPdfs: jest.fn((htmls: string[]) =>
      Promise.resolve(htmls.map((_, i) => Buffer.from(`pdf-${i}`))),
    ),
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePrisma() {
  return {
    order: { findUnique: jest.fn(), update: jest.fn() },
  };
}

const mockStorage = {
  getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://cdn.example.com/cover.jpg'),
  uploadBuffer: jest.fn().mockResolvedValue(undefined),
};

// ── Fixtures ──────────────────────────────────────────────────────────────────

const orderId = 'order-uuid';

// ── Test suite ────────────────────────────────────────────────────────────────

describe('TicketPdfService', () => {
  let service: TicketPdfService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();

    const module = await Test.createTestingModule({
      providers: [
        TicketPdfService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: mockStorage },
      ],
    }).compile();

    service = module.get(TicketPdfService);
    jest.clearAllMocks();
  });

  // ── getOrderSummary ───────────────────────────────────────────────────────

  describe('getOrderSummary()', () => {
    it('returns email and eventTitle when user has an email', async () => {
      prisma.order.findUnique.mockResolvedValue({
        user: { email: 'riya@example.com' },
        event: { title: 'Indie Night' },
      });

      const result = await service.getOrderSummary(orderId);
      expect(result).toEqual({ email: 'riya@example.com', eventTitle: 'Indie Night' });
    });

    it('returns null email when user has no email (phone-only signup)', async () => {
      prisma.order.findUnique.mockResolvedValue({
        user: { email: null },
        event: { title: 'Indie Night' },
      });

      const result = await service.getOrderSummary(orderId);
      expect(result.email).toBeNull();
    });

    it('throws when order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(service.getOrderSummary(orderId)).rejects.toThrow(`Order ${orderId} not found`);
    });
  });

  // ── persistForOrder ───────────────────────────────────────────────────────

  describe('persistForOrder()', () => {
    it('uploads the rendered PDF to a deterministic key and records it on the order', async () => {
      const buffer = Buffer.from('pdf-bytes');
      jest.spyOn(service, 'generateForOrder').mockResolvedValue(buffer);

      const result = await service.persistForOrder(orderId);

      const expectedKey = `orders/${orderId}/ticket.pdf`;
      expect(mockStorage.uploadBuffer).toHaveBeenCalledWith(expectedKey, buffer, 'application/pdf');
      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: orderId },
        data: { ticketPdfKey: expectedKey },
      });
      expect(result).toEqual({ key: expectedKey, buffer });
    });
  });

  // ── getDownloadUrl ────────────────────────────────────────────────────────

  describe('getDownloadUrl()', () => {
    it('presigns the existing key without regenerating', async () => {
      prisma.order.findUnique.mockResolvedValue({ ticketPdfKey: 'orders/x/ticket.pdf' });
      mockStorage.getPresignedDownloadUrl.mockResolvedValue('https://cdn.example.com/ticket.pdf');
      const persistSpy = jest.spyOn(service, 'persistForOrder');

      const url = await service.getDownloadUrl(orderId);

      expect(persistSpy).not.toHaveBeenCalled();
      expect(mockStorage.getPresignedDownloadUrl).toHaveBeenCalledWith('orders/x/ticket.pdf');
      expect(url).toBe('https://cdn.example.com/ticket.pdf');
    });

    it('lazily persists then presigns when no key exists yet', async () => {
      prisma.order.findUnique.mockResolvedValue({ ticketPdfKey: null });
      const lazyKey = `orders/${orderId}/ticket.pdf`;
      jest.spyOn(service, 'persistForOrder').mockResolvedValue({ key: lazyKey, buffer: Buffer.from('x') });
      mockStorage.getPresignedDownloadUrl.mockResolvedValue('https://cdn.example.com/ticket.pdf');

      const url = await service.getDownloadUrl(orderId);

      expect(service.persistForOrder).toHaveBeenCalledWith(orderId);
      expect(mockStorage.getPresignedDownloadUrl).toHaveBeenCalledWith(lazyKey);
      expect(url).toBe('https://cdn.example.com/ticket.pdf');
    });

    it('throws when order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(service.getDownloadUrl(orderId)).rejects.toThrow(`Order ${orderId} not found`);
    });
  });

  // ── generateRecipientTickets ──────────────────────────────────────────────

  // Order with a booker (lead) + attendees A, B (valid emails) + C (no email),
  // all on one item. `bookerEmail` is provided by the mock.
  function orderWith(bookerEmail: string | null) {
    return {
      bookingId: 'MDAY-48FE-024C',
      user: { email: bookerEmail },
      event: {
        title: 'Indie Night',
        eventDate: null,
        startTime: null,
        venueName: null,
        city: null,
        category: null,
        media: [],
      },
      items: [
        {
          ticket: { name: 'GA' },
          attendees: [
            { fullName: 'Booker', email: bookerEmail, isLead: true, ticketCode: 't0' },
            { fullName: 'Attendee A', email: 'a@x.com', isLead: false, ticketCode: 't1' },
            { fullName: 'Attendee B', email: 'b@x.com', isLead: false, ticketCode: 't2' },
            { fullName: 'Attendee C', email: '', isLead: false, ticketCode: 't3' },
          ],
        },
      ],
    };
  }

  describe('generateRecipientTickets()', () => {
    it('emails each attendee their own ticket and folds no-email attendees into the booker', async () => {
      prisma.order.findUnique.mockResolvedValue(orderWith('booker@x.com'));

      const { eventTitle, recipients } = await service.generateRecipientTickets(orderId);

      expect(eventTitle).toBe('Indie Night');
      // Booker bucket (booker + C folded in) + A + B = 3 recipients.
      expect(recipients).toHaveLength(3);

      const booker = recipients.find((r) => r.isBooker);
      expect(booker?.email).toBe('booker@x.com');
      expect(recipients.filter((r) => !r.isBooker).map((r) => r.email).sort()).toEqual([
        'a@x.com',
        'b@x.com',
      ]);
      // One PDF per recipient, rendered in a single batch.
      expect(recipients.every((r) => Buffer.isBuffer(r.buffer))).toBe(true);
      expect(renderHtmlsToPdfs).toHaveBeenCalledTimes(1);
      expect((renderHtmlsToPdfs as jest.Mock).mock.calls[0][0]).toHaveLength(3);
    });

    it('drops the booker bucket when the booker has no email, still emailing valid attendees', async () => {
      prisma.order.findUnique.mockResolvedValue(orderWith(null));

      const { recipients } = await service.generateRecipientTickets(orderId);

      // No booker email → booker + C (no email) are unreachable; only A and B remain.
      expect(recipients).toHaveLength(2);
      expect(recipients.every((r) => !r.isBooker)).toBe(true);
      expect(recipients.map((r) => r.email).sort()).toEqual(['a@x.com', 'b@x.com']);
    });
  });
});
