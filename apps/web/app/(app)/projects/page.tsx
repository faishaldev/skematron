import Link from "next/link";
import { listProjects, schemaSourceOf } from "../../../lib/projects.ts";
import { can } from "../../../lib/roles.ts";
import { requireActor } from "../../../lib/session.ts";
import { Icon } from "../../components/icons.tsx";
import {
  Empty,
  Flash,
  PageHeader,
  plural,
  type SearchParams,
} from "../../components/ui.tsx";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const actor = await requireActor();
  const projects = await listProjects(actor);
  const newProject = can(actor.role, "manage-projects") ? (
    <Link href="/projects/new" className="button primary">
      <Icon name="plus" />
      New project
    </Link>
  ) : undefined;
  return (
    <>
      <PageHeader
        title="Projects"
        subtitle={
          projects.length === 0
            ? "A project tracks one application's database schema."
            : `${plural(projects.length, "project")}. Each tracks one application's database schema: the agreed versions on main, the branches that change it, and the databases it runs on.`
        }
        actions={newProject}
      />
      <Flash searchParams={searchParams} />
      {projects.length === 0 ? (
        <Empty title="No projects yet" actions={newProject}>
          <p>
            {newProject === undefined
              ? "Ask an admin to create one."
              : "Create a project for the first application whose database schema you want to manage."}
          </p>
        </Empty>
      ) : (
        <div className="project-cards">
          {projects.map((project) => {
            const versions = project._count.versions;
            return (
              <Link
                key={project.id}
                href={`/projects/${project.slug}`}
                className="project-card"
              >
                <div className="project-card-head">
                  <span className="switcher-mark" aria-hidden>
                    {project.name.charAt(0).toUpperCase()}
                  </span>
                  <div className="project-card-title">
                    <h3>{project.name}</h3>
                    <span className="hint">
                      {schemaSourceOf(project) === "dashboard"
                        ? "Schema written in Skematron"
                        : "Schema written in code"}
                    </span>
                  </div>
                </div>
                <dl className="project-card-stats">
                  <div>
                    <dt>Main</dt>
                    <dd>{versions === 0 ? "—" : `v${versions}`}</dd>
                  </div>
                  <div>
                    <dt>Open branches</dt>
                    <dd>{project._count.branches}</dd>
                  </div>
                  <div>
                    <dt>Databases</dt>
                    <dd>{project._count.environments}</dd>
                  </div>
                </dl>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
