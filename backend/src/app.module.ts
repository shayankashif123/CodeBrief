import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ThrottlerModule } from '@nestjs/throttler';
import { MongooseModule } from '@nestjs/mongoose';
import { validate } from '@/config/env.validation';
import { getTypeOrmConfig } from '@/config/database.config';
import { getMongoConfig } from '@/config/mongodb.config';
import { getBullConfig } from '@/config/redis.config';

// ─── Feature modules (stubbed — implemented in later tasks) ──
import { AuthModule } from '@/auth/auth.module';
import { GithubModule } from '@/github/github.module';
import { RepositoryModule } from '@/repository/repository.module';
import { ReviewModule } from '@/review/review.module';
import { DocumentationModule } from '@/documentation/documentation.module';
import { OnboardingModule } from '@/onboarding/onboarding.module';
import { AnalyticsModule } from '@/analytics/analytics.module';
import { WebsocketModule } from '@/websocket/websocket.module';
import { HealthController } from '../common/health.controller';

@Module({
  imports: [
    // ─── Config — must be first, all other modules depend on it ──
    ConfigModule.forRoot({
      isGlobal: true,          // available in every module without re-importing
      envFilePath: ['.env', '../.env'],
      validate,                // throws at startup if any required var is missing
      cache: true,             // caches parsed config — avoids re-reading on every access
    }),

    // ─── Database ─────────────────────────────────────────────
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: getTypeOrmConfig,
    }),

    // ─── Queue (BullMQ) ───────────────────────────────────────
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: getBullConfig,
    }),

    // ─── NoSQL Database (MongoDB) ─────────────────────────────
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: getMongoConfig,
    }),

    // ─── Rate limiting ────────────────────────────────────────
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,    // 1 second
        limit: 10,    // max 10 requests per second per IP
      },
      {
        name: 'medium',
        ttl: 60000,   // 1 minute
        limit: 200,   // max 200 requests per minute per IP
      },
    ]),

    // ─── Feature modules ──────────────────────────────────────
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
export class AppModule { }
