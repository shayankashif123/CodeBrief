import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  validateSync,
} from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment;

  @IsInt()
  @Min(1)
  PORT: number = 3000;

  // ─── PostgreSQL ──────────────────────────────────────────────
  @IsString()
  DB_HOST: string;

  @IsInt()
  DB_PORT: number;

  @IsString()
  DB_NAME: string;

  @IsString()
  DB_USER: string;

  @IsString()
  DB_PASSWORD: string;

  // ─── MongoDB ─────────────────────────────────────────────────
  @IsString()
  MONGO_URI: string;

  // ─── Redis ───────────────────────────────────────────────────
  @IsString()
  REDIS_HOST: string;

  @IsInt()
  REDIS_PORT: number;

  @IsString()
  REDIS_PASSWORD: string;

  // ─── Internal services ───────────────────────────────────────
  @IsString()
  FASTAPI_URL: string;

  // ─── JWT ─────────────────────────────────────────────────────
  @IsString()
  JWT_SECRET: string;

  @IsString()
  JWT_EXPIRES_IN: string;

  @IsString()
  JWT_REFRESH_SECRET: string;

  @IsString()
  JWT_REFRESH_EXPIRES_IN: string;

  // ─── GitHub ──────────────────────────────────────────────────
  @IsString()
  GITHUB_APP_ID: string;

  @IsString()
  GITHUB_APP_PRIVATE_KEY: string;

  @IsString()
  GITHUB_WEBHOOK_SECRET: string;

  @IsString()
  GITHUB_CLIENT_ID: string;

  @IsString()
  GITHUB_CLIENT_SECRET: string;

  // ─── Frontend ────────────────────────────────────────────────
  @IsString()
  FRONTEND_URL: string;

  // ─── Optional ────────────────────────────────────────────────
  @IsString()
  @IsOptional()
  INTERNAL_API_KEY?: string;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(
      `Environment validation failed:\n${errors.map((e) => Object.values(e.constraints ?? {}).join(', ')).join('\n')}`,
    );
  }

  return validatedConfig;
}