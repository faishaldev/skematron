-- Branches replace per-person schema drafts. Existing drafts become open branches (named
-- draft-<hash>), so no work is lost; then the draft table is dropped.

-- CreateTable
CREATE TABLE "branch" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "baseVersionId" TEXT,
    "head" JSONB NOT NULL,
    "headUnsupported" JSONB NOT NULL,
    "headSource" JSONB NOT NULL,
    "mergedVersionId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "branch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branch_mergedVersionId_key" ON "branch"("mergedVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "branch_projectId_name_key" ON "branch"("projectId", "name");

-- AddForeignKey
ALTER TABLE "branch" ADD CONSTRAINT "branch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch" ADD CONSTRAINT "branch_baseVersionId_fkey" FOREIGN KEY ("baseVersionId") REFERENCES "schema_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch" ADD CONSTRAINT "branch_mergedVersionId_fkey" FOREIGN KEY ("mergedVersionId") REFERENCES "schema_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Convert drafts into open branches
INSERT INTO "branch" ("id", "projectId", "name", "status", "baseVersionId", "head", "headUnsupported", "headSource", "createdById", "createdAt", "updatedAt")
SELECT "id", "projectId", 'draft-' || substr(md5("id"), 1, 8), 'open', "baseVersionId", "snapshot", "unsupported", '{"kind":"editor"}'::jsonb, "userId", "createdAt", "updatedAt"
FROM "schema_draft";

-- DropForeignKey
ALTER TABLE "schema_draft" DROP CONSTRAINT "schema_draft_baseVersionId_fkey";

-- DropForeignKey
ALTER TABLE "schema_draft" DROP CONSTRAINT "schema_draft_projectId_fkey";

-- DropTable
DROP TABLE "schema_draft";

-- AlterTable
ALTER TABLE "migration" ADD COLUMN     "branchId" TEXT,
ALTER COLUMN "fromVersionId" DROP NOT NULL,
ALTER COLUMN "toVersionId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "migration_revision" ADD COLUMN     "toChecksum" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "migration_branchId_key" ON "migration"("branchId");

-- AddForeignKey
ALTER TABLE "migration" ADD CONSTRAINT "migration_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
