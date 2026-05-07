import {
    Injectable,
    Logger,
    InternalServerErrorException,
} from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import { InstallationTokenService } from './installation-token.service';

// ─── Response Shape Interfaces ─────────────────────────────────────────────
// These define exactly what callers receive back from this service.
// Keeping them here means callers import from one place — this file.

export interface RepositoryDetails {
    githubRepoId: string;
    fullName: string;
    defaultBranch: string;
    language: string | null;
    visibility: string;
    isPrivate: boolean;
}

export interface PostedComment {
    commentId: number;
    commentUrl: string;
}

// ─── Service ───────────────────────────────────────────────────────────────

@Injectable()
export class GithubApiService {
    private readonly logger = new Logger(GithubApiService.name);

    constructor(
        private readonly installationTokenService: InstallationTokenService,
    ) { }

    // ─── Public API ──────────────────────────────────────────────────────────

    /**
     * Fetches the raw unified diff for a pull request.
     *
     * Uses the application/vnd.github.diff Accept header — this tells
     * GitHub to return the raw diff string instead of JSON.
     *
     * The diff is what FastAPI receives for AI analysis in Sprint 2.
     * It can be large for big PRs — callers are responsible for
     * truncating before sending to the AI service.
     */
    async getPullRequestDiff(
        installationId: number,
        owner: string,
        repo: string,
        prNumber: number,
    ): Promise<string> {
        this.logger.log(
            `Fetching diff for PR #${prNumber} on ${owner}/${repo}`,
        );

        return this.withInstallationClient(installationId, async (octokit) => {
            const response = await octokit.request(
                'GET /repos/{owner}/{repo}/pulls/{pull_number}',
                {
                    owner,
                    repo,
                    pull_number: prNumber,
                    headers: {
                        // This header is the key — without it GitHub returns JSON
                        // metadata about the PR, not the actual diff content
                        accept: 'application/vnd.github.diff',
                    },
                },
            );

            // When GitHub returns a diff, the response data is a raw string
            const diff = response.data as unknown as string;

            if (!diff || diff.trim().length === 0) {
                this.logger.warn(
                    `Empty diff returned for PR #${prNumber} on ${owner}/${repo} — PR may have no file changes`,
                );
                return '';
            }

            this.logger.log(
                `Fetched diff for PR #${prNumber} — ${diff.length} characters`,
            );

            return diff;
        });
    }

    /**
     * Posts a review comment on a pull request.
     *
     * Uses the Issues comments API (not the PR review API) because
     * we are posting a top-level comment on the PR thread, not
     * individual line-level review comments. This matches how
     * GitHub Copilot and similar tools post their summaries.
     *
     * Returns the commentId — stored in PostgreSQL reviews.github_comment_id
     * so the worker can EDIT this comment (not post a new one) when
     * the PR is updated with new commits.
     */
    async postReviewComment(
        installationId: number,
        owner: string,
        repo: string,
        prNumber: number,
        body: string,
    ): Promise<PostedComment> {
        this.logger.log(
            `Posting review comment on PR #${prNumber} on ${owner}/${repo}`,
        );

        return this.withInstallationClient(installationId, async (octokit) => {
            const response = await octokit.rest.issues.createComment({
                owner,
                repo,
                // Issues and PRs share the same comment API in GitHub
                // PR numbers are issue numbers — this is correct
                issue_number: prNumber,
                body,
            });

            this.logger.log(
                `Posted comment ${response.data.id} on PR #${prNumber}`,
            );

            return {
                commentId: response.data.id,
                commentUrl: response.data.html_url,
            };
        });
    }

    /**
     * Updates an existing PR comment in place.
     *
     * Called when a developer pushes new commits to an open PR
     * (pull_request.synchronize event). Instead of posting a second
     * comment that clutters the PR thread, we edit the original one.
     *
     * Requires the commentId stored in reviews.github_comment_id.
     */
    async updateReviewComment(
        installationId: number,
        owner: string,
        repo: string,
        commentId: number,
        body: string,
    ): Promise<void> {
        this.logger.log(
            `Updating comment ${commentId} on ${owner}/${repo}`,
        );

        return this.withInstallationClient(installationId, async (octokit) => {
            await octokit.rest.issues.updateComment({
                owner,
                repo,
                comment_id: commentId,
                body,
            });

            this.logger.log(`Updated comment ${commentId} successfully`);
        });
    }

    /**
     * Fetches repository metadata from GitHub.
     *
     * Called by the webhook controller when an installation.created
     * event fires — we need the stable github_repo_id, default_branch,
     * and language to populate the repositories table in PostgreSQL.
     *
     * We use github_repo_id (not full_name) as our stable identifier
     * because repositories can be renamed — the ID never changes.
     */
    async getRepositoryDetails(
        installationId: number,
        owner: string,
        repo: string,
    ): Promise<RepositoryDetails> {
        this.logger.log(`Fetching repository details for ${owner}/${repo}`);

        return this.withInstallationClient(installationId, async (octokit) => {
            const response = await octokit.rest.repos.get({ owner, repo });
            const data = response.data;

            return {
                // toString() because our PostgreSQL column is VARCHAR(50)
                // GitHub repo IDs are numbers but we store them as strings
                githubRepoId: data.id.toString(),
                fullName: data.full_name,
                defaultBranch: data.default_branch,
                // language can be null for empty repos
                language: data.language ?? null,
                visibility: data.visibility ?? 'private',
                isPrivate: data.private,
            };
        });
    }

    // ─── Core Private Helper ─────────────────────────────────────────────────

    /**
     * The single place where Octokit instances are created and
     * where the retry-on-401 logic lives.
     *
     * Every public method delegates to this helper instead of
     * creating Octokit directly. This means:
     *
     * 1. Token fetching is always handled the same way
     * 2. 401 retry logic is written exactly once
     * 3. Error handling and logging are consistent
     * 4. Adding a new GitHub API method means writing zero
     *    token or retry boilerplate — just the API call itself
     *
     * The generic <T> means this works for any return type —
     * string (diff), PostedComment, RepositoryDetails, void, etc.
     */
    private async withInstallationClient<T>(
        installationId: number,
        fn: (octokit: Octokit) => Promise<T>,
    ): Promise<T> {
        // First attempt — use cached or fresh token
        const token =
            await this.installationTokenService.getInstallationToken(installationId);

        const octokit = this.createOctokitInstance(token);

        try {
            return await fn(octokit);
        } catch (err) {
            // ── 401 handling — token was revoked early by GitHub ──────────────
            // This happens rarely but must be handled:
            // - GitHub App permission changes can invalidate tokens early
            // - Security events on the installation can revoke tokens
            //
            // Strategy: invalidate the stale cached token, fetch a fresh one,
            // retry the operation exactly once. If it fails again, give up —
            // something is genuinely wrong beyond a stale token.
            if (this.isUnauthorizedError(err)) {
                this.logger.warn(
                    `401 received for installation ${installationId} — invalidating cache and retrying once`,
                );

                await this.installationTokenService.invalidateToken(installationId);

                const freshToken =
                    await this.installationTokenService.getInstallationToken(
                        installationId,
                    );
                const retryOctokit = this.createOctokitInstance(freshToken);

                try {
                    return await fn(retryOctokit);
                } catch (retryErr) {
                    this.logger.error(
                        `Retry also failed for installation ${installationId}`,
                        retryErr,
                    );
                    throw this.normalizeError(retryErr);
                }
            }

            // ── All other errors ───────────────────────────────────────────────
            this.logger.error(
                `GitHub API call failed for installation ${installationId}`,
                err,
            );
            throw this.normalizeError(err);
        }
    }

    // ─── Private Utilities ───────────────────────────────────────────────────

    /**
     * Creates a lightweight Octokit instance scoped to one token.
     * Called fresh per API call — Octokit instances are cheap to create.
     * Each installation gets its own correctly scoped instance.
     */
    private createOctokitInstance(token: string): Octokit {
        return new Octokit({ auth: token });
    }

    /**
     * Detects GitHub's 401 Unauthorized response.
     * Octokit throws a RequestError with status 401 for auth failures.
     */
    private isUnauthorizedError(err: unknown): boolean {
        return (
            typeof err === 'object' &&
            err !== null &&
            'status' in err &&
            (err as { status: number }).status === 401
        );
    }

    /**
     * Converts unknown errors into a consistent NestJS exception shape.
     *
     * We throw InternalServerErrorException so NestJS's exception filter
     * (which you built in Task 2) formats it consistently —
     * statusCode, timestamp, path, message.
     *
     * We preserve the original message so it appears in logs.
     */
    private normalizeError(err: unknown): InternalServerErrorException {
        const message =
            err instanceof Error ? err.message : 'Unknown GitHub API error';
        return new InternalServerErrorException(
            `GitHub API error: ${message}`,
        );
    }
}