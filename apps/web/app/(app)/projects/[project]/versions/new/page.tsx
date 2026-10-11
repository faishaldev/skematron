import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError } from "../../../../../../lib/errors.ts";
import { MAX_PRISMA_SCHEMA_BYTES } from "../../../../../../lib/prisma-import.ts";
import { getProject } from "../../../../../../lib/projects.ts";
import { MAX_SQL_SCRIPT_BYTES } from "../../../../../../lib/sql-import.ts";
import { can } from "../../../../../../lib/roles.ts";
import { requireActor } from "../../../../../../lib/session.ts";
import { listVersions } from "../../../../../../lib/versions.ts";
import {
  Breadcrumbs,
  Callout,
  ErrorPanel,
  Flash,
  PageHeader,
  type SearchParams,
} from "../../../../../components/ui.tsx";
import { SchemaFileHelp } from "../../../../../components/schema-file-help.tsx";
import { importSchemaAction } from "../../actions.ts";

export const dynamic = "force-dynamic";

export default async function NewVersionPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: SearchParams;
}) {
  const actor = await requireActor();
  const { project: slug } = await params;
  const project = await getProject(actor, slug).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  if (!can(actor.role, "author-migrations")) {
    return (
      <ErrorPanel title="Not allowed" error="Viewers cannot import schemas." />
    );
  }
  const crumbs = (
    <Breadcrumbs
      items={[
        { label: "Projects", href: "/projects" },
        { label: project.name, href: `/projects/${project.slug}` },
        { label: "Import the schema" },
      ]}
    />
  );
  const latest = (await listVersions(actor, project))[0];
  if (latest !== undefined) {
    return (
      <>
        {crumbs}
        <PageHeader title="Import the schema" />
        <Callout
          title={`Main already starts at v1 (now v${latest.number})`}
          actions={
            <Link
              href={`/projects/${project.slug}/branches/new`}
              className="button primary"
            >
              New branch
            </Link>
          }
        >
          <p>
            Changes go through a branch: start one, upload the changed schema or
            the migration there, test it and get it reviewed, then merge it.
          </p>
        </Callout>
      </>
    );
  }
  return (
    <>
      {crumbs}
      <PageHeader
        title="Import the schema"
        subtitle={`Upload your current schema, from any ORM or migration tool. It becomes v1 on main, the starting point of ${project.name}; later changes go through branches. The file runs in a temporary database; no database of yours is touched.`}
      />
      <Flash searchParams={searchParams} />
      <div className="stack" style={{ maxWidth: 720 }}>
        <form action={importSchemaAction} className="stack card">
          <input type="hidden" name="project" value={project.slug} />
          <fieldset>
            <legend>What is the file?</legend>
            <label className="option">
              <input type="radio" name="format" value="sql" defaultChecked />
              <span>
                <strong>SQL that creates the whole schema</strong>
                <span className="hint">
                  From any tool: <code>pg_dump --schema-only</code>, Rails&apos;
                  structure.sql, <code>drizzle-kit export</code>,{" "}
                  <code>alembic upgrade head --sql</code>, and so on. Up to{" "}
                  {MAX_SQL_SCRIPT_BYTES / 1024 / 1024} MB. The file itself is
                  not stored.
                </span>
              </span>
            </label>
            <label className="option">
              <input type="radio" name="format" value="prisma" />
              <span>
                <strong>A Prisma schema (schema.prisma)</strong>
                <span className="hint">
                  Prisma turns it into SQL. One file, up to{" "}
                  {MAX_PRISMA_SCHEMA_BYTES / 1024} KB. Connection URLs are
                  removed before it is stored.
                </span>
              </span>
            </label>
          </fieldset>
          <label>
            File
            <input
              name="schemaFile"
              type="file"
              accept=".sql,.prisma,text/plain"
            />
          </label>
          <label>
            Or paste it
            <textarea
              name="schemaText"
              rows={14}
              spellCheck={false}
              placeholder={
                "CREATE TABLE users (\n  id serial PRIMARY KEY,\n  email text NOT NULL UNIQUE\n);"
              }
            />
          </label>
          <span className="hint">
            PostgreSQL only. Using a database instead? Connect it under
            Databases and import it from there.
          </span>
          <div>
            <button type="submit" className="primary">
              Import
            </button>
          </div>
        </form>
        <SchemaFileHelp changes={false} />
      </div>
    </>
  );
}
