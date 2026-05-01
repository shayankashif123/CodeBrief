import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DataSource, DataSourceOptions } from 'typeorm';

// ─── Entity imports ──────────────────────────────────────────
import { User } from '@/repository/entities/user.entity';
import { Team } from '@/repository/entities/team.entity';
import { TeamMember } from '@/repository/entities/team-member.entity';
import { GithubInstallation } from '@/repository/entities/github-installation.entity';
import { Repository } from '@/repository/entities/repository.entity';
import { PullRequest } from '@/repository/entities/pull-request.entity';
import { Review } from '@/repository/entities/review.entity';

export const ENTITIES = [
  User,
  Team,
  TeamMember,
  GithubInstallation,
  Repository,
  PullRequest,
  Review,
];

// Used by NestJS AppModule (reads from ConfigService at runtime)
export const getTypeOrmConfig = (
  configService: ConfigService,
): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: configService.get<string>('DB_HOST'),
  port: configService.get<number>('DB_PORT'),
  database: configService.get<string>('DB_NAME'),
  username: configService.get<string>('DB_USER'),
  password: configService.get<string>('DB_PASSWORD'),
  entities: ENTITIES,
  // synchronize: false — ALWAYS. We use init.sql + migrations, never auto-sync.
  // Auto-sync in production will silently DROP columns. Never enable it.
  synchronize: false,
  logging: configService.get<string>('NODE_ENV') === 'development',
  ssl:
    configService.get<string>('NODE_ENV') === 'production'
      ? { rejectUnauthorized: true }
      : false,
  extra: {
    // Connection pool tuned for a single NestJS instance
    max: 10,
    min: 2,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },
});

// Used by TypeORM CLI for migrations (reads from process.env directly)
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? 'codebrief',
  username: process.env.DB_USER ?? 'codebrief_user',
  password: process.env.DB_PASSWORD ?? '',
  entities: ENTITIES,
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
} as DataSourceOptions);