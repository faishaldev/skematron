--
-- PostgreSQL database dump
--

\restrict YRr5bIGCfUTgA5cJjZEFNLGmeL7VqFCNMsOhZshVwva4LWWjeXjmHeNUteLQfkZ

-- Dumped from database version 14.20 (Homebrew)
-- Dumped by pg_dump version 14.20 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: citext; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;


--
-- Name: EXTENSION citext; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION citext IS 'data type for case-insensitive character strings';


--
-- Name: role; Type: TYPE; Schema: public; Owner: app_owner
--

CREATE TYPE public.role AS ENUM (
    'reader',
    'author'
);


ALTER TYPE public.role OWNER TO app_owner;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: posts; Type: TABLE; Schema: public; Owner: app_owner
--

CREATE TABLE public.posts (
    id integer NOT NULL,
    author_id integer NOT NULL,
    title character varying(200) NOT NULL,
    published boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone
);


ALTER TABLE public.posts OWNER TO app_owner;

--
-- Name: post_count(integer); Type: FUNCTION; Schema: public; Owner: app_owner
--

CREATE FUNCTION public.post_count(author integer) RETURNS bigint
    LANGUAGE sql
    BEGIN ATOMIC
 SELECT
         CASE
             WHEN (author > 0) THEN 1
             ELSE 0
         END AS "case";
 SELECT count(*) AS count
    FROM public.posts
   WHERE (posts.author_id = post_count.author);
END;


ALTER FUNCTION public.post_count(author integer) OWNER TO app_owner;

--
-- Name: touch_updated_at(); Type: FUNCTION; Schema: public; Owner: app_owner
--

CREATE FUNCTION public.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
BEGIN
  -- a semicolon; and a $tag$ inside the body
  NEW.updated_at := now();
  RAISE NOTICE 'touched; %', $x$it's fine$x$;
  RETURN NEW;
END;
$_$;


ALTER FUNCTION public.touch_updated_at() OWNER TO app_owner;

--
-- Name: posts_id_seq; Type: SEQUENCE; Schema: public; Owner: app_owner
--

CREATE SEQUENCE public.posts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.posts_id_seq OWNER TO app_owner;

--
-- Name: posts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: app_owner
--

ALTER SEQUENCE public.posts_id_seq OWNED BY public.posts.id;


--
-- Name: published_posts; Type: VIEW; Schema: public; Owner: app_owner
--

CREATE VIEW public.published_posts AS
 SELECT posts.id,
    posts.title
   FROM public.posts
  WHERE posts.published;


ALTER TABLE public.published_posts OWNER TO app_owner;

--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: app_owner
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


ALTER TABLE public.schema_migrations OWNER TO app_owner;

--
-- Name: users; Type: TABLE; Schema: public; Owner: app_owner
--

CREATE TABLE public.users (
    id integer NOT NULL,
    email public.citext NOT NULL,
    name text,
    role public.role DEFAULT 'reader'::public.role NOT NULL,
    bio text DEFAULT 'Line one;
It''s line two'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT users_name_check CHECK ((name <> ''::text))
);


ALTER TABLE public.users OWNER TO app_owner;

--
-- Name: TABLE users; Type: COMMENT; Schema: public; Owner: app_owner
--

COMMENT ON TABLE public.users IS 'People; who ''write'' posts';


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: app_owner
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.users_id_seq OWNER TO app_owner;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: app_owner
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: posts id; Type: DEFAULT; Schema: public; Owner: app_owner
--

ALTER TABLE ONLY public.posts ALTER COLUMN id SET DEFAULT nextval('public.posts_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: app_owner
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: posts posts_pkey; Type: CONSTRAINT; Schema: public; Owner: app_owner
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: app_owner
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: app_owner
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: app_owner
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: posts_author_id_idx; Type: INDEX; Schema: public; Owner: app_owner
--

CREATE INDEX posts_author_id_idx ON public.posts USING btree (author_id);


--
-- Name: posts posts_touch; Type: TRIGGER; Schema: public; Owner: app_owner
--

CREATE TRIGGER posts_touch BEFORE UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: posts posts_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: app_owner
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: TABLE posts; Type: ACL; Schema: public; Owner: app_owner
--

GRANT SELECT ON TABLE public.posts TO skematron_fixture_reader;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: app_owner
--

GRANT SELECT ON TABLE public.users TO skematron_fixture_reader;


--
-- PostgreSQL database dump complete
--

\unrestrict YRr5bIGCfUTgA5cJjZEFNLGmeL7VqFCNMsOhZshVwva4LWWjeXjmHeNUteLQfkZ

