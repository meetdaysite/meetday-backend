import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { getCorsOrigin } from './common/utils/cors-origin.util';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const isProduction = process.env.NODE_ENV === 'production';
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true, // required for Razorpay webhook HMAC-SHA256 signature verification
    logger: isProduction
      ? ['log', 'warn', 'error']
      : ['log', 'warn', 'error', 'debug', 'verbose'],
  });
  app.useLogger(app.get(Logger));

  // Security headers — only in production (helmet blocks Swagger UI in dev)
  if (isProduction) app.use(helmet());

  // CORS — locked to known frontends (comma-separated ALLOWED_ORIGINS) in production, permissive in dev
  app.enableCors({
    origin: getCorsOrigin(),
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Global exception filter
  app.useGlobalFilters(new AllExceptionsFilter());

  // Global response transform + request logging
  app.useGlobalInterceptors(new TransformInterceptor(), new LoggingInterceptor());

  // Swagger (dev only)
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Meetday API')
      .setDescription('Meetday backend API documentation')
      .setVersion('1.0')
      .addServer('/', 'Default')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'Firebase JWT' },
        'firebase-token',
      )
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      useGlobalPrefix: false,
    });
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`Application is running on: http://localhost:${port}`);
  if (process.env.NODE_ENV !== 'production') {
    logger.log(`Swagger docs: http://localhost:${port}/api/docs`);
  }
}
bootstrap();
