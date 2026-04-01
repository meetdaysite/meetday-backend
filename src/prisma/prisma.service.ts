import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';

/**
 * Stub until models are added to prisma/schema.prisma and `npx prisma generate` is run.
 * Once generated, replace with:
 *
 *   import { PrismaClient } from '@prisma/client';
 *
 *   @Injectable()
 *   export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
 *     async onModuleInit() { await this.$connect(); }
 *     async onModuleDestroy() { await this.$disconnect(); }
 *   }
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    this.logger.log('PrismaService ready (stub — no models defined yet)');
  }

  async onModuleDestroy() {}
}
