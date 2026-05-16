import { Test } from '@nestjs/testing';
import { TicketPdfService } from './ticket-pdf.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePrisma() {
  return {
    order: { findUnique: jest.fn() },
  };
}

const mockStorage = { getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://cdn.example.com/cover.jpg') };

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
});
