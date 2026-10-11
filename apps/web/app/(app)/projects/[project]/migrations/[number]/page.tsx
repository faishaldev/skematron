import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import type { Question } from "@skematron/core";
import { db } from "../../../../../../lib/db.ts";
import { NotFoundError } from "../../../../../../lib/errors.ts";
import {
  getMigration,
  latestRevision,
  loadRevision,
  statusOf,
  summaryOf,
} from "../../../../../../lib/migrations.ts";
import { getProject } from "../../../../../../lib/projects.ts";
import { can } from "../../../../../../lib/roles.ts";
import { requireActor } from "../../../../../../lib/session.ts";
import { StatusBadge } from "../../../../../components/migration-status.tsx";
import { PlanView } from "../../../../../components/plan-view.tsx";
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
  answerQuestionsAction,
  reviewMigrationAction,
  submitMigrationAction,
} from "../actions.ts";

export const dynamic = "force-dynamic";

const display = (namespace: string, ...parts: string[]) =>
  (namespace === "public" ? parts : [namespace, ...parts]).join(".");

function QuestionField({
  question,
  disabled,
}: {
  question: Question;
  disabled: boolean;
}) {
  const name = `answer:${question.id}`;
  const answer = question.answer;
  if (question.kind === "backfill") {
    const column = display(
      question.namespace,
      question.tableName,
      question.columnName,
    );
    return (
      <fieldset disabled={disabled}>
        <legend>What should existing rows get in {column}?</legend>
        <p className="hint">
          The column is new and required ({question.type}), and has no default,
          so rows that already exist need a value.
        </p>
        <label className="option">
          <input
            type="radio"
            name={name}
            value="backfill"
            defaultChecked={answer?.choice === "backfill"}
          />
          <span style={{ display: "grid", gap: 6, flex: 1 }}>
            <strong>This value</strong>
            <input
              name={`value:${question.id}`}
              maxLength={1000}
              defaultValue={answer?.choice === "backfill" ? answer.value : ""}
              placeholder="e.g. untitled, 0, false"
            />
            <span className="hint">
              Only existing rows get it; new rows still need their own value.
            </span>
          </span>
        </label>
        <label className="option">
          <input
            type="radio"
            name={name}
            value="skip"
            defaultChecked={answer?.choice === "skip"}
          />
          <span>
            <strong>Nothing</strong>
            <span className="hint">
              Only works while the table is empty; otherwise the migration
              fails.
            </span>
          </span>
        </label>
      </fieldset>
    );
  }
  const subject =
    question.kind === "rename-table"
      ? `table ${display(question.namespace, question.tableName)}`
      : question.kind === "rename-column"
        ? `column ${display(question.namespace, question.tableName, question.columnName)}`
        : `sequence ${display(question.namespace, question.sequenceName)}`;
  return (
    <fieldset disabled={disabled}>
      <legend>Was {subject} renamed?</legend>
      <p className="hint">
        It is missing from the new version, and something similar was added.
      </p>
      {question.candidates.map((candidate) => (
        <label className="option" key={candidate}>
          <input
            type="radio"
            name={name}
            value={`rename:${candidate}`}
            defaultChecked={
              answer?.choice === "rename" && answer.to === candidate
            }
          />
          <span>
            <strong>Yes, renamed to {candidate}</strong>
            <span className="hint">
              {question.kind === "rename-sequence"
                ? "Keeps its counter, so new IDs continue where they were."
                : "Keeps the existing data."}
            </span>
          </span>
        </label>
      ))}
      <label className="option">
        <input
          type="radio"
          name={name}
          value="drop"
          defaultChecked={answer?.choice === "drop"}
        />
        <span>
          <strong>No, it was removed</strong>
          <span className="hint">
            {question.kind === "rename-sequence"
              ? "The counter is dropped and a new one starts again."
              : "Deletes it and its data; the new one starts empty."}
          </span>
        </span>
      </label>
    </fieldset>
  );
}

export default async function MigrationPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string; number: string }>;
  searchParams: SearchParams;
}) {
  const actor = await requireActor();
  const { project: slug, number } = await params;
  let loaded;
  try {
    const project = await getProject(actor, slug);
    const migration = await getMigration(
      actor,
      project,
      /^\d{1,9}$/.test(number) ? Number(number) : Number.NaN,
    );
    loaded = { project, migration };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { project, migration } = loaded;
  const revision = latestRevision(migration);
  const { plan, script } = await loadRevision(revision);
  const status = statusOf(migration);
  const summary = summaryOf(revision);
  const people = new Map(
    (
      await db().user.findMany({
        where: {
          id: {
            in: [
              migration.createdById,
              ...migration.revisions.map((r) => r.createdById),
              ...migration.reviews.map((r) => r.reviewerId),
            ],
          },
        },
        select: { id: true, name: true },
      })
    ).map((user) => [user.id, user.name]),
  );
  const nameOf = (id: string) => people.get(id) ?? "a former member";
  const revisionNumber = new Map(
    migration.revisions.map((r) => [r.id, r.number]),
  );
  const base = `/projects/${project.slug}`;
  const here = `${base}/migrations/${migration.number}`;
  const from = `v${migration.fromVersion.number}`;
  const to = `v${migration.toVersion.number}`;
  const canAuthor = can(actor.role, "author-migrations");
  const canReview = can(actor.role, "review-migrations");
  const wroteIt =
    actor.userId === migration.createdById ||
    actor.userId === revision.createdById;
  const lastReview = migration.reviews[0];
  const open = revision.openQuestions;
  const tested = revision.verification === "passed";
  const ready = open === 0 && revision.unsupportedChanges === 0 && tested;

  const steps: { label: string; state: StepState }[] = [
    {
      label: "Answer questions",
      state: open === 0 ? "done" : "current",
    },
    {
      label: "Test run",
      state: tested
        ? "done"
        : revision.verification === "failed"
          ? "failed"
          : open === 0
            ? "current"
            : "upcoming",
    },
    {
      label: "Review",
      state:
        status === "approved"
          ? "done"
          : status === "rejected"
            ? "failed"
            : status === "in_review" || ready
              ? "current"
              : "upcoming",
    },
    { label: "Approved", state: status === "approved" ? "done" : "upcoming" },
    { label: "Apply (coming later)", state: "later" },
  ];

  const hidden = (
    <>
      <input type="hidden" name="project" value={project.slug} />
      <input type="hidden" name="migration" value={migration.number} />
    </>
  );
  const rerun = (
    <form action={answerQuestionsAction}>
      {hidden}
      <button type="submit">Run the test again</button>
    </form>
  );

  let next: ReactNode;
  if (status === "approved" && lastReview !== undefined) {
    next = (
      <Callout
        tone="success"
        title={`Approved by ${nameOf(lastReview.reviewerId)}`}
        actions={
          <a href={`${here}/migration.sql`} className="button primary">
            Download SQL
          </a>
        }
      >
        <p>
          Revision {revisionNumber.get(lastReview.revisionId)} was approved on{" "}
          {formatDate(lastReview.createdAt)}. Apply the SQL with your usual
          tools for now; running migrations from Skematron comes in a later
          release. Changing an answer makes a new revision that needs a new
          review.
        </p>
      </Callout>
    );
  } else if (status === "rejected" && lastReview !== undefined) {
    next = (
      <Callout
        tone="danger"
        title={`Rejected by ${nameOf(lastReview.reviewerId)}`}
      >
        <p>&ldquo;{lastReview.comment}&rdquo;</p>
        <p>
          Change the answers below to make a new revision, then submit it again.
        </p>
      </Callout>
    );
  } else if (status === "in_review") {
    next =
      canReview && !wroteIt ? (
        <Callout title="Your review">
          <p>
            Read the changes below. Approving means a database may be changed
            exactly this way.
          </p>
          <form action={reviewMigrationAction} className="stack">
            {hidden}
            <input type="hidden" name="revision" value={revision.id} />
            {summary.destructive > 0 && (
              <label className="choice">
                <input type="checkbox" name="acknowledgeDestructive" />I
                understand that {plural(summary.destructive, "change")}{" "}
                {summary.destructive === 1 ? "deletes" : "delete"} data.
              </label>
            )}
            <label>
              Comment
              <textarea
                name="comment"
                rows={3}
                maxLength={2000}
                placeholder="Required when rejecting"
              />
            </label>
            <div className="toolbar">
              <button
                type="submit"
                name="verdict"
                value="approved"
                className="primary"
              >
                Approve revision {revision.number}
              </button>
              <button
                type="submit"
                name="verdict"
                value="rejected"
                className="danger"
              >
                Reject
              </button>
            </div>
          </form>
        </Callout>
      ) : (
        <Callout title="Waiting for review">
          <p>
            {wroteIt
              ? "You wrote this migration, so another admin or owner has to approve or reject it."
              : "An admin or owner who did not write it approves or rejects it."}
          </p>
        </Callout>
      );
  } else if (open > 0) {
    next = (
      <Callout
        title={`Answer ${plural(open, "question")}`}
        actions={
          canAuthor ? (
            <a href="#questions" className="button primary">
              Go to the questions
            </a>
          ) : undefined
        }
      >
        <p>
          Skematron found changes it cannot decide alone, such as whether a
          column was renamed. Your answers decide whether data is kept.
        </p>
      </Callout>
    );
  } else if (revision.unsupportedChanges > 0) {
    next = (
      <Callout tone="danger" title="This migration needs manual work">
        <p>
          Some changes cannot be expressed as a migration (listed below), so it
          cannot be submitted.
        </p>
      </Callout>
    );
  } else if (revision.verification === "failed") {
    next = (
      <Callout tone="danger" title="The test run failed">
        <p>{revision.verificationDetail}</p>
        <p>
          Change the answers below, or fix the versions this migration goes
          between.
        </p>
      </Callout>
    );
  } else if (revision.verification === "unavailable") {
    next = (
      <Callout
        tone="warning"
        title="The test run could not start"
        actions={canAuthor ? rerun : undefined}
      >
        <p>{revision.verificationDetail}</p>
      </Callout>
    );
  } else {
    next = (
      <Callout
        title="Ready for review"
        actions={
          canAuthor ? (
            <form action={submitMigrationAction}>
              {hidden}
              <button type="submit" className="primary">
                Submit for review
              </button>
            </form>
          ) : undefined
        }
      >
        <p>
          All questions are answered and the test run passed. An admin or owner
          who did not write it approves or rejects it.
        </p>
      </Callout>
    );
  }

  const questionsFirst = status === "draft" && open > 0;
  const questionForm = (
    <form
      action={answerQuestionsAction}
      className={questionsFirst ? "stack card" : "stack"}
    >
      {hidden}
      {plan.questions.map((question) => (
        <QuestionField
          key={question.id}
          question={question}
          disabled={!canAuthor}
        />
      ))}
      {canAuthor && (
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
          { label: `M${migration.number}` },
        ]}
      />
      <PageHeader
        title={`M${migration.number} · ${migration.title}`}
        badge={<StatusBadge status={status} />}
        subtitle={
          <>
            Changes the schema from{" "}
            <Link href={`${base}/versions/${migration.fromVersion.number}`}>
              {from}
            </Link>{" "}
            to{" "}
            <Link href={`${base}/versions/${migration.toVersion.number}`}>
              {to}
            </Link>
            . Created by {nameOf(migration.createdById)} on{" "}
            {formatDate(migration.createdAt)}.
          </>
        }
        actions={
          <a href={`${here}/migration.sql`} className="button">
            Download SQL
          </a>
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
          <h2>What this migration does</h2>
          <p className="hint">
            {tested ? (
              <>
                ✓ Tested: Skematron rebuilt {from} in a temporary database, ran
                these changes there, and got exactly {to}.
              </>
            ) : (
              "Not tested successfully yet."
            )}
          </p>
        </div>
      </div>
      <PlanView plan={plan} script={script} emptyMessage="No changes." />

      {!questionsFirst && plan.questions.length > 0 && (
        <details className="card" id="questions">
          <summary>
            Answers to {plural(plan.questions.length, "question")}
            {canAuthor ? " (change them)" : ""}
          </summary>
          {status === "draft" ? null : (
            <p className="hint">
              Saving new answers makes a new revision and sends the migration
              back to draft.
            </p>
          )}
          {questionForm}
        </details>
      )}

      <details className="card">
        <summary>
          History ({plural(migration.revisions.length, "revision")}
          {migration.reviews.length > 0
            ? `, ${plural(migration.reviews.length, "review")}`
            : ""}
          )
        </summary>
        <p className="hint">
          Every change of answers saves a new revision; old ones are kept
          unchanged.
        </p>
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
              {migration.reviews.map((review) => (
                <tr key={review.id}>
                  <td>{review.verdict}</td>
                  <td>{nameOf(review.reviewerId)}</td>
                  <td>{revisionNumber.get(review.revisionId)}</td>
                  <td>{formatDate(review.createdAt)}</td>
                  <td>{review.comment ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </details>
    </>
  );
}
