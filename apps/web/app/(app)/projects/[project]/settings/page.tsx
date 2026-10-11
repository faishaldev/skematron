import { resolveProject } from "../../../../../lib/project-pages.ts";
import { schemaSourceOf } from "../../../../../lib/projects.ts";
import { can } from "../../../../../lib/roles.ts";
import {
  Breadcrumbs,
  ErrorPanel,
  Flash,
  PageHeader,
  type SearchParams,
} from "../../../../components/ui.tsx";
import { setSchemaSourceAction } from "../actions.ts";

export const dynamic = "force-dynamic";

export default async function ProjectSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: SearchParams;
}) {
  const { actor, project } = await resolveProject(params);
  const base = `/projects/${project.slug}`;
  const crumbs = (
    <Breadcrumbs
      items={[
        { label: "Projects", href: "/projects" },
        { label: project.name, href: base },
        { label: "Settings" },
      ]}
    />
  );
  if (!can(actor.role, "manage-projects")) {
    return (
      <>
        {crumbs}
        <ErrorPanel
          title="Not allowed"
          error="Only admins can change project settings."
        />
      </>
    );
  }
  const source = schemaSourceOf(project);
  return (
    <>
      {crumbs}
      <PageHeader title="Project settings" />
      <Flash searchParams={searchParams} />
      <form
        action={setSchemaSourceAction}
        className="stack card"
        style={{ maxWidth: 640 }}
      >
        <input type="hidden" name="project" value={project.slug} />
        <fieldset>
          <legend>Where is the schema written?</legend>
          <label className="option">
            <input
              type="radio"
              name="schemaSource"
              value="code"
              defaultChecked={source === "code"}
            />
            <span>
              <strong>In code</strong>
              <span className="hint">
                Branches get their changes from a connected database or an
                uploaded schema file (Prisma so far). The schema editor is off.
              </span>
            </span>
          </label>
          <label className="option">
            <input
              type="radio"
              name="schemaSource"
              value="dashboard"
              defaultChecked={source === "dashboard"}
            />
            <span>
              <strong>In Skematron</strong>
              <span className="hint">
                Branches are changed in the schema editor. Uploading a schema
                file is off.
              </span>
            </span>
          </label>
        </fieldset>
        <div>
          <button type="submit">Change schema source</button>
        </div>
      </form>
    </>
  );
}
