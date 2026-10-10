import Link from "next/link";
import { listProjects } from "../../../lib/projects.ts";
import { can } from "../../../lib/roles.ts";
import { requireActor } from "../../../lib/session.ts";
import { Flash, type SearchParams } from "../../components/ui.tsx";
import { createProjectAction } from "./actions.ts";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const actor = await requireActor();
  const projects = await listProjects(actor);
  return (
    <>
      <h1>Projects</h1>
      <Flash searchParams={searchParams} />
      {projects.length === 0 ? (
        <p className="muted">
          No projects yet.
          {can(actor.role, "manage-projects")
            ? " Create one to start tracking a database schema."
            : " Ask an admin to create one."}
        </p>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Environments</th>
                <th>Versions</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id}>
                  <td>
                    <Link href={`/projects/${project.slug}`}>
                      <strong>{project.name}</strong>
                    </Link>
                  </td>
                  <td>{project._count.environments}</td>
                  <td>{project._count.versions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {can(actor.role, "manage-projects") && (
        <div className="card">
          <h3>New project</h3>
          <form action={createProjectAction} className="inline">
            <input
              name="name"
              placeholder="Project name"
              required
              maxLength={80}
            />
            <button type="submit" className="primary">
              Create project
            </button>
          </form>
        </div>
      )}
    </>
  );
}
