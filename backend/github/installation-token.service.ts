import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAppAuth } from '@octokit/auth-app';
import { createRedisClient } from '../config/redis.config';
import { getGithubConfig } from '../config/github.config';
import IORedis from 'ioredis';

@Injectable()
export class InstallationTokenService implements OnModuleDestroy {
  private readonly logger = new Logger(InstallationTokenService.name);

  // The Redis client used exclusively for token caching
  private readonly redis: IORedis;

  // TTL constants — GitHub tokens expire at 60 min, we cache for 55
  // The 5 minute buffer absorbs clock skew and network latency
  private readonly TOKEN_TTL_SECONDS = 55 * 60; // 3300 seconds
  private readonly CACHE_KEY_PREFIX = 'gh_install_token';

  constructor(private readonly configService: ConfigService) {
    this.redis = createRedisClient(configService);

    this.redis.on('error', (err) => {
      this.logger.error('Redis client error in InstallationTokenService', err);
    });

    this.redis.on('connect', () => {
      this.logger.log('InstallationTokenService Redis client connected');
    });
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Returns a valid installation access token for the given installation ID.
   *
   * Flow:
   *   1. Check Redis cache → return immediately if found
   *   2. Generate GitHub App JWT → exchange for installation token
   *   3. Cache the token in Redis with 55 min TTL
   *   4. Return the token
   *
   * This is the ONLY method other services should call.
   * They don't need to know how the token is obtained or cached.
   */
  async getInstallationToken(installationId: number): Promise<string> {
    // Step 1 — Check cache first
    const cached = await this.getCachedToken(installationId);
    if (cached) {
      this.logger.debug(
        `Cache hit for installation ${installationId}`,
      );
      return cached;
    }

    // Step 2 — Cache miss, fetch a fresh token from GitHub
    this.logger.log(
      `Cache miss for installation ${installationId} — fetching fresh token`,
    );
    const freshToken = await this.fetchFreshToken(installationId);

    // Step 3 — Cache it for 55 minutes
    await this.cacheToken(installationId, freshToken);

    return freshToken;
  }

  /**
   * Explicitly invalidates the cached token for an installation.
   *
   * When to call this:
   * - GitHub returns a 401 on an API call (token was revoked early)
   * - Installation is uninstalled (installation.deleted webhook)
   *
   * After calling this, the next getInstallationToken call will
   * fetch a fresh token from GitHub.
   */
  async invalidateToken(installationId: number): Promise<void> {
    const key = this.buildCacheKey(installationId);
    await this.redis.del(key);
    this.logger.log(`Invalidated cached token for installation ${installationId}`);
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  /**
   * Builds the Redis key for a given installation ID.
   *
   * Pattern: gh_install_token:{installation_id}
   * Example: gh_install_token:12345678
   *
   * Matches the key design documented in the architecture.
   */
  private buildCacheKey(installationId: number): string {
    return `${this.CACHE_KEY_PREFIX}:${installationId}`;
  }

  /**
   * Attempts to retrieve a cached token from Redis.
   * Returns null if not found (cache miss or TTL expired).
   */
  private async getCachedToken(installationId: number): Promise<string | null> {
    const key = this.buildCacheKey(installationId);

    try {
      const token = await this.redis.get(key);
      return token; // null if key doesn't exist
    } catch (err) {
      // If Redis is down, log and fall through to fetch a fresh token.
      // We never let a Redis failure break the main flow.
      this.logger.warn(
        `Redis GET failed for key ${key} — will fetch fresh token`,
        err,
      );
      return null;
    }
  }

  /**
   * Stores a token in Redis with the configured TTL.
   * Fire-and-forget on failure — a caching failure is not fatal.
   */
  private async cacheToken(installationId: number, token: string): Promise<void> {
    const key = this.buildCacheKey(installationId);

    try {
      // EX sets the TTL in seconds — key auto-deletes after TOKEN_TTL_SECONDS
      await this.redis.set(key, token, 'EX', this.TOKEN_TTL_SECONDS);
      this.logger.debug(
        `Cached token for installation ${installationId} — TTL ${this.TOKEN_TTL_SECONDS}s`,
      );
    } catch (err) {
      // Not fatal — next request will just fetch a fresh token
      this.logger.warn(
        `Redis SET failed for key ${key} — token not cached`,
        err,
      );
    }
  }

  /**
   * Calls GitHub API to exchange a GitHub App JWT for an installation token.
   *
   * Uses @octokit/auth-app which handles:
   * - Signing the JWT with the private key (RS256)
   * - Calling POST /app/installations/{id}/access_tokens
   * - Returning the short-lived installation token
   *
   * This is the only place in the entire codebase that calls GitHub
   * for an installation token. All other services go through
   * getInstallationToken() which caches this result.
   */
  private async fetchFreshToken(installationId: number): Promise<string> {
    const { appId, privateKey } = getGithubConfig(this.configService);

    try {
      // createAppAuth returns an auth function that handles the full
      // JWT → installation token exchange internally
      const auth = createAppAuth({ appId, privateKey });

      const result = await auth({
        type: 'installation',
        installationId,
      });

      this.logger.log(
        `Successfully fetched fresh token for installation ${installationId}`,
      );

      return result.token;
    } catch (err) {
      // This is fatal — if we can't get a token, we cannot do anything
      // with GitHub for this installation. Let it bubble up.
      this.logger.error(
        `Failed to fetch installation token for installation ${installationId}`,
        err,
      );
      throw err;
    }
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * NestJS calls this when the application shuts down.
   * We close the Redis connection cleanly to avoid connection leaks.
   * This is especially important for ECS task draining in production.
   */
  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
    this.logger.log('InstallationTokenService Redis client disconnected');
  }
}