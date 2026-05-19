-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "drafts" (
    "id" TEXT NOT NULL,
    "projectKey" TEXT NOT NULL,
    "meetingContext" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_review',
    "feedback" TEXT,
    "committedKeys" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft_artifacts" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" TEXT DEFAULT 'Medium',
    "storyPoints" INTEGER DEFAULT 3,
    "acceptanceCriteria" TEXT,
    "testingScenarios" TEXT,
    "edgeCases" TEXT,
    "possibleBugs" TEXT,
    "labels" TEXT,
    "components" TEXT,
    "epicRef" TEXT,
    "parentRef" TEXT,
    "epicLinkKey" TEXT,
    "parentKey" TEXT,
    "assigneeId" TEXT,
    "sprintId" INTEGER,
    "flaggedForReview" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "committedKey" TEXT,
    CONSTRAINT "draft_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft_action_logs" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "items" TEXT,
    CONSTRAINT "draft_action_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issues" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "projectKey" TEXT NOT NULL,
    "issueType" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT,
    "priority" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "assignee" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "draftId" TEXT,
    CONSTRAINT "issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_chunks" (
    "id" SERIAL NOT NULL,
    "source_file" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "ingested_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "doc_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_embeddings" (
    "chunk_id" INTEGER NOT NULL,
    "embedding" vector(768) NOT NULL,
    CONSTRAINT "doc_embeddings_pkey" PRIMARY KEY ("chunk_id")
);

-- CreateIndex
CREATE INDEX "drafts_projectKey_idx" ON "drafts"("projectKey");
CREATE INDEX "drafts_status_idx" ON "drafts"("status");
CREATE INDEX "draft_artifacts_draftId_idx" ON "draft_artifacts"("draftId");
CREATE UNIQUE INDEX "issues_key_key" ON "issues"("key");
CREATE INDEX "issues_projectKey_idx" ON "issues"("projectKey");
CREATE INDEX "issues_status_idx" ON "issues"("status");
CREATE INDEX "doc_chunks_source_file_idx" ON "doc_chunks"("source_file");
CREATE UNIQUE INDEX "doc_chunks_source_file_chunk_index_key" ON "doc_chunks"("source_file", "chunk_index");

-- AddForeignKey
ALTER TABLE "draft_artifacts" ADD CONSTRAINT "draft_artifacts_draftId_fkey"
    FOREIGN KEY ("draftId") REFERENCES "drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "draft_action_logs" ADD CONSTRAINT "draft_action_logs_draftId_fkey"
    FOREIGN KEY ("draftId") REFERENCES "drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "issues" ADD CONSTRAINT "issues_draftId_fkey"
    FOREIGN KEY ("draftId") REFERENCES "drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "doc_embeddings" ADD CONSTRAINT "doc_embeddings_chunk_id_fkey"
    FOREIGN KEY ("chunk_id") REFERENCES "doc_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
