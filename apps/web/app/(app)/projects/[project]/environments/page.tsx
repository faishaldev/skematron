import Link from "next/link";
import { resolveProject } from "../../../../../lib/project-pages.ts";
import { listEnvironments } from "../../../../../lib/projects.ts";
import { can } from "../../../../../lib/roles.ts";
import { listVersions } from "../../../../../lib/versions.ts";
import { EnvironmentTable } from "../../../../components/project-tables.tsx";
import {
  Breadcrumbs,
  Empty,
  Flash,
  PageHeader,
  type SearchParams,
} from "../../../../components/ui.tsx";

export const dynamic = "force-dynamic";

export default async function EnvironmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: SearchParams;
}) {
  const { actor, project } = await resolveProject(params);
  const [environments, versions] = await Promise.all([
    listEnvironments(actor, project),
    listVersions(actor, project),
  ]);
  const base = `/projects/${project.slug}`;
  const connect = can(actor.role, "manage-projects") ? (
    <Link href={`${base}/environments/new`} className="button primary">
      Connect a database
    </Link>
  ) : undefined;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: base },
          { label: "Databases" },
        ]}
      />
      <PageHeader
        title="Databases"
        subtitle="Databases (environments such as staging or production) that Skematron reads, never writes, to import schemas and check for drift."
        actions={connect}
      />
      <Flash searchParams={searchParams} />
      {environments.length === 0 ? (
        <Empty title="No databases connected" actions={connect}>
          <p>
            Connect staging or production to import its schema and see when it
            drifts from main.
          </p>
        </Empty>
      ) : (
        <div className="card flush">
          <EnvironmentTable
            environments={environments}
            base={base}
            projectSlug={project.slug}
            canUseDatabases={can(actor.role, "use-databases")}
            latestNumber={versions[0]?.number ?? null}
          />
        </div>
      )}
    </>
  );
}
