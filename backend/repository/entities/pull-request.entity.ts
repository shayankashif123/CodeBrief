import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    OneToMany,
    PrimaryGeneratedColumn,
    Unique,
    UpdateDateColumn,
} from 'typeorm';
import { Repository } from './repository.entity';
import { Review } from './review.entity';

export enum PullRequestState {
    OPEN = 'open',
    CLOSED = 'closed',
    MERGED = 'merged',
}

@Entity('pull_requests')
@Unique(['repositoryId', 'prNumber'])    // PR #42 can exist in many repos — unique only per repo
@Index('idx_pull_requests_repository_id', ['repositoryId'])
@Index('idx_pull_requests_state', ['repositoryId', 'state'])
export class PullRequest {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'repository_id', type: 'uuid' })
    repositoryId: string;

    @Column({ name: 'pr_number', type: 'integer' })
    prNumber: number;

    @Column({ type: 'varchar', length: 500, nullable: true })
    title: string | null;

    @Column({ name: 'author_login', type: 'varchar', length: 100, nullable: true })
    authorLogin: string | null;

    @Column({
        type: 'varchar',
        length: 20,
        default: PullRequestState.OPEN,
        enum: PullRequestState,
    })
    state: PullRequestState;

    // Current HEAD commit SHA — changes when developer pushes new commits
    @Column({ name: 'head_sha', type: 'varchar', length: 40, nullable: true })
    headSha: string | null;

    @Column({ name: 'base_branch', type: 'varchar', length: 100, nullable: true })
    baseBranch: string | null;

    @Column({ name: 'opened_at', type: 'timestamp', nullable: true })
    openedAt: Date | null;

    @Column({ name: 'merged_at', type: 'timestamp', nullable: true })
    mergedAt: Date | null;     // only set when state = merged

    @Column({ name: 'closed_at', type: 'timestamp', nullable: true })
    closedAt: Date | null;     // set on close OR merge

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;

    // ─── Relations ───────────────────────────────────────────────
    @ManyToOne(() => Repository, (repo) => repo.pullRequests, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'repository_id' })
    repository: Repository;

    @OneToMany(() => Review, (review) => review.pullRequest)
    reviews: Review[];
}