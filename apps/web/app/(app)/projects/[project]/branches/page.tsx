import Link from "next/link";
import { branchStatusOf, listBranches } from "../../../../../lib/branches.ts";
import { resolveProject } from "../../../../../lib/project-pages.ts";
import { can } from "../../../../../lib/roles.ts";
import { BranchTable } from "../../../../components/project-tables.tsx";
import {
  Breadcrumbs,
  Empty,
  Flash,
  PageHeader,
  plural,
  type SearchParams,
} from "../../../../components/ui.tsx";

export const dynamic = "force-dynamic";

export default async function BranchesPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: SearchParams;
}) {
  const { actor, project } = await resolveProject(params);
  const branches = await listBranches(actor, project);
  const base = `/projects/${project.slug}`;
  const open = branches.filter((b) => branchStatusOf(b) === "open");
  const done = branches.filter((b) => branchStatusOf(b) !== "open");
  const newBranch = can(actor.role, "author-migrations") ? (
    <Link href={`${base}/branches/new`} className="button primary">
      New branch
    </Link>
  ) : undefined;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: base },
          { label: "Branches" },
        ]}
      />
      <PageHeader
        title="Branches"
        subtitle="Each change to the schema is a branch: it starts from the latest version on main, is tested and reviewed, and is then merged into main or closed."
        actions={newBranch}
      />
      <Flash searchParams={searchParams} />
      <h2>Open</h2>
      {open.length === 0 ? (
        <Empty title="No open branches" actions={newBranch}>
          <p>Start a branch whenever the schema needs to change.</p>
        </Empty>
      ) : (
        <div className="card flush">
          <BranchTable branches={open} base={base} />
        </div>
      )}
      {done.length > 0 && (
        <>
          <h2>
            Merged or closed ({plural(done.length, "branch", "branches")})
          </h2>
          <div className="card flush">
            <BranchTable branches={done} base={base} />
          </div>
        </>
      )}
    </>
  );
}
