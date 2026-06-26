import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { ListSupportTicketsQueryDto } from './dto/list-support-tickets-query.dto';
import { AssignSupportTicketDto } from './dto/assign-support-ticket.dto';
import { ResolveSupportTicketDto } from './dto/resolve-support-ticket.dto';

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
  ) {}

  async create(reporterId: string, dto: CreateSupportTicketDto) {
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
      actorRole: 'ATTENDEE',
      action: 'SUPPORT_TICKET_CREATED',
      entityType: 'SUPPORT_TICKET',
      entityId: ticket.id,
      metadata: { ticketNumber: ticket.ticketNumber, category: ticket.category },
    });

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
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id }, select: { id: true, status: true } });
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

    return updated;
  }

  async resolve(id: string, adminId: string, dto: ResolveSupportTicketDto) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id }, select: { id: true, status: true } });
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

    return updated;
  }

  async close(id: string, adminId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id }, select: { id: true, status: true } });
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

    return updated;
  }
}
