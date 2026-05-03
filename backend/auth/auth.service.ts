import {
    Injectable,
    InternalServerErrorException,
    Logger,
    UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { User } from '@/repository/entities/user.entity';
import { JwtPayload } from './strategies/jwt.strategy';
import { JwtRefreshPayload } from './strategies/jwt-refresh.strategy';
import { AuthResponseDto } from './dto/auth-tokens.dto';

interface FindOrCreateUserDto {
    githubId: string;
    username: string;
    email: string | null;   // null when GitHub user has private email settings
    avatarUrl: string | null;
}

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    // Redis key pattern: refresh:{userId}:{sessionId}
    // One key per device session — allows targeted logout per device
    private readonly REFRESH_TOKEN_PREFIX = 'refresh';
    private readonly REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60; // 30 days in seconds

    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRedis()
        private readonly redis: Redis,
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
    ) { }

    // ─── Find or Create User ──────────────────────────────────────
    // Called by GithubStrategy after OAuth completes.
    // Uses githubId as the stable lookup key — not email, not username.
    // If user doesn't exist, creates them. If they do, updates mutable fields.
    async findOrCreateUser(dto: FindOrCreateUserDto): Promise<User> {
        try {
            let user = await this.userRepository.findOne({
                where: { githubId: dto.githubId },
            });

            if (user) {
                // Update fields that can change on GitHub (username, email, avatar)
                // githubId never changes so we never update that
                user.username = dto.username;
                user.email = dto.email;
                user.avatarUrl = dto.avatarUrl;
                return this.userRepository.save(user);
            }

            // New user — create record
            user = this.userRepository.create({
                githubId: dto.githubId,
                username: dto.username,
                email: dto.email,
                avatarUrl: dto.avatarUrl,
            });

            const saved = await this.userRepository.save(user);
            this.logger.log(`New user created: ${saved.username} (${saved.id})`);
            return saved;
        } catch (error) {
            this.logger.error('Failed to find or create user', error);
            throw new InternalServerErrorException('Authentication failed');
        }
    }

    // ─── Generate Tokens ──────────────────────────────────────────
    // Called after OAuth completes and after refresh token rotation.
    // Issues both access token and refresh token together as a pair.
    async generateTokens(user: User): Promise<AuthResponseDto> {
        const sessionId = uuidv4(); // unique per login session / device

        // Access token payload — short lived, stateless
        const accessPayload: JwtPayload = {
            sub: user.id,
            username: user.username,
            email: user.email ?? "",
            sessionId,
        };

        // Refresh token payload — includes sessionId for targeted revocation
        const refreshPayload: JwtRefreshPayload = {
            sub: user.id,
            sessionId,
        };

        const [accessToken, refreshToken] = await Promise.all([
            this.jwtService.signAsync(accessPayload, {
                secret: this.configService.getOrThrow('JWT_SECRET'),
                expiresIn: this.configService.getOrThrow('JWT_EXPIRES_IN'), // 15m
            }),
            this.jwtService.signAsync(refreshPayload, {
                secret: this.configService.getOrThrow('JWT_REFRESH_SECRET'),
                expiresIn: this.configService.getOrThrow('JWT_REFRESH_EXPIRES_IN'), // 30d
            }),
        ]);

        // Store refresh token in Redis
        // Key: refresh:{userId}:{sessionId}
        // Value: the signed refresh token string
        // TTL: 30 days — auto-expires, no manual cleanup needed
        await this.storeRefreshToken(user.id, sessionId, refreshToken);

        return {
            user: {
                id: user.id,
                username: user.username,
                email: user.email ?? "",
                avatarUrl: user.avatarUrl,
            },
            tokens: {
                accessToken,
                refreshToken,
                expiresIn: 15 * 60, // 15 minutes in seconds
            },
        };
    }

    // ─── Refresh Token Rotation ───────────────────────────────────
    // Called when the access token expires.
    // Validates the refresh token in Redis, deletes the old one,
    // issues a brand new pair. This is token rotation — each refresh
    // token can only be used once.
    async rotateRefreshToken(userId: string, sessionId: string): Promise<AuthResponseDto> {
        const user = await this.userRepository.findOne({ where: { id: userId } });

        if (!user) {
            throw new UnauthorizedException('User not found');
        }

        // Delete old refresh token from Redis before issuing new pair
        await this.deleteRefreshToken(userId, sessionId);

        // Issue fresh pair with new sessionId
        return this.generateTokens(user);
    }

    // ─── Validate Refresh Token ───────────────────────────────────
    // Called by JwtRefreshStrategy to confirm the token exists in Redis.
    // If it's been revoked (logout) or never existed — returns false.
    async validateRefreshToken(
        userId: string,
        sessionId: string,
        token: string,
    ): Promise<boolean> {
        const key = this.buildRefreshKey(userId, sessionId);
        const stored = await this.redis.get(key);
        return stored === token;
    }

    // ─── Logout ───────────────────────────────────────────────────
    // Deletes only the specific session's refresh token.
    // User stays logged in on other devices.
    async logout(userId: string, sessionId: string): Promise<void> {
        await this.deleteRefreshToken(userId, sessionId);
        this.logger.log(`User ${userId} logged out of session ${sessionId}`);
    }

    // ─── Logout All Devices ───────────────────────────────────────
    // Deletes ALL refresh tokens for this user.
    // Use when user changes password or reports account compromise.
    async logoutAllDevices(userId: string): Promise<void> {
        const pattern = this.buildRefreshKey(userId, '*');
        const keys = await this.redis.keys(pattern);

        if (keys.length > 0) {
            await this.redis.del(...keys);
        }

        this.logger.log(`User ${userId} logged out of all ${keys.length} sessions`);
    }

    // ─── Private helpers ──────────────────────────────────────────
    private async storeRefreshToken(
        userId: string,
        sessionId: string,
        token: string,
    ): Promise<void> {
        const key = this.buildRefreshKey(userId, sessionId);
        await this.redis.setex(key, this.REFRESH_TOKEN_TTL, token);
    }

    private async deleteRefreshToken(userId: string, sessionId: string): Promise<void> {
        const key = this.buildRefreshKey(userId, sessionId);
        await this.redis.del(key);
    }

    private buildRefreshKey(userId: string, sessionId: string): string {
        return `${this.REFRESH_TOKEN_PREFIX}:${userId}:${sessionId}`;
    }
}