import { can } from "../../../../lib/roles.ts";
import { requireActor } from "../../../../lib/session.ts";
import {
  Breadcrumbs,
  ErrorPanel,
  Flash,
  PageHeader,
  type SearchParams,
} from "../../../components/ui.tsx";
import { createProjectAction } from "../actions.ts";

export const dynamic = "force-dynamic";

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const actor = await requireActor();
  const crumbs = (
    <Breadcrumbs
      items={[
        { label: "Projects", href: "/projects" },
        { label: "New project" },
      ]}
    />
  );
  if (!can(actor.role, "manage-projects")) {
    return (
      <>
        {crumbs}
        <ErrorPanel
          title="Not allowed"
          error="Only admins can create projects."
        />
      </>
    );
  }
  return (
    <div className="narrow-page">
      {crumbs}
      <PageHeader
        title="New project"
        subtitle="One project per application database. You can connect databases and add the schema next."
      />
      <Flash searchParams={searchParams} />
      <form action={createProjectAction} className="stack card">
        <label>
          Name
          <input
            name="name"
            placeholder="e.g. Billing API"
            required
            maxLength={80}
            autoFocus
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
                Your team edits a schema.prisma (or the database itself).
                Changes are uploaded to branches in Skematron.
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
          <span className="hint">Admins can change this later.</span>
        </fieldset>
        <div className="toolbar">
          <button type="submit" className="primary">
            Create project
          </button>
        </div>
      </form>
    </div>
  );
}
