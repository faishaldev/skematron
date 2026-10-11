import Link from "next/link";
import type { SchemaSnapshot } from "@skematron/core";
import {
  branchPlan,
  branchStatusOf,
  getBranch,
  headOf,
  listBranches,
} from "../../../../../lib/branches.ts";
import { NotFoundError } from "../../../../../lib/errors.ts";
import { resolveProject } from "../../../../../lib/project-pages.ts";
import { listVersions, loadSnapshot } from "../../../../../lib/versions.ts";
import {
  diagramHighlights,
  SchemaDiagram,
  type DiagramHighlights,
} from "../../../../components/diagram.tsx";
import {
  Breadcrumbs,
  Empty,
  PageHeader,
  param,
  plural,
  type SearchParams,
} from "../../../../components/ui.tsx";

export const dynamic = "force-dynamic";

export default async function DiagramPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: SearchParams;
}) {
  const { actor, project } = await resolveProject(params);
  const query = await searchParams;
  const [versions, branches] = await Promise.all([
    listVersions(actor, project),
    listBranches(actor, project),
  ]);
  const base = `/projects/${project.slug}`;
  const openBranches = branches.filter((b) => branchStatusOf(b) === "open");
  const crumbs = (
    <Breadcrumbs
      items={[
        { label: "Projects", href: "/projects" },
        { label: project.name, href: base },
        { label: "Diagram" },
      ]}
    />
  );

  // What to draw: ?branch=<name>, ?version=<n> (or the picker's ?pick=branch:<name> and
  // ?pick=version:<n>), else the latest version on main.
  const pick = param(query.pick) ?? "";
  const branchName = pick.startsWith("branch:")
    ? pick.slice("branch:".length)
    : param(query.branch);
  const versionNumber = pick.startsWith("version:")
    ? pick.slice("version:".length)
    : param(query.version);
  let selected = "";
  let title = "";
  let snapshot: SchemaSnapshot | null = null;
  let highlights: DiagramHighlights | undefined;
  if (branchName !== undefined) {
    try {
      const branch = await getBranch(actor, project, branchName);
      snapshot = headOf(branch);
      highlights = diagramHighlights(await branchPlan(branch));
      selected = `branch:${branch.name}`;
      title = `Branch ${branch.name}`;
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
  } else {
    const version =
      versions.find((v) => String(v.number) === versionNumber) ?? versions[0];
    if (version !== undefined) {
      snapshot = await loadSnapshot(version);
      selected = `version:${version.number}`;
      title = `v${version.number}${version.id === versions[0]?.id ? " (latest on main)" : ""}`;
    }
  }
  const tableCount =
    snapshot?.namespaces.reduce((n, ns) => n + ns.tables.length, 0) ?? 0;

  return (
    <>
      {crumbs}
      <PageHeader
        title="Diagram"
        subtitle="Tables, their columns, and the links between them. Tables that others point to are on the left; hover a line to see which columns it connects."
        actions={
          versions.length + openBranches.length > 0 ? (
            <form method="get" className="inline">
              <select
                name="pick"
                defaultValue={selected}
                aria-label="Schema to show"
              >
                <optgroup label="Main">
                  {versions.map((version) => (
                    <option
                      key={version.id}
                      value={`version:${version.number}`}
                    >
                      v{version.number}
                    </option>
                  ))}
                </optgroup>
                {openBranches.length > 0 && (
                  <optgroup label="Open branches">
                    {openBranches.map((branch) => (
                      <option key={branch.id} value={`branch:${branch.name}`}>
                        {branch.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <button type="submit">Show</button>
            </form>
          ) : undefined
        }
      />
      {snapshot === null ? (
        <Empty title="Nothing to draw yet">
          <p>
            The diagram shows a version on main or an open branch. Add the first
            version to start.
          </p>
        </Empty>
      ) : (
        <>
          <h2 style={{ marginTop: 0 }}>
            {title} · {plural(tableCount, "table")}
          </h2>
          {highlights !== undefined && (
            <p className="hint">
              Colored: what this branch adds or changes compared with main.{" "}
              <Link href={`${base}/branches/${branchName}`}>
                Open the branch
              </Link>
            </p>
          )}
          <SchemaDiagram snapshot={snapshot} highlights={highlights} />
        </>
      )}
    </>
  );
}
