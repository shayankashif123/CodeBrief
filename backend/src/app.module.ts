import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ThrottlerModule } from '@nestjs/throttler';
import { validate } from '@/config/env.validation';
import { getTypeOrmConfig } from '@/config/database.config';
import { getBullConfig } from '@/config/redis.config';
import { RawBodyMiddleware } from '@/common/middleware/raw-body.middleware';
import { HealthController } from '@/common/health.controller';

// ─── Feature modules ──────────────────────────────────────────────────────
import { AuthModule } from '@/auth/auth.module';
import { GithubModule } from '@/github/github.module';
import { RepositoryModule } from '@/repository/repository.module';
import { ReviewModule } from '@/review/review.module';
import { DocumentationModule } from '@/documentation/documentation.module';
import { OnboardingModule } from '@/onboarding/onboarding.module';
import { AnalyticsModule } from '@/analytics/analytics.module';
import { WebsocketModule } from '@/websocket/websocket.module';
import { MongooseModule } from '@nestjs/mongoose';
import { getMongoConfig } from '@/config/mongodb.config';

@Module({
  imports: [
    // ─── Config — must be first ────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'],
      validate,
      cache: true,
    }),

    // ─── Database ──────────────────────────────────────────────────────
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: getTypeOrmConfig,
    }),

    // ─── MongoDB ───────────────────────────────────────────────────────
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: getMongoConfig,
    }),

    // ─── Queue (BullMQ) ────────────────────────────────────────────────
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: getBullConfig,
    }),

    // ─── Rate limiting ─────────────────────────────────────────────────
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,
        limit: 10,
      },
      {
        name: 'medium',
        ttl: 60000,
        limit: 200,
      },
    ]),

    // ─── Feature modules ───────────────────────────────────────────────
    AuthModule,
    GithubModule,
    RepositoryModule,
    ReviewModule,
    DocumentationModule,
    OnboardingModule,
    AnalyticsModule,
    WebsocketModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  /**
   * Apply RawBodyMiddleware ONLY to the webhook route.
   *
   * This middleware captures the raw request bytes before NestJS
   * parses the body — required for HMAC-SHA256 signature validation.
   *
   * Scoped surgically to POST /github/webhook only.
   * Applying it globally would interfere with all other JSON parsing
   * across auth, repository, and every other route.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RawBodyMiddleware)
      .forRoutes({
        path: 'github/webhook',
        method: RequestMethod.POST,
      });
  }
}