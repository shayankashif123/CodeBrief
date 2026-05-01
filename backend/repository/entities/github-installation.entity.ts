import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Team } from './team.entity';
import { Repository } from './repository.entity';

@Entity('github_installations')
@Index('idx_installations_team_id', ['teamId'])
export class GithubInstallation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'team_id', type: 'uuid' })
  teamId: string;

  // GitHub's installation ID — BIGINT in postgres, use string to avoid JS precision loss
  @Column({ name: 'installation_id', type: 'bigint', unique: true })
  installationId: string;

  @Column({ name: 'account_login', type: 'varchar', length: 100 })
  accountLogin: string;

  @Column({ name: 'account_type', type: 'varchar', length: 20 })
  accountType: string;   // 'Organization' | 'User'

  // Soft delete — never hard delete installations
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'installed_at' })
  installedAt: Date;

  @Column({ name: 'uninstalled_at', type: 'timestamp', nullable: true })
  uninstalledAt: Date | null;

  // ─── Relations ───────────────────────────────────────────────
  @ManyToOne(() => Team, (team) => team.installations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'team_id' })
  team: Team;

  @OneToMany(() => Repository, (repo) => repo.installation)
  repositories: Repository[];
}