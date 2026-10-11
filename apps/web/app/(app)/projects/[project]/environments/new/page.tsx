import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError } from "../../../../../../lib/errors.ts";
import { getProject } from "../../../../../../lib/projects.ts";
import { can } from "../../../../../../lib/roles.ts";
import { requireActor } from "../../../../../../lib/session.ts";
import {
  Breadcrumbs,
  ErrorPanel,
  Flash,
  PageHeader,
  type SearchParams,
} from "../../../../../components/ui.tsx";
import { createEnvironmentAction } from "../../actions.ts";

export const dynamic = "force-dynamic";

export default async function NewEnvironmentPage({
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
  if (!can(actor.role, "manage-projects")) {
    return (
      <ErrorPanel
        title="Not allowed"
        error="Only admins can add environments."
      />
    );
  }
  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${project.slug}` },
          { label: "Connect a database" },
        ]}
      />
      <PageHeader
        title="Connect a database"
        subtitle="A PostgreSQL database (an environment, such as staging or production) that Skematron reads to import versions and check drift. It only reads the schema, never table data, and never writes. Use a read-only database user where you can."
      />
      <Flash searchParams={searchParams} />
      <form
        action={createEnvironmentAction}
        className="stack card"
        style={{ maxWidth: 560 }}
      >
        <input type="hidden" name="project" value={project.slug} />
        <label>
          Name
          <input
            name="name"
            required
            placeholder="production"
            pattern="[a-z0-9-]+"
          />
          <span className="hint">Lowercase letters, digits and dashes.</span>
        </label>
        <label>
          Connection URL
          <input
            name="connectionUrl"
            type="password"
            required
            placeholder="postgresql://user:password@host:5432/database"
            autoComplete="off"
          />
          <span className="hint">
            Stored encrypted. Only a redacted form (without the password) is
            ever shown again.
          </span>
        </label>
        <label>
          Schemas to track
          <input name="namespaces" required defaultValue="public" />
          <span className="hint">Comma-separated, e.g. public, billing.</span>
        </label>
        <div>
          <button type="submit" className="primary">
            Add environment
          </button>
        </div>
      </form>
    </>
  );
}
