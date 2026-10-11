import Link from "next/link";
import { listProjects, schemaSourceOf } from "../../../lib/projects.ts";
import { can } from "../../../lib/roles.ts";
import { requireActor } from "../../../lib/session.ts";
import {
  Empty,
  Flash,
  PageHeader,
  plural,
  type SearchParams,
} from "../../components/ui.tsx";
import { createProjectAction } from "./actions.ts";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const actor = await requireActor();
  const projects = await listProjects(actor);
  const canCreate = can(actor.role, "manage-projects");
  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="A project tracks one application's database schema: its versions, the migrations between them, and the databases it runs on."
      />
      <Flash searchParams={searchParams} />
      {projects.length === 0 ? (
        <Empty title="No projects yet">
          <p>
            {canCreate
              ? "Create your first project below."
              : "Ask an admin to create one."}
          </p>
        </Empty>
      ) : (
        <div className="project-cards">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.slug}`}
              className="project-card"
            >
              <h3>{project.name}</h3>
              <p className="hint">
                {schemaSourceOf(project) === "dashboard"
                  ? "Schema written in Skematron"
                  : "Schema written in code"}
              </p>
              <p className="small muted">
                {plural(project._count.versions, "version")} ·{" "}
                {plural(project._count.migrations, "migration")} ·{" "}
                {plural(project._count.environments, "database")}
              </p>
            </Link>
          ))}
        </div>
      )}
      {canCreate && (
        <div className="card" style={{ maxWidth: 640 }}>
          <h3>New project</h3>
          <form action={createProjectAction} className="stack">
            <label>
              Name
              <input
                name="name"
                placeholder="e.g. Billing API"
                required
                maxLength={80}
              />
            </label>
            <fieldset>
              <legend>Where is the schema written?</legend>
              <label className="option">
                <input
                  type="radio"
                  name="schemaSource"
                  value="code"
                  defaultChecked
                />
                <span>
                  <strong>In code</strong>
                  <span className="hint">
                    Your team edits a schema.prisma (or the database itself) and
                    imports each change into Skematron.
                  </span>
                </span>
              </label>
              <label className="option">
                <input type="radio" name="schemaSource" value="dashboard" />
                <span>
                  <strong>In Skematron</strong>
                  <span className="hint">
                    Your team adds tables and columns in Skematron&apos;s schema
                    editor. No ORM needed.
                  </span>
                </span>
              </label>
            </fieldset>
            <div>
              <button type="submit" className="primary">
                Create project
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
