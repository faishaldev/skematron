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
import { requireActor } from "../../../../../../../lib/session.ts";
import {
  Breadcrumbs,
  ErrorPanel,
  Flash,
  PageHeader,
  type SearchParams,
} from "../../../../../../components/ui.tsx";
import { uploadPrismaAction } from "../../actions.ts";

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
        { label: "Upload schema.prisma" },
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
  return (
    <>
      {crumbs}
      <PageHeader
        title={`Upload schema.prisma to ${branch.name}`}
        subtitle={`The uploaded schema becomes this branch's content and is compared with ${branch.baseVersion === null ? "an empty schema" : `v${branch.baseVersion.number}`} on main. Prisma turns it into SQL in a temporary database; no database of yours is touched. Upload again whenever the schema changes.`}
      />
      <Flash searchParams={searchParams} />
      <form
        action={uploadPrismaAction}
        className="stack card"
        style={{ maxWidth: 720 }}
      >
        <input type="hidden" name="project" value={project.slug} />
        <input type="hidden" name="branch" value={branch.name} />
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
          {MAX_PRISMA_SCHEMA_BYTES / 1024} KB. Connection URLs are removed
          before anything is stored.
        </span>
        <div>
          <button type="submit" className="primary">
            Upload
          </button>
        </div>
      </form>
    </>
  );
}
