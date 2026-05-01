import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { PullRequest } from './pull-request.entity';

export enum ReviewStatus {
    PENDING = 'pending',
    PROCESSING = 'processing',
    COMPLETED = 'completed',
    FAILED = 'failed',
}

@Entity('reviews')
@Index('idx_reviews_pull_request_id', ['pullRequestId'])
@Index('idx_reviews_status', ['status'])
export class Review {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'pull_request_id', type: 'uuid' })
    pullRequestId: string;

    // Cross-database bridge — MongoDB ObjectId as string (24 hex chars)
    @Column({ name: 'mongo_review_id', type: 'varchar', length: 24, nullable: true })
    mongoReviewId: string | null;

    @Column({
        type: 'varchar',
        length: 20,
        default: ReviewStatus.PENDING,
        enum: ReviewStatus,
    })
    status: ReviewStatus;

    // Denormalised counts — mirror of MongoDB findings array lengths.
    // Used for fast dashboard queries without touching MongoDB.
    @Column({ name: 'critical_count', type: 'integer', default: 0 })
    criticalCount: number;

    @Column({ name: 'warning_count', type: 'integer', default: 0 })
    warningCount: number;

    @Column({ name: 'suggestion_count', type: 'integer', default: 0 })
    suggestionCount: number;

    @Column({ name: 'praise_count', type: 'integer', default: 0 })
    praiseCount: number;

    @Column({ name: 'model_used', type: 'varchar', length: 50, nullable: true })
    modelUsed: string | null;

    @Column({ name: 'processing_time_ms', type: 'integer', nullable: true })
    processingTimeMs: number | null;

    // GitHub PR comment ID — used to edit the comment on re-review
    @Column({ name: 'github_comment_id', type: 'bigint', nullable: true })
    githubCommentId: string | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;

    // ─── Relations ───────────────────────────────────────────────
    @ManyToOne(() => PullRequest, (pr) => pr.reviews, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'pull_request_id' })
    pullRequest: PullRequest;
}