import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Team } from './team.entity';
import { GithubInstallation } from './github-installation.entity';
import { PullRequest } from './pull-request.entity';
export enum IndexStatus {
  PENDING = 'pending',
  INDEXING = 'indexing',
  READY = 'ready',
  FAILED = 'failed',
}

@Entity('repositories')
@Index('idx_repositories_team_id', ['teamId'])
@Index('idx_repositories_installation_id', ['installationId'])
export class Repository {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'team_id', type: 'uuid' })
  teamId: string;

  @Column({ name: 'installation_id', type: 'uuid' })
  installationId: string;

  // GitHub's numeric repo ID — stable even if repo is renamed
  @Column({ name: 'github_repo_id', type: 'varchar', length: 50, unique: true })
  githubRepoId: string;

  @Column({ name: 'full_name', type: 'varchar', length: 255 })
  fullName: string;   // "org/repo-name"

  @Column({ name: 'default_branch', type: 'varchar', length: 100, default: 'main' })
  defaultBranch: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  language: string | null;

  @Column({
    name: 'index_status',
    type: 'varchar',
    length: 20,
    default: IndexStatus.PENDING,
    enum: IndexStatus,
  })
  indexStatus: IndexStatus;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'last_indexed_at', type: 'timestamp', nullable: true })
  lastIndexedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // ─── Relations ───────────────────────────────────────────────
  @ManyToOne(() => Team, (team) => team.repositories, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'team_id' })
  team: Team;

  @ManyToOne(() => GithubInstallation, (inst) => inst.repositories)
  @JoinColumn({ name: 'installation_id' })
  installation: GithubInstallation;

  @OneToMany(() => PullRequest, (pr) => pr.repository)
  pullRequests: PullRequest[];
}