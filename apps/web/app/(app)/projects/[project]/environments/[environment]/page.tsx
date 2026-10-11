import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError } from "../../../../../../lib/errors.ts";
import { getEnvironment, getProject } from "../../../../../../lib/projects.ts";
import { can } from "../../../../../../lib/roles.ts";
import { requireActor } from "../../../../../../lib/session.ts";
import { listVersions } from "../../../../../../lib/versions.ts";
import {
  Breadcrumbs,
  Flash,
  formatDate,
  PageHeader,
  type SearchParams,
} from "../../../../../components/ui.tsx";
import {
  deleteEnvironmentAction,
  importVersionAction,
  testConnectionAction,
  updateEnvironmentAction,
} from "../../actions.ts";

export const dynamic = "force-dynamic";

export default async function EnvironmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string; environment: string }>;
  searchParams: SearchParams;
}) {
  const actor = await requireActor();
  const { project: slug, environment: name } = await params;
  const lookup = async () => {
    const project = await getProject(actor, slug);
    return { project, environment: await getEnvironment(actor, project, name) };
  };
  const { project, environment } = await lookup().catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const versions = await listVersions(actor, project);
  const latest = versions[0];
  const base = `/projects/${project.slug}`;
  const hidden = (
    <>
      <input type="hidden" name="project" value={project.slug} />
      <input type="hidden" name="environment" value={environment.name} />
    </>
  );

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: base },
          { label: environment.name },
        ]}
      />
      <PageHeader
        title={`Database: ${environment.name}`}
        subtitle={
          <>
            <code>{environment.connectionHint}</code> · tracks{" "}
            {environment.namespaces.join(", ")} · updated{" "}
            {formatDate(environment.updatedAt)}
          </>
        }
      />
      <Flash searchParams={searchParams} />

      {can(actor.role, "use-databases") && (
        <div className="card">
          <div className="actions">
            <form action={testConnectionAction} className="inline">
              {hidden}
              <button type="submit">Test connection</button>
            </form>
            <form action={importVersionAction} className="inline">
              {hidden}
              <input type="hidden" name="back" value="environment" />
              <button type="submit" className="primary">
                Import version
              </button>
            </form>
            {latest !== undefined && (
              <Link
                href={`${base}/compare?from=${latest.number}&environment=${environment.name}`}
                className="button"
              >
                Check drift against v{latest.number}
              </Link>
            )}
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            Import version saves this database&apos;s current schema as a new
            version. Check drift shows how it differs from the latest version.
            All of them only read the schema; Skematron never writes to this
            database.
          </p>
        </div>
      )}

      {can(actor.role, "manage-projects") && (
        <>
          <h2>Settings</h2>
          <form
            action={updateEnvironmentAction}
            className="stack card"
            style={{ maxWidth: 560 }}
          >
            {hidden}
            <label>
              Name
              <input
                name="name"
                required
                defaultValue={environment.name}
                pattern="[a-z0-9-]+"
              />
            </label>
            <label>
              New connection URL
              <input
                name="connectionUrl"
                type="password"
                placeholder="Leave empty to keep the current one"
                autoComplete="off"
              />
            </label>
            <label>
              Schemas to track
              <input
                name="namespaces"
                required
                defaultValue={environment.namespaces.join(", ")}
              />
            </label>
            <div>
              <button type="submit">Save</button>
            </div>
          </form>
          <form action={deleteEnvironmentAction} className="inline">
            {hidden}
            <button type="submit" className="danger">
              Delete environment
            </button>
            <span className="hint">Versions imported from it are kept.</span>
          </form>
        </>
      )}
    </>
  );
}
