import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { InvoicePdfService } from './invoice-pdf.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePrisma() {
  return {
    order: { findUnique: jest.fn(), update: jest.fn() },
    platformConfig: { findUnique: jest.fn().mockResolvedValue({ value: '0.18' }) },
  };
}

const mockStorage = {
  getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://cdn.example.com/invoice.pdf'),
  uploadBuffer: jest.fn().mockResolvedValue(undefined),
};

const mockConfig = { get: jest.fn().mockReturnValue('') };

// ── Fixtures ──────────────────────────────────────────────────────────────────

const orderId = 'order-uuid';

// ── Test suite ────────────────────────────────────────────────────────────────

describe('InvoicePdfService', () => {
  let service: InvoicePdfService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();

    const module = await Test.createTestingModule({
      providers: [
        InvoicePdfService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: mockStorage },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get(InvoicePdfService);
    jest.clearAllMocks();
  });

  // ── persistForOrder ───────────────────────────────────────────────────────

  describe('persistForOrder()', () => {
    it('uploads the rendered invoice to a deterministic key and records it on the order', async () => {
      const buffer = Buffer.from('invoice-bytes');
      jest.spyOn(service, 'generateForOrder').mockResolvedValue(buffer);

      const result = await service.persistForOrder(orderId);

      const expectedKey = `orders/${orderId}/invoice.pdf`;
      expect(mockStorage.uploadBuffer).toHaveBeenCalledWith(expectedKey, buffer, 'application/pdf');
      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: orderId },
        data: { invoicePdfKey: expectedKey },
      });
      expect(result).toEqual({ key: expectedKey, buffer });
    });
  });

  // ── getDownloadUrl ────────────────────────────────────────────────────────

  describe('getDownloadUrl()', () => {
    it('presigns the existing key without regenerating', async () => {
      prisma.order.findUnique.mockResolvedValue({ invoicePdfKey: 'orders/x/invoice.pdf' });
      const persistSpy = jest.spyOn(service, 'persistForOrder');

      const url = await service.getDownloadUrl(orderId);

      expect(persistSpy).not.toHaveBeenCalled();
      expect(mockStorage.getPresignedDownloadUrl).toHaveBeenCalledWith('orders/x/invoice.pdf');
      expect(url).toBe('https://cdn.example.com/invoice.pdf');
    });

    it('lazily persists then presigns when no key exists yet', async () => {
      prisma.order.findUnique.mockResolvedValue({ invoicePdfKey: null });
      const lazyKey = `orders/${orderId}/invoice.pdf`;
      jest.spyOn(service, 'persistForOrder').mockResolvedValue({ key: lazyKey, buffer: Buffer.from('x') });

      const url = await service.getDownloadUrl(orderId);

      expect(service.persistForOrder).toHaveBeenCalledWith(orderId);
      expect(mockStorage.getPresignedDownloadUrl).toHaveBeenCalledWith(lazyKey);
      expect(url).toBe('https://cdn.example.com/invoice.pdf');
    });

    it('throws when order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(service.getDownloadUrl(orderId)).rejects.toThrow(`Order ${orderId} not found`);
    });
  });
});
