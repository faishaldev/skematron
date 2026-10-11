-- AlterTable
ALTER TABLE "project" ADD COLUMN     "schemaSource" TEXT NOT NULL DEFAULT 'code';

-- CreateTable
CREATE TABLE "schema_draft" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "baseVersionId" TEXT,
    "snapshot" JSONB NOT NULL,
    "unsupported" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schema_draft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "schema_draft_projectId_userId_key" ON "schema_draft"("projectId", "userId");

-- AddForeignKey
ALTER TABLE "schema_draft" ADD CONSTRAINT "schema_draft_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schema_draft" ADD CONSTRAINT "schema_draft_baseVersionId_fkey" FOREIGN KEY ("baseVersionId") REFERENCES "schema_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
