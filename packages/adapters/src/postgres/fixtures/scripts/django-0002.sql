BEGIN;
--
-- Add field summary to post
--
ALTER TABLE "posts" ADD COLUMN "summary" text NULL;
COMMIT;
