import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { openQuestions } from "@skematron/core";
import {
  authorsOf,
  branchPlan,
  branchStatusOf,
  getBranch,
  testedRevision,
} from "../../../../../../lib/branches.ts";
import { db } from "../../../../../../lib/db.ts";
import { NotFoundError } from "../../../../../../lib/errors.ts";
import {
  latestRevision,
  statusOf,
  summaryOf,
} from "../../../../../../lib/migrations.ts";
import { getProject, schemaSourceOf } from "../../../../../../lib/projects.ts";
import { can } from "../../../../../../lib/roles.ts";
import { requireActor } from "../../../../../../lib/session.ts";
import { listVersions } from "../../../../../../lib/versions.ts";
import { BranchBadge } from "../../../../../components/branch-status.tsx";
import { PlanView } from "../../../../../components/plan-view.tsx";
import { QuestionField } from "../../../../../components/question-field.tsx";
import {
  Breadcrumbs,
  Callout,
  Flash,
  formatDate,
  PageHeader,
  plural,
  shortChecksum,
  Steps,
  type SearchParams,
  type StepState,
} from "../../../../../components/ui.tsx";
import {
  closeBranchAction,
  mergeBranchAction,
  rebaseBranchAction,
  reviewBranchAction,
  submitBranchAction,
  testBranchAction,
} from "../actions.ts";

export const dynamic = "force-dynamic";

export default async function BranchPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string; name: string }>;
  searchParams: SearchParams;
}) {
  const actor = await requireActor();
  const { project: slug, name } = await params;
  let loaded;
  try {
    const project = await getProject(actor, slug);
    loaded = { project, branch: await getBranch(actor, project, name) };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { project, branch } = loaded;
  const [plan, versions] = await Promise.all([
    branchPlan(branch),
    listVersions(actor, project),
  ]);
  const migration = branch.migration;
  const latest = latestRevision(migration);
  const status = branchStatusOf(branch);
  // A merged or closed branch no longer changes: its last test run is final.
  const tested = status === "open" ? testedRevision(branch) : latest;
  const review = migration === null ? "draft" : statusOf(migration);
  const lastReview = migration?.reviews[0];
  const people = new Map(
    (
      await db().user.findMany({
        where: {
          id: {
            in: [
              ...authorsOf(branch),
              ...(migration?.reviews.map((r) => r.reviewerId) ?? []),
            ],
          },
        },
        select: { id: true, name: true },
      })
    ).map((user) => [user.id, user.name]),
  );
  const nameOf = (id: string) => people.get(id) ?? "a former member";
  const revisionNumber = new Map(
    (migration?.revisions ?? []).map((r) => [r.id, r.number]),
  );

  const base = `/projects/${project.slug}`;
  const here = `${base}/branches/${branch.name}`;
  const from =
    branch.baseVersion === null
      ? "an empty schema"
      : `v${branch.baseVersion.number}`;
  const mainLatest = versions[0];
  const nextVersion = (mainLatest?.number ?? 0) + 1;
  const dashboard = schemaSourceOf(project) === "dashboard";
  const canAuthor = can(actor.role, "author-migrations");
  const canReview = can(actor.role, "review-migrations");
  const isAuthor = authorsOf(branch).includes(actor.userId);
  const open = status === "open";
  const changes = plan.operations.length + plan.unsupported.length;
  const openCount = openQuestions(plan).length;
  const passed = tested?.verification === "passed";
  const behind =
    open && (mainLatest?.id ?? null) !== (branch.baseVersionId ?? null);
  const ready =
    open &&
    review === "draft" &&
    changes > 0 &&
    openCount === 0 &&
    plan.unsupported.length === 0 &&
    passed;

  const steps: { label: string; state: StepState }[] = [
    { label: "Make changes", state: changes > 0 ? "done" : "current" },
    {
      label: "Answer questions",
      state: changes === 0 ? "upcoming" : openCount === 0 ? "done" : "current",
    },
    {
      label: "Test run",
      state: passed
        ? "done"
        : tested !== null && tested.verification === "failed"
          ? "failed"
          : changes > 0 && openCount === 0
            ? "current"
            : "upcoming",
    },
    {
      label: "Review",
      state:
        review === "approved" || status === "merged"
          ? "done"
          : review === "rejected"
            ? "failed"
            : review === "in_review" || ready
              ? "current"
              : "upcoming",
    },
    {
      label: "Merge",
      state:
        status === "merged"
          ? "done"
          : review === "approved"
            ? "current"
            : "upcoming",
    },
    { label: "Apply (coming later)", state: "later" },
  ];

  const hidden = (
    <>
      <input type="hidden" name="project" value={project.slug} />
      <input type="hidden" name="branch" value={branch.name} />
    </>
  );
  const changeLink = (primary: boolean) =>
    dashboard ? (
      <Link
        href={`${here}/edit`}
        className={`button${primary ? " primary" : ""}`}
      >
        Edit schema
      </Link>
    ) : (
      <Link
        href={`${here}/upload`}
        className={`button${primary ? " primary" : ""}`}
      >
        Upload schema.prisma
      </Link>
    );
  const runTest = (label: string) => (
    <form action={testBranchAction}>
      {hidden}
      <button type="submit" className="primary">
        {label}
      </button>
    </form>
  );

  let next: ReactNode;
  if (status === "merged") {
    next = (
      <Callout
        tone="success"
        title={`Merged into main as v${branch.mergedVersion?.number}`}
        actions={
          <Link
            href={`${base}/versions/${branch.mergedVersion?.number}`}
            className="button"
          >
            View v{branch.mergedVersion?.number}
          </Link>
        }
      >
        <p>
          Running it against your databases comes in a later release; until
          then, download the SQL and apply it with your usual tools.
        </p>
      </Callout>
    );
  } else if (status === "closed") {
    next = (
      <Callout title="This branch is closed">
        <p>
          It was closed
          {branch.closedAt === null ? "" : ` on ${formatDate(branch.closedAt)}`}
          . Nothing was added to main.
        </p>
      </Callout>
    );
  } else if (behind) {
    next = (
      <Callout
        tone="warning"
        title={`Main moved on to v${mainLatest?.number}`}
        actions={
          canAuthor ? (
            <form action={rebaseBranchAction}>
              {hidden}
              <button type="submit" className="primary">
                Rebase onto v{mainLatest?.number}
              </button>
            </form>
          ) : undefined
        }
      >
        <p>
          This branch started from {from}. Rebase it to compare with the newest
          main: the list below then also shows anything that would undo the
          newer changes
          {dashboard ? "" : ", so upload a schema.prisma that includes them"}.
          It then needs a new test and review.
        </p>
      </Callout>
    );
  } else if (changes === 0) {
    next = (
      <Callout
        title="Make your changes"
        actions={canAuthor ? changeLink(true) : undefined}
      >
        <p>
          {dashboard
            ? "Add tables and columns in the schema editor."
            : "Upload the schema.prisma with your changes."}{" "}
          The changes compared with {from} then appear below.
        </p>
      </Callout>
    );
  } else if (review === "in_review") {
    next =
      canReview && !isAuthor && tested !== null ? (
        <Callout title="Your review">
          <p>
            Read the changes below. Approving means they may be merged into main
            as v{nextVersion} and later applied to your databases.
          </p>
          <form action={reviewBranchAction} className="stack">
            {hidden}
            <input type="hidden" name="revision" value={tested.id} />
            {summaryOf(tested).destructive > 0 && (
              <label className="choice">
                <input type="checkbox" name="acknowledgeDestructive" />I
                understand that{" "}
                {plural(summaryOf(tested).destructive, "change")}{" "}
                {summaryOf(tested).destructive === 1 ? "deletes" : "delete"}{" "}
                data.
              </label>
            )}
            <label>
              Comment
              <textarea
                name="comment"
                rows={3}
                maxLength={2000}
                placeholder="Required when requesting changes"
              />
            </label>
            <div className="toolbar">
              <button
                type="submit"
                name="verdict"
                value="approved"
                className="primary"
              >
                Approve revision {tested.number}
              </button>
              <button
                type="submit"
                name="verdict"
                value="rejected"
                className="danger"
              >
                Request changes
              </button>
            </div>
          </form>
        </Callout>
      ) : (
        <Callout title="Waiting for review">
          <p>
            {isAuthor
              ? "You worked on this branch, so another admin or owner has to review it."
              : "An admin or owner who did not work on it approves it or requests changes."}
          </p>
        </Callout>
      );
  } else if (review === "approved") {
    next = (
      <Callout
        tone="success"
        title={`Approved by ${lastReview === undefined ? "a reviewer" : nameOf(lastReview.reviewerId)}: ready to merge`}
        actions={
          canAuthor ? (
            <form action={mergeBranchAction}>
              {hidden}
              <button type="submit" className="primary">
                Merge into main as v{nextVersion}
              </button>
            </form>
          ) : undefined
        }
      >
        <p>
          Merging records this branch as v{nextVersion}, the next version on
          main. Any later change to the branch would need a new review.
        </p>
      </Callout>
    );
  } else if (openCount > 0) {
    next = (
      <Callout
        title={`Answer ${plural(openCount, "question")}`}
        actions={
          canAuthor ? (
            <a href="#questions" className="button primary">
              Go to the questions
            </a>
          ) : undefined
        }
      >
        <p>
          {review === "rejected" && lastReview !== undefined
            ? `Changes were requested by ${nameOf(lastReview.reviewerId)}: “${lastReview.comment}”. `
            : ""}
          Skematron found changes it cannot decide alone, such as whether a
          column was renamed. Your answers decide whether data is kept.
        </p>
      </Callout>
    );
  } else if (plan.unsupported.length > 0) {
    next = (
      <Callout tone="danger" title="These changes need manual work">
        <p>
          Some changes cannot be expressed as a migration (listed below), so the
          branch cannot be submitted.
        </p>
      </Callout>
    );
  } else if (tested === null) {
    next = (
      <Callout
        title={latest === null ? "Test the changes" : "Test the latest changes"}
        actions={canAuthor ? runTest("Run the test") : undefined}
      >
        <p>
          {review === "rejected" && lastReview !== undefined
            ? `Changes were requested by ${nameOf(lastReview.reviewerId)}: “${lastReview.comment}”. `
            : ""}
          Skematron rebuilds {from} in a temporary database, runs these changes
          there, and checks that the result is exactly this branch. It takes a
          few seconds.
        </p>
      </Callout>
    );
  } else if (tested.verification === "failed") {
    next = (
      <Callout
        tone="danger"
        title="The test run failed"
        actions={canAuthor ? changeLink(false) : undefined}
      >
        <p>{tested.verificationDetail}</p>
        <p>Change the branch or the answers below, then test again.</p>
      </Callout>
    );
  } else if (tested.verification === "unavailable") {
    next = (
      <Callout
        tone="warning"
        title="The test run could not start"
        actions={canAuthor ? runTest("Run the test again") : undefined}
      >
        <p>{tested.verificationDetail}</p>
      </Callout>
    );
  } else {
    next = (
      <Callout
        title="Ready for review"
        actions={
          canAuthor ? (
            <form action={submitBranchAction}>
              {hidden}
              <button type="submit" className="primary">
                Submit for review
              </button>
            </form>
          ) : undefined
        }
      >
        <p>
          {review === "rejected" && lastReview !== undefined
            ? `Changes were requested by ${nameOf(lastReview.reviewerId)}: “${lastReview.comment}”. `
            : ""}
          All questions are answered and the test run passed. An admin or owner
          who did not work on the branch reviews it.
        </p>
      </Callout>
    );
  }

  const questionsFirst = open && review === "draft" && openCount > 0;
  const questionForm = (
    <form
      action={testBranchAction}
      className={questionsFirst ? "stack card" : "stack"}
    >
      {hidden}
      <input type="hidden" name="withAnswers" value="yes" />
      {plan.questions.map((question) => (
        <QuestionField
          key={question.id}
          question={question}
          disabled={!canAuthor || !open}
        />
      ))}
      {canAuthor && open && (
        <div>
          <button type="submit" className="primary">
            Save answers and test
          </button>
        </div>
      )}
    </form>
  );

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: base },
          { label: `Branch ${branch.name}` },
        ]}
      />
      <PageHeader
        title={branch.name}
        badge={<BranchBadge status={status} review={review} />}
        subtitle={
          <>
            A branch from{" "}
            {branch.baseVersion === null ? (
              from
            ) : (
              <Link href={`${base}/versions/${branch.baseVersion.number}`}>
                {from}
              </Link>
            )}
            , started by {nameOf(branch.createdById)} on{" "}
            {formatDate(branch.createdAt)}. Last changed{" "}
            {formatDate(branch.updatedAt)}.
          </>
        }
        actions={
          <>
            {tested !== null && (
              <a href={`${here}/migration.sql`} className="button">
                Download SQL
              </a>
            )}
            {open && canAuthor && changes > 0 && changeLink(false)}
          </>
        }
      />
      <Steps steps={steps} />
      <Flash searchParams={searchParams} />
      {next}

      {questionsFirst && (
        <>
          <div className="section-head" id="questions">
            <div>
              <h2>Questions</h2>
              <p className="hint">
                Skematron matches tables and columns by name, so it asks instead
                of guessing.
              </p>
            </div>
          </div>
          {questionForm}
        </>
      )}

      <div className="section-head">
        <div>
          <h2>Changes compared with {from}</h2>
          <p className="hint">
            {changes === 0
              ? ""
              : passed
                ? `✓ Tested: Skematron rebuilt ${from} in a temporary database, ran these changes there, and got exactly this branch.`
                : tested === null
                  ? "Not tested since the last change."
                  : "The last test run did not pass."}
          </p>
        </div>
      </div>
      <PlanView
        plan={plan}
        emptyMessage={`No changes yet: the branch is the same as ${from}.`}
      />

      {!questionsFirst && plan.questions.length > 0 && (
        <details className="card" id="questions">
          <summary>
            Answers to {plural(plan.questions.length, "question")}
            {canAuthor && open ? " (change them)" : ""}
          </summary>
          {open && review !== "draft" && (
            <p className="hint">
              Saving new answers makes a new revision that needs a new review.
            </p>
          )}
          {questionForm}
        </details>
      )}

      {migration !== null && migration.revisions.length > 0 && (
        <details className="card">
          <summary>
            History ({plural(migration.revisions.length, "test run")}
            {migration.reviews.length > 0
              ? `, ${plural(migration.reviews.length, "review")}`
              : ""}
            )
          </summary>
          <table>
            <thead>
              <tr>
                <th>Revision</th>
                <th>By</th>
                <th>When</th>
                <th>Open questions</th>
                <th>Changes</th>
                <th>Test run</th>
                <th>Script</th>
              </tr>
            </thead>
            <tbody>
              {migration.revisions.map((r) => {
                const counts = summaryOf(r);
                return (
                  <tr key={r.id}>
                    <td>{r.number}</td>
                    <td>{nameOf(r.createdById)}</td>
                    <td>{formatDate(r.createdAt)}</td>
                    <td>{r.openQuestions}</td>
                    <td>
                      {counts.total}
                      {counts.destructive > 0 &&
                        ` (${counts.destructive} delete data)`}
                    </td>
                    <td>{r.verification}</td>
                    <td>
                      <code>{shortChecksum(r.scriptChecksum)}</code>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {migration.reviews.length > 0 && (
            <table style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Review</th>
                  <th>By</th>
                  <th>Revision</th>
                  <th>When</th>
                  <th>Comment</th>
                </tr>
              </thead>
              <tbody>
                {migration.reviews.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.verdict === "approved"
                        ? "approved"
                        : "changes requested"}
                    </td>
                    <td>{nameOf(r.reviewerId)}</td>
                    <td>{revisionNumber.get(r.revisionId)}</td>
                    <td>{formatDate(r.createdAt)}</td>
                    <td>{r.comment ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </details>
      )}

      {open && canAuthor && (
        <details className="card">
          <summary>Close this branch</summary>
          <p>
            Closing keeps the branch for the record but stops all work on it.
            Nothing is added to main. Use it when the change is no longer
            needed.
          </p>
          <form action={closeBranchAction}>
            {hidden}
            <button type="submit" className="danger">
              Close branch
            </button>
          </form>
        </details>
      )}
    </>
  );
}
