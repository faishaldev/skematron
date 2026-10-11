import Link from "next/link";
import type { ReactNode } from "react";
import { branchStatusOf, listBranches } from "../../../../lib/branches.ts";
import { resolveProject } from "../../../../lib/project-pages.ts";
import { listEnvironments, schemaSourceOf } from "../../../../lib/projects.ts";
import { can } from "../../../../lib/roles.ts";
import { listVersions, loadSnapshot } from "../../../../lib/versions.ts";
import { SchemaDiagram } from "../../../components/diagram.tsx";
import {
  BranchTable,
  reviewOf,
  type BranchRow,
} from "../../../components/project-tables.tsx";
import {
  Breadcrumbs,
  Callout,
  Flash,
  PageHeader,
  plural,
  Stat,
  type SearchParams,
} from "../../../components/ui.tsx";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: SearchParams;
}) {
  const { actor, project } = await resolveProject(params);
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
  const inReview = openBranches.filter((b) => reviewOf(b) === "in_review");
  const approved = openBranches.filter((b) => reviewOf(b) === "approved");
  const working = openBranches.filter(
    (b) => reviewOf(b) === "draft" || reviewOf(b) === "rejected",
  );
  const mainSnapshot = latest === undefined ? null : await loadSnapshot(latest);

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
          detail={
            <Link href={`${base}/versions`}>
              {plural(versions.length, "version")}
            </Link>
          }
        />
        <Stat
          label="Open branches"
          value={openBranches.length}
          detail={
            <Link href={`${base}/branches`}>
              {inReview.length} in review · {approved.length} approved
            </Link>
          }
        />
        <Stat
          label="Databases"
          value={environments.length}
          detail={
            <Link href={`${base}/environments`}>
              {environments.length === 0
                ? "none connected"
                : environments
                    .map((environment) => environment.name)
                    .join(", ")}
            </Link>
          }
        />
      </div>

      {openBranches.length > 0 && (
        <>
          <div className="section-head">
            <div>
              <h2>Open branches</h2>
              <p className="hint">
                Changes in progress, kept apart from main until they are
                reviewed and merged.
              </p>
            </div>
            <Link href={`${base}/branches`} className="button">
              All branches
            </Link>
          </div>
          <div className="card flush">
            <BranchTable branches={openBranches.slice(0, 5)} base={base} />
          </div>
        </>
      )}

      {mainSnapshot !== null && latest !== undefined && (
        <>
          <div className="section-head">
            <div>
              <h2>Schema on main (v{latest.number})</h2>
              <p className="hint">
                Tables and how they link to each other. Hover a line to see the
                columns it connects.
              </p>
            </div>
            <Link href={`${base}/diagram`} className="button">
              Open diagram
            </Link>
          </div>
          <SchemaDiagram snapshot={mainSnapshot} />
        </>
      )}
    </>
  );
}
