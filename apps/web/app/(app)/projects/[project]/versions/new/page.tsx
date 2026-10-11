import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError } from "../../../../../../lib/errors.ts";
import { MAX_PRISMA_SCHEMA_BYTES } from "../../../../../../lib/prisma-import.ts";
import { getProject } from "../../../../../../lib/projects.ts";
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
import { importPrismaSchemaAction } from "../../actions.ts";

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
        { label: "Import schema.prisma" },
      ]}
    />
  );
  const latest = (await listVersions(actor, project))[0];
  if (latest !== undefined) {
    return (
      <>
        {crumbs}
        <PageHeader title="Import schema.prisma" />
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
            Changes go through a branch: start one, upload the changed
            schema.prisma there, test it and get it reviewed, then merge it.
          </p>
        </Callout>
      </>
    );
  }
  return (
    <>
      {crumbs}
      <PageHeader
        title="Import schema.prisma"
        subtitle={`Upload your current Prisma schema. It becomes v1 on main, the starting point of ${project.name}; later changes go through branches. Prisma itself turns it into SQL, which runs in a temporary database; no database of yours is touched.`}
      />
      <Flash searchParams={searchParams} />
      <form
        action={importPrismaSchemaAction}
        className="stack card"
        style={{ maxWidth: 720 }}
      >
        <input type="hidden" name="project" value={project.slug} />
        <label>
          schema.prisma file
          <input name="schemaFile" type="file" accept=".prisma,text/plain" />
        </label>
        <label>
          Or paste the schema
          <textarea
            name="schemaText"
            rows={14}
            spellCheck={false}
            placeholder={
              'datasource db {\n  provider = "postgresql"\n}\n\nmodel User {\n  id Int @id @default(autoincrement())\n}'
            }
          />
        </label>
        <span className="hint">
          PostgreSQL schemas only, one file, up to{" "}
          {MAX_PRISMA_SCHEMA_BYTES / 1024} KB. Connection URLs (<code>url</code>
          , <code>directUrl</code>, <code>shadowDatabaseUrl</code>) are removed
          before anything is stored.
        </span>
        <div>
          <button type="submit" className="primary">
            Import
          </button>
        </div>
      </form>
    </>
  );
}
