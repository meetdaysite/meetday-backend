import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';

export interface AuditLogParams {
  actorId?: string;
  actorRole?: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  log(params: AuditLogParams): void {
    this.prisma.auditLog
      .create({
        data: {
          actorId: params.actorId ?? null,
          actorRole: params.actorRole ?? null,
          action: params.action,
          entityType: params.entityType,
          entityId: params.entityId,
          ipAddress: params.ipAddress ?? null,
          userAgent: params.userAgent ?? null,
          metadata: params.metadata ? (params.metadata as Prisma.InputJsonValue) : undefined,
        },
      })
      .catch((err) => {
        this.logger.error('Failed to write audit log', err);
      });
  }

  async queryLogs(filters: QueryAuditLogDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 50;
    const skip = (page - 1) * limit;

    const where: Parameters<typeof this.prisma.auditLog.findMany>[0]['where'] = {};

    if (filters.actorId) where.actorId = filters.actorId;
    if (filters.entityType) where.entityType = filters.entityType;
    if (filters.entityId) where.entityId = filters.entityId;
    if (filters.action) where.action = filters.action;
    if (filters.from || filters.to) {
      where.createdAt = {};
      if (filters.from) where.createdAt.gte = new Date(filters.from);
      if (filters.to) where.createdAt.lte = new Date(filters.to);
    }

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          actor: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data, total, page, limit };
  }
}
