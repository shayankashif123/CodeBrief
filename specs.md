Codebrief — The Summary
The Platform
Codebrief sits between your GitHub repository and your engineering team as an intelligent layer that watches every code change.
Two Core Problems It Solves
Problem 1 — PR Review Without Codebase Context
Tools like GitHub Copilot only see the diff. They have no knowledge of who calls this function, what depends on it, or what the last 10 PRs touching this file did. Codebrief reviews every PR with full codebase knowledge — it understands the broader impact of a change, not just the lines that changed.
Problem 2 — Documentation That Is Always a Lie
Documentation is written once and never updated. It describes a system that no longer exists. Codebrief watches every merge, detects what changed, and updates the documentation automatically. Developers never manually maintain docs again.
The Invisible Problem It Fixes
Because documentation is now accurate and always up to date, new hires can onboard themselves. They ask questions, read real docs, understand real code — without pulling senior engineers away from their work for weeks.
The Workflow

Developer opens a PR on GitHub → Codebrief reviews it with codebase context → posts findings as a GitHub comment
PR merges → Codebrief detects what changed → updates the relevant documentation automatically


**USER FLOW**

## Codebrief — User Flows

We will trace every key journey from the user's perspective first, then we will map what happens technically behind the scenes. This way you understand both the product and the system simultaneously.

---

## Flow 1 — Onboarding Flow (First Time User)

This is the most critical flow. If this is broken or confusing, nothing else matters.

---

**Step 1 — Landing & Sign In**

User lands on Codebrief marketing page. They click **"Get Started"**. They are redirected to GitHub OAuth. They authorise Codebrief to read their GitHub profile and organisation membership. They land on the Codebrief dashboard for the first time.

What happens behind the scenes: NestJS handles the OAuth callback, creates a user record in PostgreSQL, issues a JWT access token and refresh token, stores refresh token in Redis.

---

**Step 2 — Install GitHub App**

Dashboard shows an empty state with one clear call to action — **"Connect a Repository"**. User clicks it. They are redirected to GitHub to install the Codebrief GitHub App on their account or organisation. They select which repositories to give Codebrief access to. They are redirected back to Codebrief.

This step is separate from OAuth and this distinction matters. OAuth gives us the user's identity. The GitHub App installation gives us webhook access and repository permissions. Two separate things, two separate flows.

---

**Step 3 — Repository Connected, Indexing Begins**

User lands back on the dashboard. They see their connected repository with a status indicator — **"Indexing in progress"**. Behind the scenes, NestJS has received the GitHub App installation webhook, created a repository record in PostgreSQL, and pushed a full indexing job to the Redis BullMQ queue. The FastAPI AI service picks up the job, clones the repository, chunks the code, generates embeddings, and stores them in Qdrant. This runs entirely in the background.

Depending on the repository size, indexing takes 2 to 10 minutes. The dashboard updates in real time via WebSocket when indexing completes.

---

**Step 4 — Indexing Complete, Platform Ready**

User sees the status change to **"Ready"**. The dashboard now shows repository overview — file count, language breakdown, documentation coverage percentage (likely 0% for a fresh repo). Codebrief is now watching this repository. Every PR, every merge will be processed automatically from this point forward.

---

## Flow 2 — PR Review Flow (The Core Flow)

This is what happens every single day once Codebrief is set up. This flow should feel invisible to the developer — they do nothing different, Codebrief just shows up.

---

**Step 1 — Developer Opens a PR**

Developer pushes a branch and opens a pull request on GitHub as they normally would. They write a PR title and description. They submit it. At this point the developer's action is complete — they go back to their work.

---

**Step 2 — Webhook Fires**

GitHub sends a `pull_request.opened` webhook to Codebrief's NestJS backend. NestJS validates the HMAC-SHA256 signature to confirm it is genuinely from GitHub. NestJS parses the payload, extracts the repository, PR number, author, base branch, and head SHA. It creates a PR review job and pushes it to the Redis BullMQ queue. It immediately responds 200 to GitHub — webhook handlers must respond fast, all heavy work goes to the queue.

---

**Step 3 — Review Job Picked Up**

The BullMQ queue worker in NestJS picks up the job. It fetches the full PR diff from GitHub API using the installation token. It identifies which files changed and what kind of changes — additions, deletions, modifications. It sends an internal HTTP request to the FastAPI AI service with the diff and repository metadata.

---

**Step 4 — Context Retrieval (The Differentiator)**

FastAPI receives the request. For each changed file it queries Qdrant — *"what code in this codebase is most semantically related to this change?"*. It retrieves the top K relevant chunks — functions that call the changed code, utilities it depends on, related modules. It ranks and filters the retrieved context to fit within the token budget. It builds the final prompt: PR diff + retrieved context + repository language and conventions + PR description.

---

**Step 5 — AI Review Generated**

FastAPI sends the prompt to Gemini 2.0 Flash. Gemini returns a structured review. FastAPI parses the response into a typed structure — a list of findings, each with a severity level, the file and line it refers to, a clear explanation, and a concrete suggestion. It stores the full review result in MongoDB. It returns the structured review to NestJS.

---

**Step 6 — Review Posted to GitHub**

NestJS receives the review from FastAPI. It formats the review into a well-structured GitHub PR comment — severity badges, code references, clear headings. It posts the comment to the PR using the GitHub API. The developer gets a GitHub notification — their PR has a new comment.

The developer opens the PR, sees the Codebrief review comment, reads the findings, addresses what they agree with, and pushes additional commits. If they push new commits, the `pull_request.synchronize` webhook fires and the entire flow repeats — the review updates automatically.

---

**Step 7 — Developer Sees Review**

From the developer's perspective: they opened a PR, got a coffee, came back, and there was a thorough code review waiting — with specific findings, line references, and suggestions. They did not change their workflow at all.

---

## Flow 3 — Documentation Update Flow (Post-Merge)

This flow is entirely invisible to the developer. It happens automatically after merge.

---

**Step 1 — PR Merges**

Developer and team are satisfied with the PR. It gets approved and merged into the main branch on GitHub.

---

**Step 2 — Merge Webhook Fires**

GitHub sends a `pull_request.closed` webhook with `merged: true`. NestJS validates and processes it. It pushes a documentation update job to the Redis queue — a separate queue from the review queue, with lower priority since this is not time sensitive.

---

**Step 3 — Semantic Change Analysis**

FastAPI picks up the documentation job. It fetches the merged diff. It does not just look at which lines changed — it analyses what semantically changed. Was a new function added? Was an existing API endpoint modified? Was a class deleted? Was a database model changed? This semantic understanding determines what documentation needs to change.

---

**Step 4 — Existing Documentation Retrieval**

FastAPI queries Qdrant and MongoDB to find existing documentation that references the changed code. It matches documentation sections to code files and functions. It identifies three categories — documentation that needs updating, documentation that is now outdated and should be flagged, and code that changed but has no documentation at all.

---

**Step 5 — Documentation Generated**

For each documentation change needed, FastAPI sends a generation request to Gemini. Gemini produces updated documentation. FastAPI stores the generated docs in MongoDB with status `pending_review`.

---

**Step 6 — Human Review Gate**

NestJS picks up the completed documentation job. Based on the team's configuration it takes one of two paths. If the team has enabled **manual review**, it creates a notification in the Codebrief dashboard — *"3 documentation sections were updated by the merge of PR #47, please review"*. If the team has enabled **auto-publish**, NestJS commits the updated docs directly to the `/docs` folder in the repository via GitHub API.

The default is manual review. Teams earn the right to auto-publish by trusting the output over time.

---

**Step 7 — Documentation is Now Accurate**

The documentation reflects the current state of the code. The next developer who reads it — whether a teammate or a new hire — gets accurate information.

---

## Flow 4 — Onboarding Assistant Flow (New Hire)

---

**Step 1 — New Hire Joins the Team**

Engineering manager adds them to the Codebrief team via the dashboard. New hire signs in with GitHub OAuth. They land on the dashboard and see the onboarding assistant prominently.

---

**Step 2 — New Hire Asks a Question**

They type into the chat — *"How does authentication work in this codebase?"*

---

**Step 3 — RAG Pipeline Runs**

NestJS forwards the question to FastAPI. FastAPI generates an embedding for the question. It queries Qdrant with the embedding — retrieving the most semantically relevant code chunks and documentation sections. It builds a prompt: the question + retrieved context + instruction to cite sources.

---

**Step 4 — Answer Generated and Cited**

Gemini generates a clear answer. The answer includes citations — specific file paths and function names that were used to construct the answer. FastAPI returns the answer and sources to NestJS. NestJS returns it to the frontend.

---

**Step 5 — New Hire Gets a Sourced Answer**

The chat interface displays the answer with clickable source references. The new hire can click a source to see the exact code or documentation section that backed the answer. They can ask follow-up questions — conversation history is maintained within the session.

Instead of spending three weeks asking senior engineers questions that break their flow, the new hire spends three days with the assistant and builds an accurate mental model independently.

---

## Flow 5 — Dashboard Monitoring Flow (Engineering Lead)

---

**Step 1 — Engineering Lead Opens Dashboard**

They see the repository health overview — documentation coverage, number of PRs reviewed this week, open PRs awaiting review, tech debt score trend.

---

**Step 2 — Investigates Tech Debt**

They click into tech debt — they see a breakdown by module. The payments module has accumulated 14 critical findings across the last 8 PRs. Nobody noticed because findings were spread across individual PR comments. Codebrief aggregated them. This is a conversation they can now have with the team backed by data.

---

**Step 3 — Reviews Pending Documentation**

They see 3 documentation sections flagged for review from the last merge. They read each one, make minor edits where needed, and approve them. The documentation is now live.

---

## The Flow Summary

| Flow | Trigger | Who Acts | Outcome |
|---|---|---|---|
| Onboarding | User signs up | Developer | Repository connected and indexed |
| PR Review | PR opened | Nobody (automatic) | Review posted as GitHub comment |
| Doc Update | PR merged | Nobody (automatic) | Docs updated, flagged for review |
| Onboarding Assistant | New hire asks | New hire | Accurate sourced answer |
| Dashboard Monitoring | Engineering lead checks in | Engineering lead | Team health visibility |

---

The two most important flows — PR review and documentation update — require **zero change in developer workflow**. That is a deliberate product decision and a strong interview talking point. The best developer tools are invisible.

---

User flows are now fully mapped. Shall we move into **system architecture** now — request lifecycle, service boundaries, data flow, and how all the pieces connect?




Codebrief — System Architecture
Let's build this layer by layer. First the high level picture, then we go deep into each layer.
Let's build this in three diagrams — high level overview first, then the PR review request lifecycle, then the async job pipeline. Each one tells a different part of the story.
Here is the high level system overview — every major component and how they relate to each other.
  ::view-transition-group(*),
  ::view-transition-old(*),
  ::view-transition-new(*) {
    animation-duration: 0.25s;
    animation-timing-function: cubic-bezier(0.19, 1, 0.22, 1);
  }
VvisualizeVvisualize show_widgetNow let's trace the two most critical request lifecycles in detail. First — what happens the moment a developer opens a PR.
  ::view-transition-group(*),
  ::view-transition-old(*),
  ::view-transition-new(*) {
    animation-duration: 0.25s;
    animation-timing-function: cubic-bezier(0.19, 1, 0.22, 1);
  }
VvisualizeVvisualize show_widgetThe timing column on the left is important — the webhook responds in under 2 seconds (GitHub requires this), and the actual AI review completes asynchronously around 35 seconds later. Now let's look at the async job pipeline — how the queue, workers, and two separate pipelines (review and documentation) coexist.
  ::view-transition-group(*),
  ::view-transition-old(*),
  ::view-transition-new(*) {
    animation-duration: 0.25s;
    animation-timing-function: cubic-bezier(0.19, 1, 0.22, 1);
  }
VvisualizeVvisualize show_widget
Key Architectural Decisions Explained
Why two separate queues? The review queue is time-sensitive — a developer is waiting for feedback on their PR. The doc-update queue is not — it runs after merge, nobody is blocked on it. Separating them means a surge of PR activity never delays documentation jobs starving review jobs, and vice versa. Different concurrency, different retry strategies, different priority. This is a real production pattern worth discussing in interviews.
Why does NestJS respond 200 immediately to GitHub? GitHub expects a webhook response within 10 seconds. If it doesn't get one, it retries and eventually marks your endpoint as failing. All heavy work — diff fetching, AI calls, GitHub comment posting — goes to the queue. The webhook controller does one thing: validate the signature, enqueue the job, return 200. That's it.
Why does FastAPI serve both pipelines? FastAPI is stateless — it receives a request, does the AI work, returns a result. It does not care whether the caller is a review worker or a doc-update worker. This keeps the AI service clean and horizontally scalable. If review load spikes, you spin up more review workers. FastAPI scales independently.
Why is NestJS the only service that talks to GitHub? Only one service should hold GitHub installation tokens and know how to refresh them. Putting that logic in FastAPI too would mean duplicating token management, which introduces inconsistency. NestJS owns the GitHub relationship. FastAPI only knows about code and AI.
The service boundary rule — NestJS owns orchestration, FastAPI owns intelligence. NestJS decides what to do and when. FastAPI decides how to analyse it. This boundary makes each service testable, replaceable, and independently scalable.

NestJS Module Breakdown
Inside the NestJS backend, these are the bounded modules:
ModuleResponsibilityAuthModuleGitHub OAuth, JWT, refresh tokens, Redis sessionGithubModuleWebhook ingestion, signature validation, GitHub API client, token refreshRepositoryModuleRepo records, indexing status, installation managementReviewModuleBullMQ review queue, review worker, review storage interfaceDocumentationModuleBullMQ doc queue, doc worker, documentation storage interfaceOnboardingModuleChat session management, RAG query proxy to FastAPIAnalyticsModuleTech debt aggregation, dashboard metricsWebsocketModuleReal-time status updates to frontend during indexing and review

FastAPI Service Structure
Inside FastAPI, four clean service layers:
EmbeddingService — generates embeddings via Google text-embedding-004, handles batching and rate limits.
IndexingService — clones repos, walks files, chunks by logical unit (function/class), calls EmbeddingService, writes to Qdrant.
ReviewService — receives diff + repo metadata, queries Qdrant, builds prompt, calls Gemini, parses structured review output.
DocumentationService — receives merged diff, performs semantic change analysis, retrieves related docs, generates updated documentation via Gemini.

Data Architecture Summary
StoreWhat lives thereWhyPostgreSQLUsers, teams, repos, PRs, review metadata, installationsRelational, consistent, transactionalMongoDBFull review JSON, generated documentation contentSchemaless — AI output structure evolvesRedisBullMQ job queues, JWT refresh tokens, indexing status cacheFast, ephemeral, pub/sub capableQdrantCode chunk embeddings with metadataPurpose-built vector similarity search

This is a complete, production-grade system architecture. Every decision has a reason. 

PostgreSQL is our source of truth for everything structured and relational. Users, teams, repositories, PRs, reviews — anything with clear relationships and consistency requirements lives here.
Think of it like this. Every entity in our system is a noun. Every relationship between entities is a verb. Tables are nouns. Foreign keys are verbs.
Let's walk through every table, one at a time.

Table 1 — users
This is the simplest table. One row per person who signs into Codebrief.
sqlCREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_id       VARCHAR(50) UNIQUE NOT NULL,
  email           VARCHAR(255) UNIQUE NOT NULL,
  username        VARCHAR(100) NOT NULL,
  avatar_url      TEXT,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);
Why each field exists:
id is our internal identifier. UUID not integer — because integers leak information (user 1, user 2 tells attackers how many users you have) and UUIDs can be generated in application code without a database round trip.
github_id is GitHub's identifier for this person. This never changes even if they change their username. This is the field we match on when GitHub sends us webhook events — not email, not username, because both of those can change. This field has a UNIQUE constraint because one GitHub account maps to exactly one Codebrief account.
email and username come from GitHub OAuth. We store them for display purposes.
avatar_url is optional — just for showing profile pictures in the dashboard.
created_at and updated_at — every table should have these. Non-negotiable. You will always want to know when a record was created and last modified for debugging, auditing, and support.
What this table does NOT store: passwords (we use GitHub OAuth, no passwords), access tokens (those go in Redis — they expire and change frequently, no point polluting the database).

Table 2 — teams
A team is the organisational unit in Codebrief. When a company signs up, they create a team. All their repositories, members, and settings belong to that team.
sqlCREATE TABLE teams (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(255) NOT NULL,
  github_org      VARCHAR(100),
  plan            VARCHAR(20) NOT NULL DEFAULT 'free',
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);
Why each field exists:
name is the display name — "Acme Engineering", "My Personal Team".
github_org is the GitHub organisation login this team maps to — "acme-corp". This can be null because a solo developer might install Codebrief on personal repos without an organisation.
plan is free, pro, or enterprise. This is your feature gate. When a user tries to connect more than 3 repositories, you check this field. When they try to access analytics, you check this field. Simple string enum for now — in production this would link to a billing/subscriptions table.
What this table does NOT store: members (that is a separate join table), repositories (that is a separate table with a foreign key), settings (those go in a JSON column on this table or a separate team_settings table).
Design decision worth noting: One user can belong to multiple teams. One team can have multiple users. This is a many-to-many relationship — which is exactly why we need the next table.

Table 3 — team_members
This is a junction table. It exists purely to resolve the many-to-many relationship between users and teams. But it carries extra data — the role.
sqlCREATE TABLE team_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            VARCHAR(20) NOT NULL DEFAULT 'member',
  joined_at       TIMESTAMP DEFAULT NOW(),

  UNIQUE(team_id, user_id)
);
Why each field exists:
team_id and user_id are foreign keys — they point to the teams and users tables. The REFERENCES keyword enforces referential integrity at the database level. You cannot insert a team_id here that does not exist in the teams table. The database enforces this, not just your application code.
ON DELETE CASCADE means if a team is deleted, all its team_member rows are automatically deleted too. No orphaned records.
role is owner, admin, or member. Owner can delete the team, manage billing, manage GitHub App installations. Admin can connect repositories, manage settings. Member can view everything but change nothing.
UNIQUE(team_id, user_id) is a composite unique constraint. This prevents the same user being added to the same team twice. Without this, a bug in your code could insert duplicate rows and you would never know.
How this links to everything: Every time you load the dashboard, your query goes through this table — "give me all repositories belonging to teams where this user_id is a member." This table is in almost every query. Index it properly.
sqlCREATE INDEX idx_team_members_user_id ON team_members(user_id);
CREATE INDEX idx_team_members_team_id ON team_members(team_id);

Table 4 — github_installations
This table is what separates junior developers from senior ones in interviews. Most people forget it exists.
When a user installs your GitHub App on their organisation, GitHub gives you an installation_id. This is separate from the user's OAuth token. You need this installation ID to generate tokens that allow you to read repositories, post comments on PRs, and receive webhooks — on behalf of the installed organisation, not on behalf of any individual user.
sqlCREATE TABLE github_installations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id           UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  installation_id   BIGINT UNIQUE NOT NULL,
  account_login     VARCHAR(100) NOT NULL,
  account_type      VARCHAR(20) NOT NULL,
  is_active         BOOLEAN DEFAULT TRUE,
  installed_at      TIMESTAMP DEFAULT NOW(),
  uninstalled_at    TIMESTAMP
);
Why each field exists:
installation_id is GitHub's ID — a BIGINT because GitHub uses large integers. UNIQUE because one installation maps to exactly one record in our system.
account_login is the GitHub organisation or username this app was installed on — "acme-corp".
account_type is Organization or User — GitHub tells you this in the webhook payload when the app is installed.
is_active and uninstalled_at handle the case where a user uninstalls the GitHub App. When GitHub sends the installation.deleted webhook, we do not delete this record — we set is_active = false and record uninstalled_at. This is called a soft delete and it preserves historical data. If they reinstall later, we can restore their configuration.
The critical relationship: One team can have multiple installations — a company might install the app on both their main org and a subsidiary org. One installation covers multiple repositories. This is why repositories has a foreign key pointing here.

Table 5 — repositories
One row per GitHub repository that has been connected to Codebrief.
sqlCREATE TABLE repositories (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id             UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  installation_id     UUID NOT NULL REFERENCES github_installations(id),
  github_repo_id      VARCHAR(50) UNIQUE NOT NULL,
  full_name           VARCHAR(255) NOT NULL,
  default_branch      VARCHAR(100) NOT NULL DEFAULT 'main',
  language            VARCHAR(50),
  index_status        VARCHAR(20) NOT NULL DEFAULT 'pending',
  is_active           BOOLEAN DEFAULT TRUE,
  last_indexed_at     TIMESTAMP,
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW()
);
Why each field exists:
team_id — which team owns this repository.
installation_id — which GitHub App installation gives us access to this repository. We need this to know which installation token to use when making GitHub API calls for this repo.
github_repo_id — GitHub's numeric ID for the repository. We use this as the stable identifier, not the full_name, because repositories can be renamed. If "acme-corp/api" is renamed to "acme-corp/backend", the github_repo_id stays the same. Build on the stable identifier.
full_name is "org/repo-name" — used for display and for constructing GitHub API URLs.
default_branch — we only trigger documentation updates when code merges to this branch.
language — the primary language detected during indexing. Used to give the AI model hints about what it is reviewing.
index_status — this is the field the frontend watches. It goes through these states in order: pending → indexing → ready. If something fails: failed. This drives the real-time status indicator in the dashboard via WebSocket.
last_indexed_at — when was the codebase last fully or incrementally re-indexed. Useful for debugging and for deciding if an index is stale.

Table 6 — pull_requests
One row per pull request that Codebrief has seen on a connected repository.
sqlCREATE TABLE pull_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id     UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  pr_number         INTEGER NOT NULL,
  title             VARCHAR(500),
  author_login      VARCHAR(100),
  state             VARCHAR(20) NOT NULL DEFAULT 'open',
  head_sha          VARCHAR(40),
  base_branch       VARCHAR(100),
  opened_at         TIMESTAMP,
  merged_at         TIMESTAMP,
  closed_at         TIMESTAMP,
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW(),

  UNIQUE(repository_id, pr_number)
);
Why each field exists:
pr_number is GitHub's PR number within that repository — 1, 2, 3... Note this is not globally unique — PR #42 can exist in every repository. That is why the unique constraint is composite: UNIQUE(repository_id, pr_number). Together they are unique. Separately they are not.
head_sha is the commit SHA at the tip of the PR branch. This is critical — when a developer pushes new commits to a PR, the SHA changes, and we use this to detect that we need to re-review. Two review jobs for the same PR but different SHAs means the PR was updated.
state is open, closed, or merged. GitHub sends separate events for close and merge — we distinguish them.
base_branch — the branch this PR wants to merge into. We only trigger documentation updates if this matches repositories.default_branch.
merged_at and closed_at are separate because a PR can be closed without merging. We only run the documentation pipeline when merged_at is set.
The composite unique index: This also becomes a useful query index. "Give me all open PRs for this repository" — WHERE repository_id = ? AND state = 'open' — hits the composite index efficiently.

Table 7 — reviews
One row per AI review generated. This is the bridge between PostgreSQL and MongoDB.
sqlCREATE TABLE reviews (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pull_request_id     UUID NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  mongo_review_id     VARCHAR(24),
  status              VARCHAR(20) NOT NULL DEFAULT 'pending',
  critical_count      INTEGER DEFAULT 0,
  warning_count       INTEGER DEFAULT 0,
  suggestion_count    INTEGER DEFAULT 0,
  praise_count        INTEGER DEFAULT 0,
  model_used          VARCHAR(50),
  processing_time_ms  INTEGER,
  github_comment_id   BIGINT,
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW()
);
Why each field exists:
mongo_review_id is the _id from the MongoDB reviews collection as a string. This is your cross-database link. When NestJS needs to show the full review findings, it first fetches this row from Postgres, gets the mongo_review_id, then queries MongoDB with it. Two queries, two databases, joined at the application layer.
status tracks the review lifecycle — pending (job queued), processing (FastAPI working on it), completed (comment posted), failed (something went wrong).
critical_count, warning_count, suggestion_count, praise_count — this is deliberate denormalisation. The real counts live inside the MongoDB document in the findings array. But copying the summary counts into Postgres means you can answer dashboard queries like "show me all repositories with more than 5 critical findings this month" with a single fast SQL query, without touching MongoDB at all. The cost is that you must keep these in sync with the MongoDB document. The benefit is query speed.
processing_time_ms — how long the entire review pipeline took. This is your performance monitoring data. Over time you can graph this and spot regressions.
github_comment_id — the ID of the GitHub PR comment we posted. You need this if you want to edit the comment later (for example when the PR is updated and you generate a new review — you update the existing comment rather than posting a new one).

How Everything Links Together
Here is the chain of ownership — read this from top to bottom:
A user joins a team through team_members. That team has a github_installation. That installation covers multiple repositories. Each repository receives many pull_requests. Each pull request gets a review. The review has a mongo_review_id that points to the full findings in MongoDB.
Every single query in the application follows a path through this chain. And every query is scoped by team_id — this is your multi-tenancy guarantee. A user from Team A can never accidentally see data from Team B because every query filters by team membership first.

What We Are Not Building Yet — But Should Know About
For a complete production system, you would also have these tables. You do not need them for the MVP but you should mention them in interviews to show you are thinking ahead:
team_settings — configuration per repository, which branches to watch, review strictness level, auto-publish docs or manual review, file patterns to ignore.
documentation_records — a Postgres mirror of documentation metadata from MongoDB, similar to how reviews mirrors review summary data. For fast dashboard queries about documentation coverage.
audit_logs — every significant action (repository connected, review generated, documentation published) logged with who did it and when. Required for enterprise customers.
invitations — when an admin invites a new team member by email, before they have signed in.

The Three Design Principles Behind Everything
Every decision in this schema follows three rules you should articulate in interviews.
The first is stability over convenience. We use github_id and github_repo_id as stable identifiers, not usernames or repo names — because GitHub allows renaming. Build on what cannot change.
The second is soft deletes over hard deletes. When a GitHub App is uninstalled or a repository is disconnected, we set is_active = false and record a timestamp. We never delete the row. Historical data — reviews, PRs — must remain intact even if the connection is severed.
The third is summary data belongs in Postgres, full data belongs in MongoDB. The critical_count in the reviews table and the full findings array in MongoDB are intentionally duplicated. One is for fast querying. One is for complete display. This is a classic read optimisation pattern called a materialised summary.




MongoDB — Why We Are Here
Before diving into collections, understand why these specific things live in MongoDB and not PostgreSQL.
AI generated output has no fixed shape. A review generated today might have 5 fields per finding. Three months from now after you improve your prompting, it might have 8 fields. If this lived in PostgreSQL, every prompt improvement would require a database migration — ALTER TABLE, deploy, migrate existing rows. That is painful.
MongoDB lets the shape evolve. You improve your prompt, the new findings have extra fields, old findings do not — and nothing breaks. The database does not enforce a rigid schema here. Your application code handles the difference.
That is the real reason. Not "NoSQL is cool." Schema flexibility for AI output that evolves over time.

MongoDB Collection 1 — reviews
This is the most important collection. Every AI code review lives here in full detail.
javascript{
  _id: ObjectId("64f1a2b3c4d5e6f7a8b9c0d1"),
  
  // Bridge back to PostgreSQL
  postgres_review_id: "uuid-from-reviews-table",
  postgres_repo_id: "uuid-from-repositories-table",

  // Context snapshot at review time
  pull_request: {
    repo_full_name: "acme-corp/payments-service",
    pr_number: 142,
    pr_title: "Add retry logic to payment processor",
    author_login: "john_dev",
    head_sha: "a3f8c2d1",
    base_branch: "main",
    description: "This PR adds exponential backoff..."
  },

  // The actual review — this is what appears in GitHub comment
  findings: [
    {
      id: "uuid",
      severity: "critical",
      category: "security",
      file_path: "src/payments/processor.ts",
      line_start: 84,
      line_end: 91,
      title: "Unvalidated input passed to database query",
      explanation: "The userId parameter on line 84 is interpolated 
                    directly into the SQL string without sanitisation. 
                    This is a classic SQL injection vulnerability.",
      suggestion: "Use parameterised queries instead. Replace with: 
                   await db.query('SELECT * FROM users WHERE id = $1', 
                   [userId])",
      code_snippet: "const result = await db.query(`SELECT * FROM 
                     users WHERE id = ${userId}`)",
      affected_by_context: true,
      context_sources: [
        {
          file_path: "src/db/client.ts",
          symbol_name: "query",
          relevance_score: 0.94
        },
        {
          file_path: "src/auth/middleware.ts", 
          symbol_name: "extractUserId",
          relevance_score: 0.87
        }
      ]
    },
    {
      id: "uuid",
      severity: "warning",
      category: "performance",
      file_path: "src/payments/processor.ts",
      line_start: 120,
      line_end: 134,
      title: "N+1 query inside retry loop",
      explanation: "...",
      suggestion: "...",
      code_snippet: "...",
      affected_by_context: true,
      context_sources: []
    }
  ],

  // Summary — mirrors the counts in PostgreSQL reviews table
  summary: {
    overall_assessment: "This PR introduces a critical security 
                          vulnerability that must be fixed before 
                          merging. The retry logic itself is sound 
                          but has a performance concern.",
    verdict: "request_changes",
    critical_count: 1,
    warning_count: 1,
    suggestion_count: 3,
    praise_count: 1,
    estimated_review_time_saved: "25 minutes"
  },

  // RAG pipeline metadata — for debugging and improving retrieval
  rag_metadata: {
    chunks_retrieved: 20,
    chunks_used: 8,
    retrieval_strategy: "semantic_similarity",
    embedding_model: "text-embedding-004",
    total_context_tokens: 3840
  },

  // LLM metadata — for cost tracking and debugging
  llm_metadata: {
    model: "gemini-2.0-flash",
    prompt_tokens: 4820,
    completion_tokens: 1240,
    total_tokens: 6060,
    processing_time_ms: 8400,
    temperature: 0.2
  },

  // GitHub delivery confirmation
  github: {
    comment_id: 1847392810,
    comment_url: "https://github.com/acme-corp/payments-service/pull/142#issuecomment-...",
    posted_at: ISODate("2025-04-25T10:32:14Z")
  },

  created_at: ISODate("2025-04-25T10:31:06Z")
}
Walking through the important design decisions:
postgres_review_id and postgres_repo_id are your bridges back to PostgreSQL. When your NestJS backend fetches a review, it first queries the reviews table in Postgres to get the mongo_review_id, then comes here with that ID. Going the other direction — when you are already in MongoDB and need to know which team owns this review — you use postgres_repo_id to join back.
context_sources inside each finding is the most interview-worthy field in this entire schema. It records exactly which files from the codebase Qdrant retrieved that influenced this specific finding. This does two things: it powers the citation UI ("this finding is based on analysis of src/db/client.ts"), and it gives you a debugging trail when a review seems wrong. You can look at what context was retrieved and understand why the AI said what it said.
rag_metadata is your AI pipeline observability. How many chunks did we retrieve? How many did we actually use after filtering? What was the token cost of the context? Over time this data tells you whether your retrieval is efficient or wasteful.
llm_metadata is your cost tracking. You are on a free tier now but when Codebrief has real users, you need to know exactly how many tokens each review consumes. This is how you build a pricing model. A review that consistently uses 6000 tokens costs differently than one that uses 12000.
verdict inside summary drives an important UI decision. request_changes, approve, or comment. This mirrors GitHub's own review verdict options. In the future you could use this to automatically request changes on GitHub if a critical finding is detected.

MongoDB Collection 2 — documentation
Every documentation update generated after a PR merge lives here.
javascript{
  _id: ObjectId("64f1a2b3c4d5e6f7a8b9c0d2"),

  // Bridge to PostgreSQL
  postgres_repo_id: "uuid-from-repositories-table",

  // What triggered this documentation update
  trigger: {
    pr_number: 142,
    pr_title: "Add retry logic to payment processor",
    merged_by: "senior_dev",
    merge_sha: "b4c9d2e3",
    merged_at: ISODate("2025-04-25T11:00:00Z")
  },

  // Publication state
  status: "pending_review",
  
  // Individual documentation sections updated or created
  sections: [
    {
      id: "uuid",
      type: "function",
      change_type: "updated",
      file_path: "src/payments/processor.ts",
      symbol_name: "processPaymentWithRetry",
      
      // What it said before this PR merged
      previous_content: "## processPayment\n\nProcesses a payment 
                          for the given order. Returns a Result 
                          object indicating success or failure.",
      
      // What it says now after the PR
      updated_content: "## processPaymentWithRetry\n\nProcesses a 
                         payment with exponential backoff retry logic. 
                         Attempts up to 3 retries with delays of 1s, 
                         2s, and 4s. Returns a Result object. Throws 
                         PaymentExhaustedError after all retries fail.",
      
      // Human review state for this specific section
      review_state: "pending",
      reviewed_by: null,
      reviewed_at: null,
      reviewer_edits: null
    },
    {
      id: "uuid",
      type: "api_endpoint",
      change_type: "created",
      file_path: "src/payments/routes.ts",
      symbol_name: "POST /payments/retry",
      previous_content: null,
      updated_content: "## POST /payments/retry\n\n...",
      review_state: "approved",
      reviewed_by: "uuid-of-senior-dev",
      reviewed_at: ISODate("2025-04-25T12:00:00Z"),
      reviewer_edits: "Changed the description of the timeout param"
    }
  ],

  // Coverage analysis from this update
  coverage_delta: {
    newly_documented: 2,
    updated: 1,
    now_stale: 0,
    undocumented_symbols_found: 3
  },

  // LLM metadata
  llm_metadata: {
    model: "gemini-2.0-flash",
    total_tokens: 3200,
    processing_time_ms: 6100
  },

  created_at: ISODate("2025-04-25T11:04:00Z"),
  published_at: null
}
Walking through the important decisions:
status at the document level is the overall publication state — pending_review, partially_approved, fully_approved, auto_published, rejected. This is what the dashboard shows the engineering lead. Each individual section inside sections has its own review_state — pending, approved, rejected. The overall document status is derived from the individual section states.
previous_content and updated_content together are what make the documentation review UI powerful. The engineering lead sees a side-by-side diff — left side is what the doc said before, right side is what the AI generated. They can approve, reject, or directly edit the updated_content before publishing. This is the human-in-the-loop design.
reviewer_edits is a free text field recording what the human changed. Over time this data is training signal — if humans consistently correct the AI in a specific way, you can update your prompt to address it.
coverage_delta answers an important product question — is our documentation coverage going up or down over time? undocumented_symbols_found tells you that during this merge analysis, the AI discovered 3 functions that have never been documented. This feeds the documentation coverage percentage on the dashboard.

MongoDB Collection 3 — codebase_snapshots
This collection tracks the state of the codebase at each indexing event.
javascript{
  _id: ObjectId("64f1a2b3c4d5e6f7a8b9c0d3"),

  postgres_repo_id: "uuid",
  
  snapshot_type: "full" | "incremental",
  trigger_sha: "a3f8c2d1",
  trigger_type: "initial_index" | "pr_merge" | "manual",

  // File inventory at time of indexing
  file_stats: {
    total_files: 847,
    indexed_files: 612,
    skipped_files: 235,
    total_chunks: 4821,
    languages: {
      "typescript": 380,
      "python": 180,
      "sql": 52
    }
  },

  // Which files changed in this incremental index
  changed_files: [
    "src/payments/processor.ts",
    "src/payments/routes.ts"
  ],

  // Files intentionally skipped
  skipped_reasons: {
    "node_modules/": "excluded_pattern",
    "dist/": "excluded_pattern",
    "*.test.ts": "test_files_excluded"
  },

  indexing_duration_ms: 142000,
  embedding_tokens_used: 284000,
  status: "completed",
  
  created_at: ISODate("2025-04-25T10:00:00Z"),
  completed_at: ISODate("2025-04-25T10:02:22Z")
}
Why this collection exists:
This is your indexing audit trail. When a developer says "the review for my PR seems wrong, it referenced old code" — you look here. You can see exactly what was indexed, when, from which commit. You can see if the incremental index after their last merge actually ran and completed. Without this collection, debugging RAG quality is guesswork.
embedding_tokens_used matters for cost tracking — embedding generation consumes API quota. Knowing how many tokens each indexing event consumes tells you what the real infrastructure cost of supporting a large repository is.

Redis — Complete Key Design
Redis is your fast ephemeral layer. Nothing in Redis is source of truth — if Redis is wiped clean, your application recovers by rebuilding from PostgreSQL and MongoDB. Every key should be designed with this in mind.
# ─── Authentication ───────────────────────────────────────────

# JWT refresh tokens — one per user session
refresh:{user_id}:{session_id}  →  "signed_refresh_token_string"
TTL: 30 days
Why session_id: a user can be logged in from multiple devices. Each device
gets its own session. Revoking one session does not log them out everywhere.

# ─── GitHub Token Cache ───────────────────────────────────────

# Installation access tokens — cached to avoid refetching every request
gh_install_token:{installation_id}  →  "ghs_xxxxxxxxxxxx"
TTL: 55 minutes
Why 55 not 60: GitHub tokens expire at 60 minutes. 5 minute buffer means
we never serve an expired token even with clock skew.

# ─── Job Queue (managed by BullMQ) ───────────────────────────

bull:pr-review:{job_id}         →  job metadata
bull:doc-update:{job_id}        →  job metadata  
bull:indexing:{job_id}          →  job metadata
TTL: managed by BullMQ automatically

# ─── Real-time Indexing Progress ──────────────────────────────

# Frontend polls this via WebSocket during initial repo indexing
index_progress:{repo_id}  →  JSON string
TTL: 2 hours

Example value:
{
  "status": "indexing",
  "files_processed": 234,
  "files_total": 612,
  "current_file": "src/payments/processor.ts",
  "started_at": "2025-04-25T10:00:00Z",
  "estimated_completion": "2025-04-25T10:02:30Z"
}

Why Redis not WebSocket directly: The indexing runs in the FastAPI 
service. The WebSocket connection is held by NestJS. Redis is the 
message bus between them. FastAPI writes progress. NestJS reads 
it and pushes to the browser.

# ─── Rate Limiting ────────────────────────────────────────────

# GitHub API calls per installation per hour
gh_rate:{installation_id}  →  "247"
TTL: 1 hour, reset at the top of each hour

# Codebrief API rate limiting per user
api_rate:{user_id}:{endpoint}:{window}  →  "12"
TTL: 60 seconds sliding window

# ─── Review Status Cache ──────────────────────────────────────

# Avoid duplicate review jobs for the same PR and SHA
review_lock:{repo_id}:{pr_number}:{head_sha}  →  "processing"
TTL: 10 minutes

Why this exists: GitHub sometimes sends duplicate webhooks. Without this
lock, you could process the same PR twice and post two identical GitHub 
comments. This key acts as an idempotency guard. Before enqueuing a 
review job, check if this key exists. If it does, skip. If not, set it
then enqueue.

# ─── Dashboard Cache ──────────────────────────────────────────

# Expensive analytics queries cached for the dashboard
dashboard:{team_id}  →  JSON with metrics
TTL: 5 minutes

# Documentation coverage percentage per repository
doc_coverage:{repo_id}  →  "67.4"
TTL: 1 hour, invalidated on new documentation update
The idempotency lock deserves extra attention. GitHub's webhook delivery is at-least-once, not exactly-once. Under network instability, GitHub will retry webhook delivery. Without the review_lock key, a retry means two review jobs, two AI calls, two GitHub comments on the same PR — which looks embarrassing and wastes your API quota. This Redis key prevents that. It is a simple but critical production pattern.

Qdrant — Vector Database Design
Qdrant stores embeddings. Everything here exists to make one operation fast — given a piece of code (the diff), find the most similar code in the codebase.
We use one collection for all repositories. Filtering by repository_id scopes searches to the right codebase.
python# Collection name: codebase_chunks
# Vector dimensions: 768 (text-embedding-004 output size)
# Distance metric: Cosine similarity

# Each point in the collection:
{
  "id": "uuid-v4",

  "vector": [0.023, -0.187, 0.441, 0.009, ...],  # 768 floats

  "payload": {

    # Filtering fields — these narrow the search space
    "repository_id": "uuid",           # always filter by this first
    "language": "typescript",          # filter by language when relevant
    "chunk_type": "function",          # function | class | module | interface

    # Location fields — for citing sources in the review
    "file_path": "src/payments/processor.ts",
    "symbol_name": "processPayment",
    "start_line": 42,
    "end_line": 89,

    # The actual code — returned with search results
    "content": "async function processPayment(order: Order): Promise<Result> {
                  const result = await stripe.charges.create({...})
                  ...",

    # Relationship fields — for understanding code structure
    "imports": ["stripe", "Order", "Result", "db"],
    "exported": true,
    "calls": ["stripe.charges.create", "db.insert"],
    "called_by": ["processOrder", "retryPayment"],

    # Freshness fields — for managing stale embeddings
    "commit_sha": "a3f8c2d1",
    "indexed_at": "2025-04-25T10:00:00Z"
  }
}
Walking through every payload field:
repository_id as a filter is the most important field here. Without it, a search for "payment processing code" would return results from every repository on the platform — code from one company mixed with another's. Every single Qdrant query filters by repository_id first. This is also your data isolation guarantee.
chunk_type lets you make intelligent retrieval decisions. When reviewing a PR that changed a function, you probably want to retrieve other functions that call it — not module-level documentation chunks. You can filter chunk_type = "function" to stay focused.
calls and called_by are the call graph in payload form. When a PR changes processPayment, you query Qdrant for all chunks where called_by contains "processPayment". This gives you the downstream impact — who calls this function that might be affected by the change. This is the codebase context that GitHub Copilot cannot provide because it does not maintain this graph.
imports helps detect breaking changes. If processPayment changes its signature and 14 files import it, those 14 files need to be checked. You find them by querying for chunks where imports contains "processPayment".
commit_sha is how you manage stale embeddings. When a PR merges, you know which files changed from the diff. For each changed file, you delete the old Qdrant points (filter by repository_id and file_path) and insert new ones with the updated commit_sha. Files that were not touched keep their existing embeddings. This is the incremental re-indexing strategy — efficient and accurate.

How All Four Stores Work Together — One Complete Example
Let's trace the data flow for a single PR review end to end, touching every store:
1. PR webhook arrives. NestJS checks review_lock:{repo_id}:{pr_number}:{sha} in Redis. Key does not exist — safe to proceed. Sets the key with 10 minute TTL.
2. NestJS queries PostgreSQL repositories table to get team context and confirm the repo is active and indexed. Fetches GitHub installation token from Redis cache (gh_install_token:{installation_id}).
3. NestJS fetches PR diff from GitHub API using cached token. Inserts a row into PostgreSQL pull_requests and reviews (status: processing).
4. NestJS sends diff to FastAPI. FastAPI generates an embedding of the diff, queries Qdrant filtered by repository_id, gets back 20 relevant code chunks.
5. FastAPI builds prompt with diff plus retrieved chunks. Calls Gemini. Receives structured review JSON.
6. FastAPI inserts full review document into MongoDB reviews collection. Returns the MongoDB _id to NestJS.
7. NestJS updates the PostgreSQL reviews row — sets mongo_review_id, updates critical_count, warning_count, changes status to completed.
8. NestJS posts formatted review comment to GitHub PR. Updates github_comment_id in PostgreSQL.
9. NestJS publishes a WebSocket event to the frontend — review complete for PR #142. Frontend updates in real time.

Complete Store Responsibility Summary
WhatWhereWhyUser identityPostgreSQLRelational, consistentTeam membershipPostgreSQLTransactional, foreign keysRepository statePostgreSQLStructured, queryablePR metadataPostgreSQLStructured, queryableReview summariesPostgreSQLFast dashboard queriesFull review findingsMongoDBSchema evolves with promptsGenerated documentationMongoDBFlexible structureIndexing audit trailMongoDBVariable structure per runJWT refresh tokensRedisFast, ephemeral, TTL-basedGitHub install tokensRedisCache with TTLJob queuesRedisBullMQ nativeIdempotency locksRedisShort-lived, atomicCode embeddingsQdrantPurpose-built vector search

That is the complete database design for Codebrief — all four stores, every collection and table, every field justified.