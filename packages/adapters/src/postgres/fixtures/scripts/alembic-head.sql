BEGIN;

CREATE TABLE alembic_version (
    version_num VARCHAR(32) NOT NULL, 
    CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
);

-- Running upgrade  -> 0001

CREATE TYPE role AS ENUM ('reader', 'author');

CREATE TABLE users (
    id SERIAL NOT NULL, 
    email TEXT NOT NULL, 
    name TEXT, 
    role role DEFAULT 'reader' NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    PRIMARY KEY (id), 
    UNIQUE (email)
);

CREATE TABLE posts (
    id SERIAL NOT NULL, 
    author_id INTEGER NOT NULL, 
    title VARCHAR(200) NOT NULL, 
    published BOOLEAN DEFAULT false NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(author_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX posts_author_id_idx ON posts (author_id);

INSERT INTO alembic_version (version_num) VALUES ('0001') RETURNING alembic_version.version_num;

COMMIT;

