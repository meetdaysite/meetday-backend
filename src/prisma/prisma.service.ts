import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { withRetry } from '../common/utils/retry';

/**
 * Stub until models are added to prisma/schema.prisma and `npx prisma generate` is run.
 * Uses a raw pg Pool to verify database connectivity in the meantime.
 *
 * Once Prisma client is generated, replace with:
 *
 *   import { PrismaClient } from '@prisma/client';
 *
 *   @Injectable()
 *   export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
 *     private readonly logger = new Logger(PrismaService.name);
 *
 *     async onModuleInit() {
 *       await withRetry(() => this.$connect(), {
 *         label: 'Database (Prisma)',
 *         logger: this.logger,
 *       });
 *       this.logger.log('Database connected');
 *     }
 *
 *     async onModuleDestroy() {
 *       await this.$disconnect();
 *     }
 *   }
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private pool: Pool;

  async onModuleInit() {
    this.pool = new Pool({ connectionString: process.env.DATABASE_URL });

    await withRetry(
      async () => {
        const client = await this.pool.connect();
        await client.query('SELECT 1');
        client.release();
      },
      { label: 'Database', logger: this.logger },
    );

    this.logger.log('Database connected');
  }

  async onModuleDestroy() {
    await this.pool?.end();
  }
}
