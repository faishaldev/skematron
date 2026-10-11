-- CreateTable
CREATE TABLE "migration" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "fromVersionId" TEXT NOT NULL,
    "toVersionId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "migration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration_revision" (
    "id" TEXT NOT NULL,
    "migrationId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "answers" JSONB NOT NULL,
    "planChecksum" TEXT NOT NULL,
    "scriptChecksum" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "openQuestions" INTEGER NOT NULL,
    "unsupportedChanges" INTEGER NOT NULL,
    "verification" TEXT NOT NULL,
    "verificationDetail" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migration_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration_review" (
    "id" TEXT NOT NULL,
    "migrationId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "comment" TEXT,
    "acknowledgedDestructive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migration_review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "migration_projectId_number_key" ON "migration"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "migration_revision_migrationId_number_key" ON "migration_revision"("migrationId", "number");

-- CreateIndex
CREATE INDEX "migration_review_migrationId_createdAt_idx" ON "migration_review"("migrationId", "createdAt");

-- AddForeignKey
ALTER TABLE "migration" ADD CONSTRAINT "migration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "migration" ADD CONSTRAINT "migration_fromVersionId_fkey" FOREIGN KEY ("fromVersionId") REFERENCES "schema_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "migration" ADD CONSTRAINT "migration_toVersionId_fkey" FOREIGN KEY ("toVersionId") REFERENCES "schema_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "migration_revision" ADD CONSTRAINT "migration_revision_migrationId_fkey" FOREIGN KEY ("migrationId") REFERENCES "migration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "migration_review" ADD CONSTRAINT "migration_review_migrationId_fkey" FOREIGN KEY ("migrationId") REFERENCES "migration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "migration_review" ADD CONSTRAINT "migration_review_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "migration_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
