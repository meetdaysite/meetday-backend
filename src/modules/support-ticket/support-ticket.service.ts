import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SupportTicketStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { ListSupportTicketsQueryDto } from './dto/list-support-tickets-query.dto';
import { AssignSupportTicketDto } from './dto/assign-support-ticket.dto';
import { ResolveSupportTicketDto } from './dto/resolve-support-ticket.dto';
import { EscalateTicketDto } from './dto/escalate-support-ticket.dto';

const ADMIN_ROLES = ['SUPER_ADMIN', 'CITY_ADMIN', 'SUPPORT'];

function generateTicketNumber(): string {
  const date = new Date();
  const ymd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const rand = Math.random().toString(36).toUpperCase().slice(2, 6);
  return `TKT-${ymd}-${rand}`;
}

const TICKET_SELECT = {
  id: true,
  ticketNumber: true,
  subject: true,
  body: true,
  category: true,
  priority: true,
  status: true,
  entityType: true,
  entityId: true,
  resolution: true,
  resolvedAt: true,
  createdAt: true,
  updatedAt: true,
  reporter: { select: { id: true, firstName: true, lastName: true, email: true } },
  assignee: { select: { id: true, firstName: true, lastName: true } },
  resolver: { select: { id: true, firstName: true, lastName: true } },
} as const;

@Injectable()
export class SupportTicketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(reporterId: string, reporterRole: string, dto: CreateSupportTicketDto) {
    const ticket = await this.prisma.supportTicket.create({
      data: {
        ticketNumber: generateTicketNumber(),
        reporterId,
        subject: dto.subject,
        body: dto.body,
        category: dto.category,
        priority: dto.priority,
        entityType: dto.entityType,
        entityId: dto.entityId,
      },
      select: TICKET_SELECT,
    });

    this.auditLog.log({
      actorId: reporterId,
      actorRole: reporterRole,
      action: 'SUPPORT_TICKET_CREATED',
      entityType: 'SUPPORT_TICKET',
      entityId: ticket.id,
      metadata: { ticketNumber: ticket.ticketNumber, category: ticket.category },
    });

    void this.notifications.create(
      reporterId,
      'support_ticket_received',
      'Support Ticket Received',
      `Your ticket ${ticket.ticketNumber} has been received. We'll get back to you shortly.`,
      { ticketId: ticket.id, ticketNumber: ticket.ticketNumber },
    );

    return ticket;
  }

  async listMine(reporterId: string, page: number, limit: number, status?: SupportTicketStatus) {
    const safeLimit = Math.min(limit, 100);
    const skip = (page - 1) * safeLimit;
    const where = { reporterId, ...(status ? { status } : {}) };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.supportTicket.count({ where }),
      this.prisma.supportTicket.findMany({
        where,
        select: TICKET_SELECT,
        orderBy: { createdAt: 'desc' },
        skip,
        take: safeLimit,
      }),
    ]);

    return { total, page, limit: safeLimit, items };
  }

  async getMyById(id: string, reporterId: string) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id, reporterId },
      select: TICKET_SELECT,
    });
    if (!ticket) throw new NotFoundException('Support ticket not found');
    return ticket;
  }

  async list(query: ListSupportTicketsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Parameters<typeof this.prisma.supportTicket.findMany>[0]['where'] = {};
    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.category) where.category = query.category;
    if (query.assignedTo) where.assignedTo = query.assignedTo;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.supportTicket.count({ where }),
      this.prisma.supportTicket.findMany({
        where,
        select: TICKET_SELECT,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
    ]);

    return { total, page, limit, items };
  }

  async getById(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      select: TICKET_SELECT,
    });
    if (!ticket) throw new NotFoundException('Support ticket not found');
    return ticket;
  }

  async assign(id: string, adminId: string, dto: AssignSupportTicketDto) {
    const targetAdmin = await this.prisma.user.findUnique({
      where: { id: dto.adminUserId },
      include: { role: true },
    });
    if (!targetAdmin || !ADMIN_ROLES.includes(targetAdmin.role.name)) {
      throw new BadRequestException('Assigned user is not a support admin');
    }

    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      select: { id: true, status: true, ticketNumber: true, subject: true, reporterId: true },
    });
    if (!ticket) throw new NotFoundException('Support ticket not found');
    if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') {
      throw new BadRequestException('Cannot assign a resolved or closed ticket');
    }

    const updated = await this.prisma.supportTicket.update({
      where: { id },
      data: { assignedTo: dto.adminUserId, status: 'IN_PROGRESS' },
      select: TICKET_SELECT,
    });

    this.auditLog.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'SUPPORT_TICKET_ASSIGNED',
      entityType: 'SUPPORT_TICKET',
      entityId: id,
      metadata: { assignedTo: dto.adminUserId },
    });

    void this.notifications.create(
      ticket.reporterId,
      'support_ticket_in_progress',
      'Support Is On It',
      `Your ticket ${ticket.ticketNumber} is now being reviewed by our support team.`,
      { ticketId: ticket.id, ticketNumber: ticket.ticketNumber },
    );

    void this.notifications.create(
      dto.adminUserId,
      'support_ticket_assigned_to_you',
      'Ticket Assigned to You',
      `You have been assigned ticket ${ticket.ticketNumber}: "${ticket.subject}".`,
      { ticketId: ticket.id, ticketNumber: ticket.ticketNumber },
    );

    return updated;
  }

  async resolve(id: string, adminId: string, dto: ResolveSupportTicketDto) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      select: { id: true, status: true, ticketNumber: true, reporterId: true },
    });
    if (!ticket) throw new NotFoundException('Support ticket not found');
    if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') {
      throw new BadRequestException('Ticket is already resolved or closed');
    }

    const updated = await this.prisma.supportTicket.update({
      where: { id },
      data: { status: 'RESOLVED', resolvedBy: adminId, resolvedAt: new Date(), resolution: dto.resolution },
      select: TICKET_SELECT,
    });

    this.auditLog.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'SUPPORT_TICKET_RESOLVED',
      entityType: 'SUPPORT_TICKET',
      entityId: id,
    });

    void this.notifications.create(
      ticket.reporterId,
      'support_ticket_resolved',
      'Your Ticket Has Been Resolved',
      `Ticket ${ticket.ticketNumber} has been resolved. Tap to view the resolution.`,
      { ticketId: ticket.id, ticketNumber: ticket.ticketNumber, resolution: dto.resolution },
    );

    return updated;
  }

  async close(id: string, adminId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      select: { id: true, status: true, ticketNumber: true, reporterId: true },
    });
    if (!ticket) throw new NotFoundException('Support ticket not found');
    if (ticket.status === 'CLOSED') throw new BadRequestException('Ticket is already closed');

    const updated = await this.prisma.supportTicket.update({
      where: { id },
      data: { status: 'CLOSED' },
      select: TICKET_SELECT,
    });

    this.auditLog.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'SUPPORT_TICKET_CLOSED',
      entityType: 'SUPPORT_TICKET',
      entityId: id,
    });

    void this.notifications.create(
      ticket.reporterId,
      'support_ticket_closed',
      'Support Ticket Closed',
      `Your ticket ${ticket.ticketNumber} has been closed.`,
      { ticketId: ticket.id, ticketNumber: ticket.ticketNumber },
    );

    return updated;
  }

  async escalate(id: string, adminId: string, dto: EscalateTicketDto) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      select: { id: true, status: true, ticketNumber: true, priority: true },
    });
    if (!ticket) throw new NotFoundException('Support ticket not found');
    if (ticket.status === 'CLOSED') {
      throw new BadRequestException('Cannot change the priority of a closed ticket');
    }
    if (ticket.priority === dto.priority) {
      throw new BadRequestException(`Ticket is already at ${dto.priority} priority`);
    }

    const updated = await this.prisma.supportTicket.update({
      where: { id },
      data: { priority: dto.priority },
      select: TICKET_SELECT,
    });

    this.auditLog.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'SUPPORT_TICKET_PRIORITY_CHANGED',
      entityType: 'SUPPORT_TICKET',
      entityId: id,
      metadata: { from: ticket.priority, to: dto.priority },
    });

    return updated;
  }
}
