import { ConfigService } from '@nestjs/config';
import { BullModuleOptions } from '@nestjs/bull';
import IORedis, { RedisOptions } from 'ioredis';

export const getRedisConfig = (configService: ConfigService): RedisOptions => ({
  host: configService.get<string>('REDIS_HOST'),
  port: configService.get<number>('REDIS_PORT'),
  password: configService.get<string>('REDIS_PASSWORD'),
  retryStrategy: (times: number) => {
    // Exponential backoff: 50ms, 100ms, 200ms... capped at 3s
    return Math.min(times * 50, 3000);
  },
  enableReadyCheck: true,
  maxRetriesPerRequest: 3,
});

export const getBullConfig = (configService: ConfigService): BullModuleOptions => ({
  redis: getRedisConfig(configService),
  defaultJobOptions: {
    removeOnComplete: 100,   // keep last 100 completed jobs for debugging
    removeOnFail: 200,       // keep last 200 failed jobs for post-mortem
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,           // 2s, 4s, 8s
    },
  },
});

// Standalone Redis client factory — used outside BullMQ (caching, pub/sub)
export const createRedisClient = (configService: ConfigService): IORedis => {
  return new IORedis(getRedisConfig(configService));
};