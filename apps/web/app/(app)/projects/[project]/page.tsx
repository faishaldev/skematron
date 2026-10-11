import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { branchStatusOf, listBranches } from "../../../../lib/branches.ts";
import { NotFoundError } from "../../../../lib/errors.ts";
import { statusOf } from "../../../../lib/migrations.ts";
import {
  getProject,
  listEnvironments,
  schemaSourceOf,
} from "../../../../lib/projects.ts";
import { can } from "../../../../lib/roles.ts";
import { requireActor } from "../../../../lib/session.ts";
import { listVersions, unsupportedOf } from "../../../../lib/versions.ts";
import { BranchBadge } from "../../../components/branch-status.tsx";
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

type BranchRow = Awaited<ReturnType<typeof listBranches>>[number];

const reviewOf = (branch: BranchRow) =>
  branch.migration === null ? "draft" : statusOf(branch.migration);

function BranchTable({
  branches,
  base,
}: {
  branches: BranchRow[];
  base: string;
}) {
  return (
    <table>
      <thead>
        <tr>
          <th>Branch</th>
          <th>From</th>
          <th>Status</th>
          <th>Last change</th>
        </tr>
      </thead>
      <tbody>
        {branches.map((branch) => (
          <tr key={branch.id}>
            <td>
              <Link href={`${base}/branches/${branch.name}`}>
                <strong>{branch.name}</strong>
              </Link>
            </td>
            <td>
              {branch.baseVersion === null
                ? "empty"
                : `v${branch.baseVersion.number}`}
              {branch.mergedVersion !== null &&
                ` → v${branch.mergedVersion.number}`}
            </td>
            <td>
              <BranchBadge
                status={branchStatusOf(branch)}
                review={reviewOf(branch)}
              />
            </td>
            <td className="muted">{formatDate(branch.updatedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

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
  const [environments, versions, branches] = await Promise.all([
    listEnvironments(actor, project),
    listVersions(actor, project),
    listBranches(actor, project),
  ]);
  const base = `/projects/${project.slug}`;
  const latest = versions[0];
  const source = schemaSourceOf(project);
  const canAuthor = can(actor.role, "author-migrations");
  const canReview = can(actor.role, "review-migrations");
  const canManage = can(actor.role, "manage-projects");
  const openBranches = branches.filter((b) => branchStatusOf(b) === "open");
  const doneBranches = branches.filter((b) => branchStatusOf(b) !== "open");
  const inReview = openBranches.filter((b) => reviewOf(b) === "in_review");
  const approved = openBranches.filter((b) => reviewOf(b) === "approved");
  const working = openBranches.filter(
    (b) => reviewOf(b) === "draft" || reviewOf(b) === "rejected",
  );

  const newBranch = (primary: boolean) => (
    <Link
      href={`${base}/branches/new`}
      className={`button${primary ? " primary" : ""}`}
    >
      New branch
    </Link>
  );
  const openBranch = (branch: BranchRow, label: string) => (
    <Link href={`${base}/branches/${branch.name}`} className="button primary">
      {label}
    </Link>
  );

  let next: ReactNode;
  if (latest === undefined && source === "code") {
    next = (
      <Callout
        title="Add your current schema"
        actions={
          canAuthor ? (
            <>
              <Link href={`${base}/versions/new`} className="button primary">
                Import schema.prisma
              </Link>
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
          schema. It becomes v1 on main, the starting point. After that, every
          change goes through a branch.
        </p>
      </Callout>
    );
  } else if (approved.length > 0 && canAuthor) {
    next = (
      <Callout
        tone="success"
        title={`Branch ${approved[0]!.name} is approved`}
        actions={openBranch(approved[0]!, "Open and merge")}
      >
        <p>Merge it to make it v{(latest?.number ?? 0) + 1} on main.</p>
      </Callout>
    );
  } else if (inReview.length > 0 && canReview) {
    next = (
      <Callout
        title={`Branch ${inReview[0]!.name} is waiting for review`}
        actions={openBranch(inReview[0]!, "Review it")}
      >
        <p>An admin or owner who did not work on it approves it.</p>
      </Callout>
    );
  } else if (working.length > 0 && canAuthor) {
    next = (
      <Callout
        title={`Branch ${working[0]!.name} is in progress`}
        actions={openBranch(working[0]!, "Continue")}
      >
        <p>
          Make the changes, answer Skematron&apos;s questions, test them, then
          submit the branch for review.
        </p>
      </Callout>
    );
  } else if (latest === undefined) {
    next = (
      <Callout
        title="Design your schema"
        actions={canAuthor ? newBranch(true) : undefined}
      >
        <p>
          Start a branch, add your first tables in the schema editor, get it
          reviewed, and merge it to make v1.
        </p>
      </Callout>
    );
  } else if (inReview.length > 0) {
    next = (
      <Callout title={`Branch ${inReview[0]!.name} is waiting for review`}>
        <p>An admin or owner who did not work on it approves it.</p>
      </Callout>
    );
  } else {
    next = (
      <Callout
        tone="success"
        title={`Main is at v${latest.number}`}
        actions={canAuthor ? newBranch(false) : undefined}
      >
        <p>
          To change the schema, start a branch. It stays separate from main
          until it is reviewed and merged, and can be closed if it is not
          needed.
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
          canAuthor && (latest !== undefined || source === "dashboard")
            ? newBranch(true)
            : undefined
        }
      />
      <Flash searchParams={searchParams} />
      {next}

      <div className="stats">
        <Stat
          label="Main"
          value={latest === undefined ? "—" : `v${latest.number}`}
          detail={plural(versions.length, "version")}
        />
        <Stat
          label="Open branches"
          value={openBranches.length}
          detail={`${inReview.length} in review · ${approved.length} approved`}
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
          <h2>Branches</h2>
          <p className="hint">
            Changes in progress. Each one is tested and reviewed, then merged
            into main or closed.
          </p>
        </div>
        {canAuthor && newBranch(false)}
      </div>
      {openBranches.length === 0 ? (
        <Empty title="No open branches">
          <p>Start a branch whenever the schema needs to change.</p>
        </Empty>
      ) : (
        <div className="card flush">
          <BranchTable branches={openBranches} base={base} />
        </div>
      )}
      {doneBranches.length > 0 && (
        <details className="card">
          <summary>
            {plural(
              doneBranches.length,
              "merged or closed branch",
              "merged or closed branches",
            )}
          </summary>
          <BranchTable branches={doneBranches} base={base} />
        </details>
      )}

      <div className="section-head">
        <div>
          <h2>Main</h2>
          <p className="hint">
            The agreed schema, as numbered versions that never change. A version
            is added when a branch is merged.
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
              ? "Start a branch, design the schema, and merge it to make v1."
              : "Import a schema.prisma, or import a version from a connected database, to make v1."}
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
                  branch?: string;
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
                      {origin.kind === "branch" ? (
                        <Link href={`${base}/branches/${origin.branch}`}>
                          Branch {origin.branch}
                        </Link>
                      ) : origin.kind === "prisma-schema" ? (
                        "schema.prisma (baseline)"
                      ) : origin.kind === "dashboard" ? (
                        "Schema editor"
                      ) : (
                        `Database ${origin.environmentName ?? ""} (baseline)`
                      )}
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
                            Import schema
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
