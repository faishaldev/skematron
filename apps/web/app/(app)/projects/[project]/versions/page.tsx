import Link from "next/link";
import { resolveProject } from "../../../../../lib/project-pages.ts";
import { schemaSourceOf } from "../../../../../lib/projects.ts";
import { can } from "../../../../../lib/roles.ts";
import { listVersions } from "../../../../../lib/versions.ts";
import { VersionTable } from "../../../../components/project-tables.tsx";
import {
  Breadcrumbs,
  Empty,
  PageHeader,
  type SearchParams,
} from "../../../../components/ui.tsx";

export const dynamic = "force-dynamic";

export default async function VersionsPage({
  params,
}: {
  params: Promise<{ project: string }>;
  searchParams: SearchParams;
}) {
  const { actor, project } = await resolveProject(params);
  const versions = await listVersions(actor, project);
  const base = `/projects/${project.slug}`;
  const code = schemaSourceOf(project) === "code";
  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: base },
          { label: "Main versions" },
        ]}
      />
      <PageHeader
        title="Main versions"
        subtitle="The agreed schema over time. Versions never change; after the first one, each comes from a merged branch."
        actions={
          versions.length > 1 ? (
            <form action={`${base}/compare`} method="get" className="inline">
              <select
                name="from"
                defaultValue={versions[1]!.number}
                aria-label="From"
              >
                {versions.map((version) => (
                  <option key={version.id} value={version.number}>
                    v{version.number}
                  </option>
                ))}
              </select>
              <span className="muted">→</span>
              <select
                name="to"
                defaultValue={versions[0]!.number}
                aria-label="To"
              >
                {versions.map((version) => (
                  <option key={version.id} value={version.number}>
                    v{version.number}
                  </option>
                ))}
              </select>
              <button type="submit">Compare</button>
            </form>
          ) : undefined
        }
      />
      {versions.length === 0 ? (
        <Empty
          title="No versions yet"
          actions={
            code && can(actor.role, "author-migrations") ? (
              <Link href={`${base}/versions/new`} className="button primary">
                Import schema.prisma
              </Link>
            ) : undefined
          }
        >
          <p>
            {code
              ? "Import a schema.prisma, or import a connected database, to make v1."
              : "Start a branch, design the schema, and merge it to make v1."}
          </p>
        </Empty>
      ) : (
        <div className="card flush">
          <VersionTable versions={versions} base={base} />
        </div>
      )}
    </>
  );
}
