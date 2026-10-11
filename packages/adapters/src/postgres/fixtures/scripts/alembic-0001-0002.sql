BEGIN;

-- Running upgrade 0001 -> 0002

ALTER TABLE posts ADD COLUMN summary TEXT;

UPDATE alembic_version SET version_num='0002' WHERE alembic_version.version_num = '0001';

COMMIT;

