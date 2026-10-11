-- People who worked on a branch may not review it. Existing branches start with their creator.

-- AlterTable
ALTER TABLE "branch" ADD COLUMN     "contributorIds" TEXT[];

UPDATE "branch" SET "contributorIds" = ARRAY["createdById"];
