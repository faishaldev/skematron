import type { Question } from "@skematron/core";

const display = (namespace: string, ...parts: string[]) =>
  (namespace === "public" ? parts : [namespace, ...parts]).join(".");

/** One planner question as plain choices; posts `answer:<id>` (and `value:<id>`). */
export function QuestionField({
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
