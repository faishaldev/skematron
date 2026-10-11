import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError } from "../../../../../../lib/errors.ts";
import { getProject } from "../../../../../../lib/projects.ts";
import { can } from "../../../../../../lib/roles.ts";
import { requireActor } from "../../../../../../lib/session.ts";
import { listVersions } from "../../../../../../lib/versions.ts";
import {
  Breadcrumbs,
  Callout,
  ErrorPanel,
  Flash,
  PageHeader,
  param,
  type SearchParams,
} from "../../../../../components/ui.tsx";
import { createMigrationAction } from "../actions.ts";

export const dynamic = "force-dynamic";

export default async function NewMigrationPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: SearchParams;
}) {
  const actor = await requireActor();
  const { project: slug } = await params;
  const query = await searchParams;
  const project = await getProject(actor, slug).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  if (!can(actor.role, "author-migrations")) {
    return (
      <ErrorPanel
        title="Not allowed"
        error="Viewers cannot create migrations."
      />
    );
  }
  const versions = await listVersions(actor, project);
  const base = `/projects/${project.slug}`;
  const crumbs = (
    <Breadcrumbs
      items={[
        { label: "Projects", href: "/projects" },
        { label: project.name, href: base },
        { label: "New migration" },
      ]}
    />
  );
  if (versions.length < 2) {
    return (
      <>
        {crumbs}
        <PageHeader title="New migration" />
        <Callout title="You need two versions first">
          <p>
            A migration goes from one version of the schema to another. Add
            another version first: import a changed schema, or save the schema
            editor&apos;s draft. <Link href={base}>Back to {project.name}</Link>
          </p>
        </Callout>
      </>
    );
  }
  const numbers = versions.map((version) => String(version.number));
  const pick = (value: string | undefined, fallback: string) =>
    value !== undefined && numbers.includes(value) ? value : fallback;
  const from = pick(param(query.from), numbers[1]!);
  const to = pick(param(query.to), numbers[0]!);

  return (
    <>
      {crumbs}
      <PageHeader
        title="New migration"
        subtitle="Pick the version your databases have now and the version they should have. Skematron works out the changes, asks about anything it cannot decide on its own, and test-runs them in a temporary database. Nothing touches your databases."
      />
      <Flash searchParams={searchParams} />
      <form
        action={createMigrationAction}
        className="stack card"
        style={{ maxWidth: 560 }}
      >
        <input type="hidden" name="project" value={project.slug} />
        <div className="row">
          <label>
            From (current)
            <select name="from" defaultValue={from}>
              {versions.map((version) => (
                <option key={version.id} value={version.number}>
                  v{version.number}
                </option>
              ))}
            </select>
          </label>
          <label>
            To (new)
            <select name="to" defaultValue={to}>
              {versions.map((version) => (
                <option key={version.id} value={version.number}>
                  v{version.number}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Title
          <input name="title" maxLength={120} placeholder="v1 → v2" />
          <span className="hint">
            Optional, e.g. &ldquo;Add customer phone numbers&rdquo;.
          </span>
        </label>
        <div>
          <button type="submit" className="primary">
            Create migration
          </button>
        </div>
      </form>
    </>
  );
}
