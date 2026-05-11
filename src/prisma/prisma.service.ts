import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { withRetry } from '../common/utils/retry';

// Read operations that should respect the soft-delete filter
const FILTERED_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super();
    // Automatically exclude soft-deleted users from all read queries.
    // Callers can bypass by explicitly passing { deletedAt: { not: null } } or { deletedAt: null }
    // in their where clause (e.g. an admin "list deleted users" query).
    // TODO: migrate to $extends once PrismaService is refactored from `extends PrismaClient`
    // to a composition-based pattern. $extends returns a new object and cannot be applied
    // to `this` in a class constructor. $use is deprecated but functional in Prisma v5.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    this.$use(async (params, next) => {
      if (params.model === 'User' && FILTERED_OPS.has(params.action)) {
        // hasOwnProperty check allows callers to pass `deletedAt: undefined` explicitly
        // as a bypass signal — Prisma ignores undefined values in queries, so it becomes
        // an unconstrained read across all rows (active + soft-deleted).
        if (!Object.prototype.hasOwnProperty.call(params.args?.where ?? {}, 'deletedAt')) {
          params.args = {
            ...params.args,
            where: { ...params.args.where, deletedAt: null },
          };
        }
      }
      return next(params);
    });
  }

  async onModuleInit() {
    await withRetry(() => this.$connect(), {
      label: 'Database',
      logger: this.logger,
    });
    this.logger.log('Database connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
