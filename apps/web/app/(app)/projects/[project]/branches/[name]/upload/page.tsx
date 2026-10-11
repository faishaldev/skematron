import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import {
  branchStatusOf,
  getBranch,
} from "../../../../../../../lib/branches.ts";
import { NotFoundError } from "../../../../../../../lib/errors.ts";
import { MAX_PRISMA_SCHEMA_BYTES } from "../../../../../../../lib/prisma-import.ts";
import {
  getProject,
  schemaSourceOf,
} from "../../../../../../../lib/projects.ts";
import { can } from "../../../../../../../lib/roles.ts";
import { MAX_SQL_SCRIPT_BYTES } from "../../../../../../../lib/sql-import.ts";
import { requireActor } from "../../../../../../../lib/session.ts";
import {
  Breadcrumbs,
  ErrorPanel,
  Flash,
  PageHeader,
  type SearchParams,
} from "../../../../../../components/ui.tsx";
import { SchemaFileHelp } from "../../../../../../components/schema-file-help.tsx";
import { uploadSchemaAction } from "../../actions.ts";

/**
 * Preselects the kind of file the branch was last changed with, or, on a new branch, the
 * kind its base version came from.
 */
function lastFormat(head: unknown, base: unknown): string {
  const headSource = (head ?? {}) as Record<string, unknown>;
  const source =
    headSource.kind === "base"
      ? ((base ?? {}) as Record<string, unknown>)
      : headSource;
  const kind = source.kind === "branch" ? source.via : source.kind;
  if (kind === "prisma-schema") return "prisma";
  if (kind === "sql-script" && source.script === "changes")
    return "sql-changes";
  return "sql-schema";
}

export const dynamic = "force-dynamic";

export default async function UploadToBranchPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string; name: string }>;
  searchParams: SearchParams;
}) {
  const actor = await requireActor();
  const { project: slug, name } = await params;
  let loaded;
  try {
    const project = await getProject(actor, slug);
    loaded = { project, branch: await getBranch(actor, project, name) };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { project, branch } = loaded;
  const base = `/projects/${project.slug}`;
  const crumbs = (
    <Breadcrumbs
      items={[
        { label: "Projects", href: "/projects" },
        { label: project.name, href: base },
        { label: "Branches", href: `${base}/branches` },
        { label: branch.name, href: `${base}/branches/${branch.name}` },
        { label: "Upload" },
      ]}
    />
  );
  const problem = !can(actor.role, "author-migrations")
    ? "Viewers cannot change branches."
    : schemaSourceOf(project) !== "code"
      ? "This project's schema is written in Skematron's editor; use Edit on the branch instead."
      : branchStatusOf(branch) !== "open"
        ? `This branch is ${branchStatusOf(branch)}, so it can no longer change.`
        : null;
  if (problem !== null) {
    return (
      <>
        {crumbs}
        <ErrorPanel title="Not possible here" error={problem} />
      </>
    );
  }
  const start =
    branch.baseVersion === null
      ? "an empty schema"
      : `v${branch.baseVersion.number}`;
  const selected = lastFormat(branch.headSource, branch.baseVersion?.source);
  const option = (value: string, title: string, hint: ReactNode) => (
    <label className="option">
      <input
        type="radio"
        name="format"
        value={value}
        defaultChecked={selected === value}
      />
      <span>
        <strong>{title}</strong>
        <span className="hint">{hint}</span>
      </span>
    </label>
  );
  return (
    <>
      {crumbs}
      <PageHeader
        title={`Upload to ${branch.name}`}
        subtitle={`What you upload becomes this branch's schema, compared with ${start} on main. It runs in a temporary database; no database of yours is touched. Upload again whenever it changes.`}
      />
      <Flash searchParams={searchParams} />
      <div className="stack" style={{ maxWidth: 720 }}>
        <form action={uploadSchemaAction} className="stack card">
          <input type="hidden" name="project" value={project.slug} />
          <input type="hidden" name="branch" value={branch.name} />
          <fieldset>
            <legend>What are you uploading?</legend>
            {option(
              "sql-changes",
              "SQL migrations (only the changes)",
              <>
                Applied on top of {start}, such as Django&apos;s{" "}
                <code>sqlmigrate</code> or a Prisma <code>migration.sql</code>.
                Upload all of this branch&apos;s migrations together: each
                upload starts again from {start}.
              </>,
            )}
            {option(
              "sql-schema",
              "SQL that creates the whole schema",
              <>
                Such as <code>pg_dump --schema-only</code>, Rails&apos;
                structure.sql or <code>drizzle-kit export</code>.
              </>,
            )}
            {option(
              "prisma",
              "A Prisma schema (schema.prisma)",
              <>
                Up to {MAX_PRISMA_SCHEMA_BYTES / 1024} KB. Connection URLs are
                removed before it is stored.
              </>,
            )}
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
              placeholder={"ALTER TABLE users ADD COLUMN phone text;"}
            />
          </label>
          <span className="hint">
            PostgreSQL only. SQL up to {MAX_SQL_SCRIPT_BYTES / 1024 / 1024} MB;
            the SQL itself is not stored.
          </span>
          <div>
            <button type="submit" className="primary">
              Upload
            </button>
          </div>
        </form>
        <SchemaFileHelp changes />
      </div>
    </>
  );
}
