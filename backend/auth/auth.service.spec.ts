import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '@/repository/entities/user.entity';

// ─── Mocks ────────────────────────────────────────────────────
const mockUserRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
};

const mockRedis = {
    setex: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
    keys: jest.fn(),
};

const mockJwtService = {
    signAsync: jest.fn(),
};

const mockConfigService = {
    getOrThrow: jest.fn((key: string) => {
        const config: Record<string, string> = {
            JWT_SECRET: 'test-jwt-secret',
            JWT_EXPIRES_IN: '15m',
            JWT_REFRESH_SECRET: 'test-refresh-secret',
            JWT_REFRESH_EXPIRES_IN: '30d',
        };
        return config[key];
    }),
};

// ─── Test Suite ───────────────────────────────────────────────
describe('AuthService', () => {
    let service: AuthService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AuthService,
                { provide: getRepositoryToken(User), useValue: mockUserRepository },
                { provide: 'default_IORedisModuleConnectionToken', useValue: mockRedis },
                { provide: JwtService, useValue: mockJwtService },
                { provide: ConfigService, useValue: mockConfigService },
            ],
        }).compile();

        service = module.get<AuthService>(AuthService);
        jest.clearAllMocks();
    });

    // ─── findOrCreateUser ────────────────────────────────────────
    describe('findOrCreateUser', () => {
        const dto = {
            githubId: '12345',
            username: 'testuser',
            email: 'test@example.com',
            avatarUrl: 'https://github.com/avatar.png',
        };

        it('should return existing user and update mutable fields', async () => {
            const existingUser = { id: 'uuid-1', ...dto };
            mockUserRepository.findOne.mockResolvedValue(existingUser);
            mockUserRepository.save.mockResolvedValue(existingUser);

            const result = await service.findOrCreateUser(dto);

            expect(mockUserRepository.findOne).toHaveBeenCalledWith({
                where: { githubId: dto.githubId },
            });
            expect(mockUserRepository.save).toHaveBeenCalled();
            expect(result).toEqual(existingUser);
        });

        it('should create a new user when not found', async () => {
            const newUser = { id: 'uuid-new', ...dto };
            mockUserRepository.findOne.mockResolvedValue(null);
            mockUserRepository.create.mockReturnValue(newUser);
            mockUserRepository.save.mockResolvedValue(newUser);

            const result = await service.findOrCreateUser(dto);

            expect(mockUserRepository.create).toHaveBeenCalledWith(dto);
            expect(mockUserRepository.save).toHaveBeenCalled();
            expect(result.githubId).toBe(dto.githubId);
        });
    });

    // ─── generateTokens ──────────────────────────────────────────
    describe('generateTokens', () => {
        it('should issue access and refresh tokens and store in Redis', async () => {
            const user = {
                id: 'uuid-1',
                username: 'testuser',
                email: 'test@example.com',
                avatarUrl: null,
            } as User;

            mockJwtService.signAsync
                .mockResolvedValueOnce('access-token-string')
                .mockResolvedValueOnce('refresh-token-string');

            mockRedis.setex.mockResolvedValue('OK');

            const result = await service.generateTokens(user);

            expect(result.tokens.accessToken).toBe('access-token-string');
            expect(result.tokens.refreshToken).toBe('refresh-token-string');
            expect(result.tokens.expiresIn).toBe(900); // 15 * 60
            expect(mockRedis.setex).toHaveBeenCalledTimes(1);
            // Verify Redis key follows the refresh:{userId}:{sessionId} pattern
            expect(mockRedis.setex.mock.calls[0][0]).toMatch(/^refresh:uuid-1:/);
        });
    });

    // ─── validateRefreshToken ─────────────────────────────────────
    describe('validateRefreshToken', () => {
        it('should return true when token matches Redis value', async () => {
            mockRedis.get.mockResolvedValue('stored-token');
            const result = await service.validateRefreshToken('uid', 'sid', 'stored-token');
            expect(result).toBe(true);
        });

        it('should return false when token does not match', async () => {
            mockRedis.get.mockResolvedValue('different-token');
            const result = await service.validateRefreshToken('uid', 'sid', 'wrong-token');
            expect(result).toBe(false);
        });

        it('should return false when key does not exist in Redis', async () => {
            mockRedis.get.mockResolvedValue(null);
            const result = await service.validateRefreshToken('uid', 'sid', 'any-token');
            expect(result).toBe(false);
        });
    });

    // ─── logout ──────────────────────────────────────────────────
    describe('logout', () => {
        it('should delete the specific session refresh token from Redis', async () => {
            mockRedis.del.mockResolvedValue(1);
            await service.logout('uid', 'sid');
            expect(mockRedis.del).toHaveBeenCalledWith('refresh:uid:sid');
        });
    });

    // ─── logoutAllDevices ─────────────────────────────────────────
    describe('logoutAllDevices', () => {
        it('should delete all refresh tokens for the user', async () => {
            mockRedis.keys.mockResolvedValue(['refresh:uid:sid1', 'refresh:uid:sid2']);
            mockRedis.del.mockResolvedValue(2);

            await service.logoutAllDevices('uid');

            expect(mockRedis.keys).toHaveBeenCalledWith('refresh:uid:*');
            expect(mockRedis.del).toHaveBeenCalledWith('refresh:uid:sid1', 'refresh:uid:sid2');
        });

        it('should handle user with no active sessions gracefully', async () => {
            mockRedis.keys.mockResolvedValue([]);
            await service.logoutAllDevices('uid');
            expect(mockRedis.del).not.toHaveBeenCalled();
        });
    });
});