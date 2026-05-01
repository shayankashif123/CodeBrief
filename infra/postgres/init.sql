-- Codebrief PostgreSQL initialization
-- This file runs once when the container is first created.
-- After that, migrations (via TypeORM/Drizzle) own schema changes.

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── users ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_id   VARCHAR(50)  UNIQUE NOT NULL,
  email       VARCHAR(255) UNIQUE NOT NULL,
  username    VARCHAR(100) NOT NULL,
  avatar_url  TEXT,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

-- ─── teams ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(255) NOT NULL,
  github_org  VARCHAR(100),
  plan        VARCHAR(20) NOT NULL DEFAULT 'free',
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

-- ─── team_members ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        VARCHAR(20) NOT NULL DEFAULT 'member',
  joined_at   TIMESTAMP DEFAULT NOW(),
  UNIQUE(team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);

-- ─── github_installations ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS github_installations (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id          UUID    NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  installation_id  BIGINT  UNIQUE NOT NULL,
  account_login    VARCHAR(100) NOT NULL,
  account_type     VARCHAR(20)  NOT NULL,
  is_active        BOOLEAN DEFAULT TRUE,
  installed_at     TIMESTAMP DEFAULT NOW(),
  uninstalled_at   TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_installations_team_id ON github_installations(team_id);

-- ─── repositories ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS repositories (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id          UUID         NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  installation_id  UUID         NOT NULL REFERENCES github_installations(id),
  github_repo_id   VARCHAR(50)  UNIQUE NOT NULL,
  full_name        VARCHAR(255) NOT NULL,
  default_branch   VARCHAR(100) NOT NULL DEFAULT 'main',
  language         VARCHAR(50),
  index_status     VARCHAR(20)  NOT NULL DEFAULT 'pending',
  is_active        BOOLEAN DEFAULT TRUE,
  last_indexed_at  TIMESTAMP,
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_repositories_team_id    ON repositories(team_id);
CREATE INDEX IF NOT EXISTS idx_repositories_installation_id ON repositories(installation_id);

-- ─── pull_requests ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pull_requests (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id  UUID         NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  pr_number      INTEGER      NOT NULL,
  title          VARCHAR(500),
  author_login   VARCHAR(100),
  state          VARCHAR(20)  NOT NULL DEFAULT 'open',
  head_sha       VARCHAR(40),
  base_branch    VARCHAR(100),
  opened_at      TIMESTAMP,
  merged_at      TIMESTAMP,
  closed_at      TIMESTAMP,
  created_at     TIMESTAMP DEFAULT NOW(),
  updated_at     TIMESTAMP DEFAULT NOW(),
  UNIQUE(repository_id, pr_number)
);

CREATE INDEX IF NOT EXISTS idx_pull_requests_repository_id ON pull_requests(repository_id);
CREATE INDEX IF NOT EXISTS idx_pull_requests_state         ON pull_requests(repository_id, state);

-- ─── reviews ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  pull_request_id     UUID        NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  mongo_review_id     VARCHAR(24),
  status              VARCHAR(20) NOT NULL DEFAULT 'pending',
  critical_count      INTEGER     DEFAULT 0,
  warning_count       INTEGER     DEFAULT 0,
  suggestion_count    INTEGER     DEFAULT 0,
  praise_count        INTEGER     DEFAULT 0,
  model_used          VARCHAR(50),
  processing_time_ms  INTEGER,
  github_comment_id   BIGINT,
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_pull_request_id ON reviews(pull_request_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status          ON reviews(status);

-- ─── updated_at trigger ───────────────────────────────────────
-- Automatically updates updated_at on every row change

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER trigger_teams_updated_at
  BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER trigger_repositories_updated_at
  BEFORE UPDATE ON repositories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER trigger_pull_requests_updated_at
  BEFORE UPDATE ON pull_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER trigger_reviews_updated_at
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();