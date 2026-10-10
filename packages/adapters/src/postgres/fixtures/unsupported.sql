-- Integration fixture: objects Skematron reports but does not capture.
CREATE TABLE __SCHEMA__.accounts (id integer PRIMARY KEY, balance integer NOT NULL);
CREATE VIEW __SCHEMA__.rich_accounts AS SELECT id FROM __SCHEMA__.accounts WHERE balance > 1000;
CREATE MATERIALIZED VIEW __SCHEMA__.account_count AS SELECT count(*) AS n FROM __SCHEMA__.accounts;
CREATE FUNCTION __SCHEMA__.touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER accounts_touch BEFORE UPDATE ON __SCHEMA__.accounts
  FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.touch();
ALTER TABLE __SCHEMA__.accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounts_all ON __SCHEMA__.accounts USING (true);
CREATE DOMAIN __SCHEMA__.positive_int AS integer CHECK (VALUE > 0);
CREATE TABLE __SCHEMA__.events (id integer, happened_on date NOT NULL) PARTITION BY RANGE (happened_on);
CREATE TABLE __SCHEMA__.events_2026 PARTITION OF __SCHEMA__.events
  FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE TABLE __SCHEMA__.bookings (id integer PRIMARY KEY, room circle, EXCLUDE USING gist (room WITH &&));
CREATE UNLOGGED TABLE __SCHEMA__.scratch (id integer);
