import { notFound } from "next/navigation";
import { NotFoundError } from "../../../../../../lib/errors.ts";
import { getProject, schemaSourceOf } from "../../../../../../lib/projects.ts";
import { can } from "../../../../../../lib/roles.ts";
import { requireActor } from "../../../../../../lib/session.ts";
import { listVersions } from "../../../../../../lib/versions.ts";
import {
  Breadcrumbs,
  ErrorPanel,
  Flash,
  PageHeader,
  type SearchParams,
} from "../../../../../components/ui.tsx";
import { createBranchAction } from "../actions.ts";

export const dynamic = "force-dynamic";

export default async function NewBranchPage({
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
  const crumbs = (
    <Breadcrumbs
      items={[
        { label: "Projects", href: "/projects" },
        { label: project.name, href: `/projects/${project.slug}` },
        { label: "Branches", href: `/projects/${project.slug}/branches` },
        { label: "New branch" },
      ]}
    />
  );
  if (!can(actor.role, "author-migrations")) {
    return (
      <>
        {crumbs}
        <ErrorPanel
          title="Not allowed"
          error="Viewers cannot start branches."
        />
      </>
    );
  }
  const latest = (await listVersions(actor, project))[0];
  const dashboard = schemaSourceOf(project) === "dashboard";
  return (
    <>
      {crumbs}
      <PageHeader
        title="New branch"
        subtitle={`A branch is a change you can work on, test and get reviewed without touching main. It starts from ${latest === undefined ? "an empty schema" : `v${latest.number}, the latest version on main`}. When it is approved you merge it, and it becomes v${(latest?.number ?? 0) + 1}. If it is not needed after all, close it and nothing is recorded.`}
      />
      <Flash searchParams={searchParams} />
      <form
        action={createBranchAction}
        className="stack card"
        style={{ maxWidth: 560 }}
      >
        <input type="hidden" name="project" value={project.slug} />
        <label>
          Branch name
          <input
            name="name"
            required
            maxLength={50}
            pattern="[a-z0-9][a-z0-9-]*"
            placeholder="e.g. add-phone-number"
          />
          <span className="hint">
            Lowercase letters, digits and dashes. Describe the change.
          </span>
        </label>
        <p className="hint">
          Next:{" "}
          {dashboard
            ? "add tables and columns in the schema editor."
            : "upload your changes (SQL or a schema.prisma)."}
        </p>
        <div>
          <button type="submit" className="primary">
            Create branch
          </button>
        </div>
      </form>
    </>
  );
}
