import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RedisModule } from '@nestjs-modules/ioredis';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GithubStrategy } from './strategies/github.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { GithubAuthGuard } from './guards/github-auth.guard';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { User } from '@/repository/entities/user.entity';

@Module({
    imports: [
        // ─── TypeORM — User entity ────────────────────────────────
        // AuthService needs the User repository to find/create users
        TypeOrmModule.forFeature([User]),

        // ─── Passport ────────────────────────────────────────────
        // Default strategy is jwt — all routes protected unless @Public()
        PassportModule.register({ defaultStrategy: 'jwt' }),

        // ─── JWT ─────────────────────────────────────────────────
        // JwtModule is used in AuthService to sign tokens.
        // We don't set a global secret here — we pass it per signAsync()
        // call so we can use different secrets for access vs refresh tokens.
        JwtModule.register({}),

        // ─── Redis ───────────────────────────────────────────────
        // Used by AuthService to store and validate refresh tokens
        RedisModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => ({
                type: 'single',
                url: `redis://:${configService.getOrThrow('REDIS_PASSWORD')}@${configService.getOrThrow('REDIS_HOST')}:${configService.getOrThrow('REDIS_PORT')}`,
            }),
        }),
    ],

    controllers: [AuthController],

    providers: [
        AuthService,
        GithubStrategy,
        JwtStrategy,
        JwtRefreshStrategy,
        JwtAuthGuard,
        GithubAuthGuard,
        JwtRefreshGuard,
    ],

    exports: [
        AuthService,
        JwtAuthGuard,
    ],
})
export class AuthModule { }