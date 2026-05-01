import {
    Column,
    CreateDateColumn,
    Entity,
    OneToMany,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { TeamMember } from './team-member.entity';
import { GithubInstallation } from './github-installation.entity';
import { Repository } from './repository.entity';

export enum TeamPlan {
    FREE = 'free',
    PRO = 'pro',
    ENTERPRISE = 'enterprise',
}

@Entity('teams')
export class Team {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 255 })
    name: string;

    @Column({ name: 'github_org', type: 'varchar', length: 100, nullable: true })
    githubOrg: string | null;

    @Column({
        type: 'varchar',
        length: 20,
        default: TeamPlan.FREE,
        enum: TeamPlan,
    })
    plan: TeamPlan;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;

    // ─── Relations ───────────────────────────────────────────────
    @OneToMany(() => TeamMember, (member) => member.team)
    members: TeamMember[];

    @OneToMany(() => GithubInstallation, (inst) => inst.team)
    installations: GithubInstallation[];

    @OneToMany(() => Repository, (repo) => repo.team)
    repositories: Repository[];
}