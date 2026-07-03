import { Test } from '@nestjs/testing';
import { TicketPdfService } from './ticket-pdf.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';

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
});
