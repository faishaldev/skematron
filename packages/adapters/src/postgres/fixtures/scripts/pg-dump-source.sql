CREATE EXTENSION citext;
CREATE TYPE role AS ENUM ('reader', 'author');
CREATE TABLE users (
  id serial PRIMARY KEY,
  email citext NOT NULL UNIQUE,
  name text,
  role role NOT NULL DEFAULT 'reader',
  bio text NOT NULL DEFAULT E'Line one;\nIt''s line two',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_name_check CHECK (name <> '')
);
COMMENT ON TABLE users IS 'People; who ''write'' posts';
CREATE TABLE posts (
  id serial PRIMARY KEY,
  author_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title varchar(200) NOT NULL,
  published boolean NOT NULL DEFAULT false,
  updated_at timestamptz
);
CREATE INDEX posts_author_id_idx ON posts (author_id);
CREATE TABLE schema_migrations (version varchar PRIMARY KEY);
CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
  -- a semicolon; and a $tag$ inside the body
  NEW.updated_at := now();
  RAISE NOTICE 'touched; %', $x$it's fine$x$;
  RETURN NEW;
END;
$body$;
CREATE TRIGGER posts_touch BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE FUNCTION post_count(author integer) RETURNS bigint LANGUAGE sql
BEGIN ATOMIC
  SELECT CASE WHEN author > 0 THEN 1 ELSE 0 END;
  SELECT count(*) FROM posts WHERE author_id = author;
END;
CREATE VIEW published_posts AS SELECT id, title FROM posts WHERE published;
GRANT SELECT ON users, posts TO skematron_fixture_reader;
