import {
    Controller,
    Post,
    Req,
    Headers,
    HttpCode,
    Logger,
    BadRequestException,
    UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Request } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import IORedis from 'ioredis';
import { Public } from '../common/decorators/public.decorator';
import { getGithubConfig } from '../config/github.config';
import { createRedisClient } from '../config/redis.config';
import { GithubApiService } from './github-api.service';
import { GithubInstallation } from '../repository/entities/github-installation.entity';
import { OnModuleDestroy } from '@nestjs/common';

// ─── Payload Interfaces ────────────────────────────────────────────────────
// These type the raw GitHub webhook JSON payloads.
// Only the fields we actually use are declared — we don't need to type
// the entire GitHub payload spec, just what we extract.

interface GithubRepository {
    id: number;
    full_name: string;
    name: string;
    owner: { login: string };
    default_branch: string;
    language: string | null;
    private: boolean;
}

interface PullRequestPayload {
    action: string;
    number: number;
    pull_request: {
        title: string;
        head: { sha: string };
        base: { ref: string };
        user: { login: string };
        merged: boolean;
        state: string;
    };
    repository: GithubRepository;
    installation: { id: number };
    sender: { login: string };
}

interface InstallationPayload {
    action: string;
    installation: {
        id: number;
        account: { login: string; type: string };
    };
    repositories?: Array<{ id: number; full_name: string }>;
    sender: { login: string };
}

// ─── Redis Key Constants ───────────────────────────────────────────────────
// Centralised here so if the key pattern ever changes,
// it changes in exactly one place
const REVIEW_LOCK_PREFIX = 'review_lock';
const REVIEW_LOCK_TTL_SECONDS = 10 * 60; // 10 minutes

@Controller('github')
export class WebhookController implements OnModuleDestroy {
    private readonly logger = new Logger(WebhookController.name);
    private readonly redis: IORedis;

    constructor(
        private readonly configService: ConfigService,
        private readonly githubApiService: GithubApiService,

        @InjectQueue('pr-review')
        private readonly prReviewQueue: Queue,

        @InjectQueue('doc-update')
        private readonly docUpdateQueue: Queue,

        @InjectRepository(GithubInstallation)
        private readonly installationRepository: Repository<GithubInstallation>,
    ) {
        this.redis = createRedisClient(configService);

        this.redis.on('error', (err) => {
            this.logger.error('Redis client error in WebhookController', err);
        });
    }

    // ─── Webhook Endpoint ──────────────────────────────────────────────────

    @Post('webhook')
    @HttpCode(200)
    @Public() // GitHub cannot send a JWT — this route must be public
    async handleWebhook(
        @Req() req: Request,
        @Headers('x-hub-signature-256') signature: string,
        @Headers('x-github-event') eventType: string,
        @Headers('x-github-delivery') deliveryId: string,
    ): Promise<{ received: boolean }> {
        // ── Step 1 — Validate HMAC signature ────────────────────────────────
        // Must happen before ANY processing — reject unauthenticated requests
        // immediately without revealing anything about your system
        this.validateSignature(req.rawBody, signature);

        this.logger.log(
            `Webhook received — event: ${eventType}, delivery: ${deliveryId}`,
        );

        // ── Step 2 — Route based on event type ──────────────────────────────
        // Handle each event type in its own method for clarity
        // Unknown events return 200 silently — never return non-200 to GitHub
        // for events you don't support, or GitHub marks your endpoint failing
        switch (eventType) {
            case 'pull_request':
                await this.handlePullRequestEvent(req.body as PullRequestPayload);
                break;

            case 'installation':
                await this.handleInstallationEvent(req.body as InstallationPayload);
                break;

            case 'ping':
                // GitHub sends a ping when you first configure a webhook
                // Acknowledge it — nothing else to do
                this.logger.log('GitHub ping received — webhook configured correctly');
                break;

            default:
                // Event we don't handle — log and return 200 silently
                this.logger.debug(`Unhandled event type: ${eventType} — ignoring`);
        }

        // ── Step 6 — Always return 200 ──────────────────────────────────────
        // By this point the job is enqueued and we are done.
        // The actual AI review happens asynchronously after this response.
        return { received: true };
    }

    // ─── Event Handlers ───────────────────────────────────────────────────

    /**
     * Handles all pull_request.* events.
     *
     * Actions we care about:
     * - opened      → new PR, trigger review
     * - synchronize → new commits pushed to PR, re-review
     * - closed      → if merged, trigger doc update
     *
     * Actions we ignore: assigned, labeled, review_requested, etc.
     */
    private async handlePullRequestEvent(
        payload: PullRequestPayload,
    ): Promise<void> {
        const { action, number: prNumber, pull_request, repository, installation } =
            payload;

        const installationId = installation.id;
        const owner = repository.owner.login;
        const repo = repository.name;
        const headSha = pull_request.head.sha;
        const repoGithubId = repository.id.toString();

        this.logger.log(
            `PR event — action: ${action}, PR #${prNumber} on ${owner}/${repo}`,
        );

        // ── Review trigger ─────────────────────────────────────────────────
        if (action === 'opened' || action === 'synchronize') {
            // Step 3 — Check idempotency lock
            // Key: review_lock:{githubRepoId}:{prNumber}:{headSha}
            // If this key exists, we already enqueued this exact job
            const lockKey = `${REVIEW_LOCK_PREFIX}:${repoGithubId}:${prNumber}:${headSha}`;
            const lockExists = await this.redis.exists(lockKey);

            if (lockExists) {
                this.logger.warn(
                    `Duplicate webhook detected for PR #${prNumber} SHA ${headSha} — skipping`,
                );
                return; // Return silently — GitHub gets 200 either way
            }

            // Step 4 — Set the lock BEFORE enqueuing
            // Set first, enqueue second — if we enqueued first and then crashed
            // before setting the lock, the next retry would enqueue again
            await this.redis.set(lockKey, 'processing', 'EX', REVIEW_LOCK_TTL_SECONDS);

            // Step 5 — Enqueue the review job
            // Pass everything the worker needs — it should never re-parse webhooks
            await this.prReviewQueue.add(
                'review-pr',
                {
                    installationId,
                    owner,
                    repo,
                    repoGithubId,
                    prNumber,
                    headSha,
                    title: pull_request.title,
                    authorLogin: pull_request.user.login,
                    baseBranch: pull_request.base.ref,
                    action,
                },
                {
                    // Job-level options override queue defaults where needed
                    // Review jobs are time sensitive — keep attempts at 3
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 2000 },
                },
            );

            this.logger.log(
                `Enqueued pr-review job for PR #${prNumber} on ${owner}/${repo} (SHA: ${headSha})`,
            );
        }

        // ── Doc update trigger ─────────────────────────────────────────────
        else if (action === 'closed' && pull_request.merged) {
            // Only trigger doc updates when merging to the default branch
            // Feature branch merges don't update main documentation
            const defaultBranch = repository.default_branch;
            const targetBranch = pull_request.base.ref;

            if (targetBranch !== defaultBranch) {
                this.logger.log(
                    `PR #${prNumber} merged to ${targetBranch} (not ${defaultBranch}) — skipping doc update`,
                );
                return;
            }

            await this.docUpdateQueue.add(
                'update-docs',
                {
                    installationId,
                    owner,
                    repo,
                    repoGithubId,
                    prNumber,
                    mergeCommitSha: headSha,
                    mergedBy: payload.sender.login,
                    title: pull_request.title,
                    baseBranch: targetBranch,
                },
                {
                    // Doc updates are lower priority — longer delay is acceptable
                    attempts: 5,
                    backoff: { type: 'exponential', delay: 5000 },
                },
            );

            this.logger.log(
                `Enqueued doc-update job for merged PR #${prNumber} on ${owner}/${repo}`,
            );
        }

        // All other actions (labeled, assigned, etc.) — log and ignore
        else {
            this.logger.debug(`PR action '${action}' — no handler, ignoring`);
        }
    }

    /**
     * Handles installation.created and installation.deleted events.
     *
     * installation.created — someone installed your GitHub App
     *   → save the installation record to PostgreSQL
     *   → this is fast (one DB write), done synchronously before 200
     *
     * installation.deleted — someone uninstalled your GitHub App
     *   → soft delete — set is_active = false, record timestamp
     *   → never hard delete — preserves historical review data
     */
    private async handleInstallationEvent(
        payload: InstallationPayload,
    ): Promise<void> {
        const { action, installation } = payload;

        this.logger.log(
            `Installation event — action: ${action}, installation: ${installation.id}`,
        );

        if (action === 'created') {
            // Check if we already have this installation — idempotent
            const existing = await this.installationRepository.findOne({
                where: { installationId: installation.id.toString() },
            });

            if (existing) {
                // Already exists — could have been re-installed after deletion
                // Reactivate it rather than creating a duplicate
                if (!existing.isActive) {
                    existing.isActive = true;
                    existing.uninstalledAt = null;
                    await this.installationRepository.save(existing);
                    this.logger.log(
                        `Reactivated installation ${installation.id} for ${installation.account.login}`,
                    );
                } else {
                    this.logger.log(
                        `Installation ${installation.id} already active — ignoring duplicate`,
                    );
                }
                return;
            }

            // New installation — create the record
            // Note: teamId is null here — we link to a team in a later flow
            // when the user connects the installation to their Codebrief team
            // via the dashboard. The installation record is created first,
            // team linkage happens separately.
            const newInstallation = this.installationRepository.create({
                installationId: installation.id.toString(),
                accountLogin: installation.account.login,
                accountType: installation.account.type,
                isActive: true,
            });

            await this.installationRepository.save(newInstallation);

            this.logger.log(
                `Saved new installation ${installation.id} for ${installation.account.login}`,
            );
        }

        else if (action === 'deleted') {
            // Soft delete — preserve all historical data
            const record = await this.installationRepository.findOne({
                where: { installationId: installation.id.toString() },
            });

            if (record) {
                record.isActive = false;
                record.uninstalledAt = new Date();
                await this.installationRepository.save(record);

                this.logger.log(
                    `Soft deleted installation ${installation.id} for ${installation.account.login}`,
                );
            } else {
                this.logger.warn(
                    `Received deleted event for unknown installation ${installation.id}`,
                );
            }
        }

        else {
            this.logger.debug(
                `Installation action '${action}' — no handler, ignoring`,
            );
        }
    }

    // ─── Security ─────────────────────────────────────────────────────────

    /**
     * Validates the HMAC-SHA256 signature GitHub sends with every webhook.
     *
     * GitHub computes: HMAC-SHA256(webhookSecret, rawBody)
     * and puts it in X-Hub-Signature-256 as "sha256={hex}"
     *
     * We compute the same and compare using timingSafeEqual.
     *
     * CRITICAL — timingSafeEqual instead of ===
     * String comparison with === short-circuits on the first differing
     * character. This creates a timing side-channel — an attacker can
     * measure response times to guess the secret character by character.
     * timingSafeEqual always takes the same time regardless of where
     * strings differ. This is standard cryptographic practice.
     *
     * CRITICAL — rawBody not req.body
     * We must sign the exact bytes GitHub sent, not a re-serialized
     * version. JSON.stringify(req.body) !== original payload bytes.
     * This is why RawBodyMiddleware exists.
     */
    private validateSignature(rawBody: Buffer | undefined, signature: string): void {
        if (!rawBody) {
            this.logger.error('rawBody is undefined — RawBodyMiddleware may not be applied');
            throw new BadRequestException('Missing request body');
        }

        if (!signature) {
            this.logger.warn('Webhook received without signature — rejecting');
            throw new UnauthorizedException('Missing webhook signature');
        }

        const { webhookSecret } = getGithubConfig(this.configService);

        // Compute expected signature from raw body + our secret
        const expectedSignature =
            'sha256=' +
            createHmac('sha256', webhookSecret)
                .update(rawBody)
                .digest('hex');

        // Convert both to Buffer for timingSafeEqual
        // They must be the same length — pad if needed, but GitHub always
        // sends 64 hex chars after "sha256=" so lengths should match
        const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
        const receivedBuffer = Buffer.from(signature, 'utf8');

        // timingSafeEqual throws if buffers have different lengths
        // so we check length equality first
        if (
            expectedBuffer.length !== receivedBuffer.length ||
            !timingSafeEqual(expectedBuffer, receivedBuffer)
        ) {
            this.logger.warn(
                'Webhook signature validation failed — possible forgery attempt',
            );
            throw new UnauthorizedException('Invalid webhook signature');
        }
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────

    async onModuleDestroy(): Promise<void> {
        await this.redis.quit();
        this.logger.log('WebhookController Redis client disconnected');
    }
}