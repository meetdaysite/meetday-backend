import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { PrismaService } from '../../src/prisma/prisma.service';

// Mock mail queue — injected everywhere via @InjectQueue('mail').
// BullExplorer.onModuleInit() calls queue.process(), queue.on(), and checks
// queue.isReady() during app.init(); all must exist or Bull throws on startup.
export const mockMailQueue = {
  add: jest.fn(),
  process: jest.fn(),
  on: jest.fn(),
  close: jest.fn(),
  isReady: jest.fn().mockResolvedValue({}),
  getRepeatableJobs: jest.fn().mockResolvedValue([]),
  removeRepeatable: jest.fn().mockResolvedValue(undefined),
};

/**
 * Builds and returns a fully initialized NestJS test application.
 *
 * Prerequisites (docker-compose):
 *   docker-compose up -d postgres redis
 *   DATABASE_URL should point to meetday_test database.
 *
 * Overrides applied:
 *   - APP_GUARD → reads x-test-uid header, no real Firebase verification
 *   - BullQueue_mail → no-op mock (no Redis enqueue, no SMTP)
 */
export async function buildTestApp(): Promise<{
  app: INestApplication;
  prisma: PrismaService;
}> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(getQueueToken('mail'))
    .useValue(mockMailQueue)
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  await app.init();

  const prisma = moduleRef.get(PrismaService);
  return { app, prisma };
}
