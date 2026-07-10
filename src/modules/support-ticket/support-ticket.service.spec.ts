import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SupportTicketService } from './support-ticket.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePrisma() {
  const prisma: any = {
    supportTicket: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    user: { findUnique: jest.fn() },
  };
  prisma.$transaction = jest.fn().mockImplementation(async (ops: any[]) => Promise.all(ops));
  return prisma;
}

const mockAuditLog = { log: jest.fn() };
const mockNotifications = { create: jest.fn().mockResolvedValue(undefined) };

// ── Fixtures ─────────────────────────────────────────────────────────────────

const reporterId = 'user-uuid';
const adminId = 'admin-uuid';
const ticketId = 'ticket-uuid';

function makeTicket(overrides: Partial<any> = {}) {
  return {
    id: ticketId,
    ticketNumber: 'TKT-20260702-ABCD',
    subject: 'Test issue',
    body: 'Detailed description',
    category: 'PAYMENT',
    priority: 'MEDIUM',
    status: 'OPEN',
    entityType: null,
    entityId: null,
    resolution: null,
    resolvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    reporterId,
    reporter: { id: reporterId, firstName: 'Alice', lastName: 'Smith', email: 'alice@test.com' },
    assignee: null,
    resolver: null,
    ...overrides,
  };
}

const createDto = {
  subject: 'Test issue',
  body: 'Detailed description',
  category: 'PAYMENT' as any,
  priority: 'MEDIUM' as any,
  entityType: undefined,
  entityId: undefined,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SupportTicketService', () => {
  let service: SupportTicketService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    prisma = makePrisma();
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        SupportTicketService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: mockAuditLog },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get(SupportTicketService);
  });

  describe('create', () => {
    it('creates a ticket with a generated ticket number', async () => {
      const ticket = makeTicket();
      prisma.supportTicket.create.mockResolvedValue(ticket);

      const result = await service.create(reporterId, 'USER', createDto);

      expect(prisma.supportTicket.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reporterId,
            subject: createDto.subject,
            category: createDto.category,
          }),
        }),
      );
      expect(result.id).toBe(ticketId);
    });

    it('logs an audit event after creation', async () => {
      prisma.supportTicket.create.mockResolvedValue(makeTicket());

      await service.create(reporterId, 'USER', createDto);

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SUPPORT_TICKET_CREATED', entityId: ticketId }),
      );
    });

    it('fires-and-forgets a confirmation notification', async () => {
      prisma.supportTicket.create.mockResolvedValue(makeTicket());

      await service.create(reporterId, 'USER', createDto);

      // Notification is void (fire-and-forget), but create should have been called
      expect(mockNotifications.create).toHaveBeenCalledWith(
        reporterId,
        'support_ticket_received',
        expect.any(String),
        expect.stringContaining('TKT-'),
        expect.any(Object),
      );
    });
  });

  describe('listMine', () => {
    it('returns paginated tickets for the reporter', async () => {
      prisma.$transaction.mockResolvedValue([1, [makeTicket()]]);

      const result = await service.listMine(reporterId, 1, 20);

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
    });

    it('caps limit at 100', async () => {
      prisma.$transaction.mockResolvedValue([0, []]);

      await service.listMine(reporterId, 1, 500);

      const findManyArgs = prisma.$transaction.mock.calls[0][0];
      // The mocked $transaction receives an array of promises — we can't directly check take here
      // Instead verify the limit in the returned result
      const result = await service.listMine(reporterId, 1, 500);
      expect(result.limit).toBe(100);
    });
  });

  describe('getMyById', () => {
    it('throws NotFoundException when ticket is not found for reporter', async () => {
      prisma.supportTicket.findFirst.mockResolvedValue(null);
      await expect(service.getMyById(ticketId, reporterId)).rejects.toThrow(NotFoundException);
    });

    it('returns ticket when found', async () => {
      prisma.supportTicket.findFirst.mockResolvedValue(makeTicket());
      const result = await service.getMyById(ticketId, reporterId);
      expect(result.id).toBe(ticketId);
    });
  });

  describe('getById', () => {
    it('throws NotFoundException when ticket does not exist', async () => {
      prisma.supportTicket.findUnique.mockResolvedValue(null);
      await expect(service.getById(ticketId)).rejects.toThrow(NotFoundException);
    });

    it('returns the ticket when found', async () => {
      prisma.supportTicket.findUnique.mockResolvedValue(makeTicket());
      const result = await service.getById(ticketId);
      expect(result.id).toBe(ticketId);
    });
  });

  describe('assign', () => {
    const assignDto = { adminUserId: adminId };

    it('throws BadRequestException when assignee is not an admin', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: adminId, role: { name: 'USER' } });
      await expect(service.assign(ticketId, adminId, assignDto)).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when ticket does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: adminId, role: { name: 'SUPPORT' } });
      prisma.supportTicket.findUnique.mockResolvedValue(null);
      await expect(service.assign(ticketId, adminId, assignDto)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when ticket is already RESOLVED', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: adminId, role: { name: 'SUPPORT' } });
      prisma.supportTicket.findUnique.mockResolvedValue(makeTicket({ status: 'RESOLVED' }));
      await expect(service.assign(ticketId, adminId, assignDto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when ticket is CLOSED', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: adminId, role: { name: 'SUPPORT' } });
      prisma.supportTicket.findUnique.mockResolvedValue(makeTicket({ status: 'CLOSED' }));
      await expect(service.assign(ticketId, adminId, assignDto)).rejects.toThrow(BadRequestException);
    });

    it('assigns ticket and sends two notifications on success', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: adminId, role: { name: 'SUPPORT' } });
      prisma.supportTicket.findUnique.mockResolvedValue(makeTicket());
      prisma.supportTicket.update.mockResolvedValue(makeTicket({ status: 'IN_PROGRESS', assignedTo: adminId }));

      await service.assign(ticketId, adminId, assignDto);

      expect(prisma.supportTicket.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'IN_PROGRESS', assignedTo: adminId }) }),
      );
      expect(mockNotifications.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('resolve', () => {
    const resolveDto = { resolution: 'Issue fixed by updating payment settings.' };

    it('throws NotFoundException when ticket does not exist', async () => {
      prisma.supportTicket.findUnique.mockResolvedValue(null);
      await expect(service.resolve(ticketId, adminId, resolveDto)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when ticket is already RESOLVED', async () => {
      prisma.supportTicket.findUnique.mockResolvedValue(makeTicket({ status: 'RESOLVED' }));
      await expect(service.resolve(ticketId, adminId, resolveDto)).rejects.toThrow(BadRequestException);
    });

    it('resolves the ticket and notifies reporter', async () => {
      prisma.supportTicket.findUnique.mockResolvedValue(makeTicket());
      prisma.supportTicket.update.mockResolvedValue(makeTicket({ status: 'RESOLVED' }));

      await service.resolve(ticketId, adminId, resolveDto);

      expect(prisma.supportTicket.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'RESOLVED', resolution: resolveDto.resolution }) }),
      );
      expect(mockNotifications.create).toHaveBeenCalledWith(
        reporterId,
        'support_ticket_resolved',
        expect.any(String),
        expect.any(String),
        expect.any(Object),
      );
    });
  });

  describe('close', () => {
    it('throws NotFoundException when ticket does not exist', async () => {
      prisma.supportTicket.findUnique.mockResolvedValue(null);
      await expect(service.close(ticketId, adminId)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when ticket is already CLOSED', async () => {
      prisma.supportTicket.findUnique.mockResolvedValue(makeTicket({ status: 'CLOSED' }));
      await expect(service.close(ticketId, adminId)).rejects.toThrow(BadRequestException);
    });

    it('closes the ticket and notifies the reporter', async () => {
      prisma.supportTicket.findUnique.mockResolvedValue(makeTicket({ status: 'RESOLVED' }));
      prisma.supportTicket.update.mockResolvedValue(makeTicket({ status: 'CLOSED' }));

      await service.close(ticketId, adminId);

      expect(prisma.supportTicket.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'CLOSED' } }),
      );
      expect(mockNotifications.create).toHaveBeenCalled();
    });
  });

  describe('escalate', () => {
    it('throws NotFoundException when ticket does not exist', async () => {
      prisma.supportTicket.findUnique.mockResolvedValue(null);
      await expect(service.escalate(ticketId, adminId, { priority: 'HIGH' as any })).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when ticket is CLOSED', async () => {
      prisma.supportTicket.findUnique.mockResolvedValue(makeTicket({ status: 'CLOSED' }));
      await expect(service.escalate(ticketId, adminId, { priority: 'HIGH' as any })).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when priority is the same', async () => {
      prisma.supportTicket.findUnique.mockResolvedValue(makeTicket({ priority: 'MEDIUM' }));
      await expect(service.escalate(ticketId, adminId, { priority: 'MEDIUM' as any })).rejects.toThrow(BadRequestException);
    });

    it('updates the ticket priority and logs audit', async () => {
      prisma.supportTicket.findUnique.mockResolvedValue(makeTicket({ priority: 'MEDIUM' }));
      prisma.supportTicket.update.mockResolvedValue(makeTicket({ priority: 'HIGH' }));

      await service.escalate(ticketId, adminId, { priority: 'HIGH' as any });

      expect(prisma.supportTicket.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { priority: 'HIGH' } }),
      );
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SUPPORT_TICKET_PRIORITY_CHANGED' }),
      );
    });
  });
});
