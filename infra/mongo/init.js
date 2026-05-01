// MongoDB initialization — runs once on first container start
// Creates the codebrief database, collections, and indexes

const db = db.getSiblingDB(process.env.MONGO_INITDB_DATABASE || 'codebrief');

// ─── reviews collection ───────────────────────────────────────
db.createCollection('reviews', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['postgres_review_id', 'postgres_repo_id', 'pull_request', 'findings', 'summary'],
      properties: {
        postgres_review_id: { bsonType: 'string' },
        postgres_repo_id:   { bsonType: 'string' },
        pull_request: {
          bsonType: 'object',
          required: ['repo_full_name', 'pr_number'],
          properties: {
            repo_full_name: { bsonType: 'string' },
            pr_number:      { bsonType: 'int' },
            head_sha:       { bsonType: 'string' }
          }
        },
        findings: { bsonType: 'array' },
        summary: {
          bsonType: 'object',
          required: ['verdict'],
          properties: {
            verdict: { enum: ['approve', 'request_changes', 'comment'] }
          }
        }
      }
    }
  }
});

// Indexes for reviews
db.reviews.createIndex({ postgres_review_id: 1 }, { unique: true, name: 'idx_postgres_review_id' });
db.reviews.createIndex({ postgres_repo_id: 1 },   { name: 'idx_postgres_repo_id' });
db.reviews.createIndex({ 'pull_request.pr_number': 1, postgres_repo_id: 1 }, { name: 'idx_pr_number_repo' });
db.reviews.createIndex({ created_at: -1 },         { name: 'idx_created_at' });

// ─── documentation collection ─────────────────────────────────
db.createCollection('documentation', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['postgres_repo_id', 'trigger', 'status', 'sections'],
      properties: {
        postgres_repo_id: { bsonType: 'string' },
        trigger: {
          bsonType: 'object',
          required: ['pr_number', 'merge_sha'],
          properties: {
            pr_number:  { bsonType: 'int' },
            merge_sha:  { bsonType: 'string' },
            merged_at:  { bsonType: 'date' }
          }
        },
        status: {
          enum: ['pending_review', 'partially_approved', 'fully_approved', 'auto_published', 'rejected']
        },
        sections: { bsonType: 'array' }
      }
    }
  }
});

db.documentation.createIndex({ postgres_repo_id: 1 },            { name: 'idx_repo_id' });
db.documentation.createIndex({ status: 1 },                       { name: 'idx_status' });
db.documentation.createIndex({ 'trigger.pr_number': 1, postgres_repo_id: 1 }, { name: 'idx_pr_repo' });
db.documentation.createIndex({ created_at: -1 },                  { name: 'idx_created_at' });

// ─── codebase_snapshots collection ───────────────────────────
db.createCollection('codebase_snapshots', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['postgres_repo_id', 'snapshot_type', 'trigger_sha', 'status'],
      properties: {
        postgres_repo_id: { bsonType: 'string' },
        snapshot_type:    { enum: ['full', 'incremental'] },
        trigger_sha:      { bsonType: 'string' },
        trigger_type:     { enum: ['initial_index', 'pr_merge', 'manual'] },
        status:           { enum: ['running', 'completed', 'failed'] }
      }
    }
  }
});

db.codebase_snapshots.createIndex({ postgres_repo_id: 1 }, { name: 'idx_repo_id' });
db.codebase_snapshots.createIndex({ trigger_sha: 1 },      { name: 'idx_trigger_sha' });
db.codebase_snapshots.createIndex({ created_at: -1 },      { name: 'idx_created_at' });
db.codebase_snapshots.createIndex({ status: 1 },           { name: 'idx_status' });

print('MongoDB initialization complete — collections and indexes created.');