import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError } from "../../../../lib/errors.ts";
import { getProject, listEnvironments } from "../../../../lib/projects.ts";
import { can } from "../../../../lib/roles.ts";
import { requireActor } from "../../../../lib/session.ts";
import { listVersions, unsupportedOf } from "../../../../lib/versions.ts";
import {
  Flash,
  formatDate,
  shortChecksum,
  type SearchParams,
} from "../../../components/ui.tsx";
import { importVersionAction } from "./actions.ts";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
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
  const [environments, versions] = await Promise.all([
    listEnvironments(actor, project),
    listVersions(actor, project),
  ]);
  const base = `/projects/${project.slug}`;
  const latest = versions[0];

  return (
    <>
      <p>
        <Link href="/projects">← Projects</Link>
      </p>
      <h1>{project.name}</h1>
      <Flash searchParams={searchParams} />

      <div className="page-header">
        <h2>Environments</h2>
        {can(actor.role, "manage-projects") && (
          <Link href={`${base}/environments/new`}>Add environment</Link>
        )}
      </div>
      {environments.length === 0 ? (
        <p className="muted">
          No environments yet. An environment is a database Skematron reads
          (never writes) to import versions and check drift.
        </p>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Environment</th>
                <th>Database</th>
                <th>Schemas</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {environments.map((environment) => (
                <tr key={environment.id}>
                  <td>
                    <Link href={`${base}/environments/${environment.name}`}>
                      <strong>{environment.name}</strong>
                    </Link>
                  </td>
                  <td>
                    <code>{environment.connectionHint}</code>
                  </td>
                  <td>{environment.namespaces.join(", ")}</td>
                  <td>
                    <div className="actions">
                      {can(actor.role, "use-databases") && (
                        <form action={importVersionAction} className="inline">
                          <input
                            type="hidden"
                            name="project"
                            value={project.slug}
                          />
                          <input
                            type="hidden"
                            name="environment"
                            value={environment.name}
                          />
                          <button type="submit">Import version</button>
                        </form>
                      )}
                      {can(actor.role, "use-databases") &&
                        latest !== undefined && (
                          <Link
                            href={`${base}/compare?from=${latest.number}&environment=${environment.name}`}
                          >
                            Check drift
                          </Link>
                        )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Versions</h2>
      {versions.length === 0 ? (
        <p className="muted">
          No versions yet. Import one from an environment.
        </p>
      ) : (
        <>
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Imported</th>
                  <th>From</th>
                  <th>Checksum</th>
                  <th>Not captured</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((version) => {
                  const source = version.source as { environmentName?: string };
                  return (
                    <tr key={version.id}>
                      <td>
                        <Link href={`${base}/versions/${version.number}`}>
                          <strong>v{version.number}</strong>
                        </Link>
                      </td>
                      <td>{formatDate(version.createdAt)}</td>
                      <td>{source.environmentName ?? "—"}</td>
                      <td>
                        <code>{shortChecksum(version.checksum)}</code>
                      </td>
                      <td>{unsupportedOf(version).length}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {versions.length > 1 && (
            <div className="card">
              <h3>Compare versions</h3>
              <form action={`${base}/compare`} method="get" className="inline">
                <label>
                  From
                  <select name="from" defaultValue={versions[1]!.number}>
                    {versions.map((version) => (
                      <option key={version.id} value={version.number}>
                        v{version.number}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  To
                  <select name="to" defaultValue={versions[0]!.number}>
                    {versions.map((version) => (
                      <option key={version.id} value={version.number}>
                        v{version.number}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit">Compare</button>
              </form>
            </div>
          )}
        </>
      )}
    </>
  );
}
