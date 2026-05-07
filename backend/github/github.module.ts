import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';

import { WebhookController } from './webhook.controller';
import { InstallationTokenService } from './installation-token.service';
import { GithubApiService } from './github-api.service';
import { GithubInstallation } from '../repository/entities/github-installation.entity';

@Module({
    imports: [
        // ─── Config ─────────────────────────────────────────────────────────
        // ConfigModule is global but we import explicitly here for clarity
        // getGithubConfig and getRedisConfig are used inside our services
        ConfigModule,

        // ─── TypeORM Entity ──────────────────────────────────────────────────
        // WebhookController writes to github_installations table directly
        // when installation.created and installation.deleted events arrive
        // Must be registered here so TypeORM injects the repository correctly
        TypeOrmModule.forFeature([GithubInstallation]),

        // ─── BullMQ Queues ───────────────────────────────────────────────────
        // Register both queues this module produces jobs into
        // The queue names must match exactly what @InjectQueue() uses
        // in WebhookController — 'pr-review' and 'doc-update'
        //
        // BullModule.forRootAsync in AppModule handles the Redis connection
        // BullModule.registerQueue here just declares which queues this
        // module uses — they share the root Redis connection
        BullModule.registerQueue(
            { name: 'pr-review' },
            { name: 'doc-update' },
        ),
    ],

    controllers: [
        // WebhookController handles POST /api/github/webhook
        WebhookController,
    ],

    providers: [
        // InstallationTokenService — GitHub App token caching
        // GithubApiService — Octokit wrapper for all GitHub API calls
        InstallationTokenService,
        GithubApiService,
    ],

    exports: [
        // Export both services so other modules can inject them
        //
        // InstallationTokenService — ReviewModule workers need installation
        // tokens to authenticate GitHub API calls when posting review comments
        //
        // GithubApiService — ReviewModule workers need to fetch PR diffs
        // and post review comments after the AI analysis completes
        //
        // Without these exports, NestJS would throw:
        // "Nest can't resolve dependencies of ReviewWorker"
        InstallationTokenService,
        GithubApiService,
    ],
})
export class GithubModule { }