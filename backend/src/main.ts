import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression = require('compression');
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from '../common/filters/http-exception.filter';
import { LoggingInterceptor } from '../common/interceptors/logging.interceptor';

async function bootstrap() {

  const app = await NestFactory.create(AppModule, {
    // Structured JSON logs in production, pretty logs in dev
    logger:
      process.env.NODE_ENV === 'production'
        ? ['error', 'warn', 'log']
        : ['error', 'warn', 'log', 'debug', 'verbose'],
  });
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);
  const nodeEnv = configService.get<string>('NODE_ENV');
  const frontendUrl = configService.get<string>('FRONTEND_URL');

  // ─── Security ───────────────────────────────────────────────
  app.use(
    helmet({
      // Allow WebSocket connections
      contentSecurityPolicy: nodeEnv === 'production' ? undefined : false,
    }),
  );

  // ─── CORS ───────────────────────────────────────────────────
  app.enableCors({
    origin: frontendUrl,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-internal-key'],
  });

  // ─── Compression ────────────────────────────────────────────
  app.use(compression());

  // ─── Global validation pipe ─────────────────────────────────
  // Validates all incoming DTOs via class-validator decorators.
  // whitelist: strips any properties not declared in the DTO.
  // forbidNonWhitelisted: throws 400 if unknown properties are sent.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,           // auto-converts plain objects to DTO class instances
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // ─── API versioning ─────────────────────────────────────────
  app.enableVersioning({ type: VersioningType.URI });

  // ─── Global prefix ──────────────────────────────────────────
  app.setGlobalPrefix('api');

  // ─── Swagger (dev only) ─────────────────────────────────────
  if (nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Codebrief API')
      .setDescription('Codebrief backend API documentation')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  // ─── Graceful shutdown ──────────────────────────────────────
  // Allows in-flight requests and queue jobs to complete before exit.
  // Required for ECS task draining in production.
  app.enableShutdownHooks();

  await app.listen(port);
  console.log(`Codebrief backend running on port ${port} [${nodeEnv}]`);
  if (nodeEnv !== 'production') {
    console.log(`Swagger docs: http://localhost:${port}/api/docs`);
  }
}

bootstrap();