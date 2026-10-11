create type "role" as enum ('reader', 'author');
create table "users" ("id" serial primary key, "email" text not null, "name" text, "role" "role" not null default 'reader', "created_at" timestamptz not null default CURRENT_TIMESTAMP);
alter table "users" add constraint "users_email_unique" unique ("email");
create table "posts" ("id" serial primary key, "author_id" integer not null, "title" varchar(200) not null, "published" boolean not null default '0');
alter table "posts" add constraint "posts_author_id_foreign" foreign key ("author_id") references "users" ("id") on delete CASCADE;
create index "posts_author_id_idx" on "posts" ("author_id");
