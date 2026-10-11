import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { NotFoundError } from "../../../../lib/errors.ts";
import { listMigrations, statusOf } from "../../../../lib/migrations.ts";
import {
  getProject,
  listEnvironments,
  schemaSourceOf,
} from "../../../../lib/projects.ts";
import { can } from "../../../../lib/roles.ts";
import { getDraft } from "../../../../lib/schema-drafts.ts";
import { requireActor } from "../../../../lib/session.ts";
import { listVersions, unsupportedOf } from "../../../../lib/versions.ts";
import { StatusBadge } from "../../../components/migration-status.tsx";
import {
  Breadcrumbs,
  Callout,
  Empty,
  Flash,
  formatDate,
  PageHeader,
  plural,
  Stat,
  type SearchParams,
} from "../../../components/ui.tsx";
import { importVersionAction, setSchemaSourceAction } from "./actions.ts";

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
  const [environments, versions, migrations] = await Promise.all([
    listEnvironments(actor, project),
    listVersions(actor, project),
    listMigrations(actor, project),
  ]);
  const base = `/projects/${project.slug}`;
  const latest = versions[0];
  const previous = versions[1];
  const source = schemaSourceOf(project);
  const canAuthor = can(actor.role, "author-migrations");
  const canReview = can(actor.role, "review-migrations");
  const canManage = can(actor.role, "manage-projects");
  const draft =
    source === "dashboard" && canAuthor ? await getDraft(actor, project) : null;
  const inReview = migrations.filter((m) => statusOf(m) === "in_review");
  const drafts = migrations.filter((m) => statusOf(m) === "draft");
  const approved = migrations.filter((m) => statusOf(m) === "approved");
  const latestHasMigration =
    latest === undefined ||
    migrations.some((m) => m.toVersion.number === latest.number);

  const editLink = (label: string, primary = true) => (
    <Link
      href={`${base}/schema`}
      className={`button${primary ? " primary" : ""}`}
    >
      {label}
    </Link>
  );
  const importLink = (primary = true) => (
    <Link
      href={`${base}/versions/new`}
      className={`button${primary ? " primary" : ""}`}
    >
      Import schema.prisma
    </Link>
  );
  const newMigrationLink = (from?: number, to?: number, primary = false) => (
    <Link
      href={`${base}/migrations/new${from === undefined ? "" : `?from=${from}&to=${to}`}`}
      className={`button${primary ? " primary" : ""}`}
    >
      New migration
    </Link>
  );

  let next: ReactNode;
  if (draft !== null) {
    next = (
      <Callout
        title="You have unsaved schema changes"
        actions={editLink("Continue editing")}
      >
        <p>
          Your draft is based on{" "}
          {draft.baseVersion === null
            ? "an empty schema"
            : `v${draft.baseVersion.number}`}
          . Save it as a version when you are done.
        </p>
      </Callout>
    );
  } else if (inReview.length > 0 && canReview) {
    const migration = inReview[0]!;
    next = (
      <Callout
        title={`M${migration.number} is waiting for review`}
        actions={
          <Link
            href={`${base}/migrations/${migration.number}`}
            className="button primary"
          >
            Review M{migration.number}
          </Link>
        }
      >
        <p>
          &ldquo;{migration.title}&rdquo; needs an admin or owner who did not
          write it to approve or reject it.
        </p>
      </Callout>
    );
  } else if (drafts.length > 0 && canAuthor) {
    const migration = drafts[0]!;
    next = (
      <Callout
        title={`M${migration.number} is not submitted yet`}
        actions={
          <Link
            href={`${base}/migrations/${migration.number}`}
            className="button primary"
          >
            Open M{migration.number}
          </Link>
        }
      >
        <p>Answer its questions, then submit it for review.</p>
      </Callout>
    );
  } else if (latest === undefined) {
    next =
      source === "dashboard" ? (
        <Callout
          title="Design your schema"
          actions={canAuthor ? editLink("Open the schema editor") : undefined}
        >
          <p>
            Add your first tables in the schema editor. Saving makes version 1.
          </p>
        </Callout>
      ) : (
        <Callout
          title="Add your schema"
          actions={
            canAuthor ? (
              <>
                {importLink()}
                {canManage && (
                  <Link href={`${base}/environments/new`} className="button">
                    Connect a database
                  </Link>
                )}
              </>
            ) : undefined
          }
        >
          <p>
            Import your schema.prisma, or connect a database and import its
            schema. Each import becomes a version: a snapshot of the schema at
            that moment.
          </p>
        </Callout>
      );
  } else if (previous === undefined) {
    next = (
      <Callout
        title="Version 1 is your starting point"
        actions={
          canAuthor
            ? source === "dashboard"
              ? editLink("Edit schema")
              : importLink()
            : undefined
        }
      >
        <p>
          {source === "dashboard"
            ? "Edit the schema and save it as version 2."
            : "When the schema changes, import it again as version 2."}{" "}
          Skematron then works out the migration between the two versions.
        </p>
      </Callout>
    );
  } else if (!latestHasMigration && canAuthor) {
    next = (
      <Callout
        title={`v${latest.number} has no migration yet`}
        actions={newMigrationLink(previous.number, latest.number, true)}
      >
        <p>
          Create the migration from v{previous.number} to v{latest.number}.
          Skematron plans it, asks about anything unclear, and tests it.
        </p>
      </Callout>
    );
  } else if (inReview.length > 0) {
    next = (
      <Callout title={`M${inReview[0]!.number} is waiting for review`}>
        <p>An admin or owner who did not write it approves or rejects it.</p>
      </Callout>
    );
  } else {
    next = (
      <Callout tone="success" title="All caught up">
        <p>
          Every version has a migration. Approved migrations can be downloaded
          as SQL; running them from Skematron comes in a later release.
        </p>
      </Callout>
    );
  }

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: project.name },
        ]}
      />
      <PageHeader
        title={project.name}
        badge={
          <span className="badge neutral">
            {source === "dashboard" ? "Schema in Skematron" : "Schema in code"}
          </span>
        }
        actions={
          canAuthor ? (
            <>
              {versions.length > 1 && newMigrationLink()}
              {source === "dashboard"
                ? editLink(draft === null ? "Edit schema" : "Continue editing")
                : importLink()}
            </>
          ) : undefined
        }
      />
      <Flash searchParams={searchParams} />
      {next}

      <div className="stats">
        <Stat
          label="Schema versions"
          value={versions.length}
          detail={
            latest === undefined ? "none yet" : `latest: v${latest.number}`
          }
        />
        <Stat
          label="Migrations"
          value={migrations.length}
          detail={
            migrations.length === 0
              ? "none yet"
              : `${inReview.length} in review · ${approved.length} approved`
          }
        />
        <Stat
          label="Databases"
          value={environments.length}
          detail={
            environments.length === 0
              ? "none connected"
              : environments.map((environment) => environment.name).join(", ")
          }
        />
      </div>

      <div className="section-head">
        <div>
          <h2>Migrations</h2>
          <p className="hint">
            Each migration changes a database from one version to another.
          </p>
        </div>
        {canAuthor && versions.length > 1 && newMigrationLink()}
      </div>
      {migrations.length === 0 ? (
        <Empty title="No migrations yet">
          <p>
            {versions.length < 2
              ? "A migration needs two versions: the schema before and after a change."
              : "Create one to go from one version to another."}
          </p>
        </Empty>
      ) : (
        <div className="card flush">
          <table>
            <thead>
              <tr>
                <th>Migration</th>
                <th>Change</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {migrations.map((migration) => (
                <tr key={migration.id}>
                  <td>
                    <Link href={`${base}/migrations/${migration.number}`}>
                      <strong>M{migration.number}</strong> · {migration.title}
                    </Link>
                  </td>
                  <td>
                    v{migration.fromVersion.number} → v
                    {migration.toVersion.number}
                  </td>
                  <td>
                    <StatusBadge status={statusOf(migration)} />
                  </td>
                  <td className="muted">{formatDate(migration.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="section-head">
        <div>
          <h2>Schema versions</h2>
          <p className="hint">
            Snapshots of the schema. They never change; every change makes a new
            version.
          </p>
        </div>
        {versions.length > 1 && (
          <form action={`${base}/compare`} method="get" className="inline">
            <select
              name="from"
              defaultValue={versions[1]!.number}
              aria-label="From"
            >
              {versions.map((version) => (
                <option key={version.id} value={version.number}>
                  v{version.number}
                </option>
              ))}
            </select>
            <span className="muted">→</span>
            <select
              name="to"
              defaultValue={versions[0]!.number}
              aria-label="To"
            >
              {versions.map((version) => (
                <option key={version.id} value={version.number}>
                  v{version.number}
                </option>
              ))}
            </select>
            <button type="submit">Compare</button>
          </form>
        )}
      </div>
      {versions.length === 0 ? (
        <Empty title="No versions yet">
          <p>
            {source === "dashboard"
              ? "Save the schema editor's draft to make the first version."
              : "Import a schema.prisma, or import a version from a connected database."}
          </p>
        </Empty>
      ) : (
        <div className="card flush">
          <table>
            <thead>
              <tr>
                <th>Version</th>
                <th>Added</th>
                <th>From</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {versions.map((version) => {
                const origin = version.source as {
                  kind?: string;
                  environmentName?: string;
                };
                const untracked = unsupportedOf(version).length;
                return (
                  <tr key={version.id}>
                    <td>
                      <Link href={`${base}/versions/${version.number}`}>
                        <strong>v{version.number}</strong>
                      </Link>
                    </td>
                    <td className="muted">{formatDate(version.createdAt)}</td>
                    <td>
                      {origin.kind === "prisma-schema"
                        ? "schema.prisma"
                        : origin.kind === "dashboard"
                          ? "Schema editor"
                          : `Database ${origin.environmentName ?? ""}`}
                    </td>
                    <td>
                      {untracked > 0 && (
                        <span className="badge caution">
                          {plural(untracked, "object")} not tracked
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="section-head">
        <div>
          <h2>Databases</h2>
          <p className="hint">
            Databases Skematron reads (never writes) to import versions and
            check for drift.
          </p>
        </div>
        {canManage && (
          <Link href={`${base}/environments/new`} className="button">
            Connect a database
          </Link>
        )}
      </div>
      {environments.length === 0 ? (
        <Empty title="No databases connected">
          <p>
            Connect staging or production to import its schema and see when it
            drifts from a version.
          </p>
        </Empty>
      ) : (
        <div className="card flush">
          <table>
            <thead>
              <tr>
                <th>Environment</th>
                <th>Connection</th>
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
                        <form action={importVersionAction}>
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
                          <button type="submit" className="small">
                            Import version
                          </button>
                        </form>
                      )}
                      {can(actor.role, "use-databases") &&
                        latest !== undefined && (
                          <Link
                            href={`${base}/compare?from=${latest.number}&environment=${environment.name}`}
                            className="button small"
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

      {canManage && (
        <details className="card" style={{ marginTop: 32 }}>
          <summary>Project settings</summary>
          <form action={setSchemaSourceAction} className="stack">
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
                    Import versions from a schema.prisma or a database. The
                    schema editor is off.
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
                    Edit the schema in Skematron. Importing a schema.prisma is
                    off.
                  </span>
                </span>
              </label>
            </fieldset>
            <div>
              <button type="submit">Change schema source</button>
            </div>
          </form>
        </details>
      )}
    </>
  );
}
