import {
  isEmptyPlan,
  type MigrationPlan,
  type Operation,
  type Risk,
} from "@skematron/core";
import {
  renderPostgresMigration,
  type RenderedStatement,
} from "@skematron/adapters";
import { Callout, plural, RiskBadge } from "./ui.tsx";

const name = (namespace: string, ...parts: string[]) =>
  (namespace === "public" ? parts : [namespace, ...parts]).join(".");

const CONSTRAINT_NAMES = {
  "primary-key": "primary key",
  unique: "unique constraint",
  check: "check",
  "foreign-key": "foreign key",
} as const;

/**
 * One operation in plain language. `technical` marks steps people rarely need to read
 * (sequence bookkeeping, temporary defaults); they are listed separately.
 */
export function describeOperation(operation: Operation): {
  text: string;
  technical: boolean;
} {
  const ns = operation.namespace;
  const plain = (text: string) => ({ text, technical: false });
  const technical = (text: string) => ({ text, technical: true });
  switch (operation.kind) {
    case "rename-table":
      return plain(
        `Rename table ${name(ns, operation.tableName)} to ${operation.newName}`,
      );
    case "rename-column":
      return plain(
        `Rename column ${name(ns, operation.tableName, operation.columnName)} to ${operation.newName}`,
      );
    case "rename-sequence":
      return technical(
        `Rename sequence ${name(ns, operation.sequenceName)} to ${operation.newName}`,
      );
    case "create-namespace":
      return ns === "public"
        ? technical("Make sure schema public exists")
        : plain(`Create schema ${ns}`);
    case "drop-namespace":
      return plain(`Delete schema ${ns}`);
    case "create-enum":
      return plain(
        `Create enum ${name(ns, operation.enum.name)} (${operation.enum.values.join(", ")})`,
      );
    case "add-enum-value":
      return plain(
        `Add value ${operation.value} to enum ${name(ns, operation.enumName)}`,
      );
    case "drop-enum":
      return plain(`Delete enum ${name(ns, operation.enumName)}`);
    case "create-sequence":
      return technical(
        `Create sequence ${name(ns, operation.sequence.name)} (a counter for generated IDs)`,
      );
    case "alter-sequence":
      return technical(`Change sequence ${name(ns, operation.sequence.name)}`);
    case "set-sequence-owner":
      return technical(
        operation.ownedBy === null
          ? `Detach sequence ${name(ns, operation.sequenceName)} from its column`
          : `Attach sequence ${name(ns, operation.sequenceName)} to ${operation.ownedBy.table}.${operation.ownedBy.column}`,
      );
    case "drop-sequence":
      return plain(
        `Delete sequence ${name(ns, operation.sequenceName)} (its counter is lost)`,
      );
    case "create-table":
      return plain(
        `Create table ${name(ns, operation.table.name)} with ${plural(operation.table.columns.length, "column")}: ${operation.table.columns.map((column) => column.name).join(", ")}`,
      );
    case "drop-table":
      return plain(
        `Delete table ${name(ns, operation.tableName)} and all its rows`,
      );
    case "add-column": {
      const { column } = operation;
      const details = [column.type, column.nullable ? "optional" : "required"];
      return plain(
        `Add column ${name(ns, operation.tableName, column.name)} (${details.join(", ")})${operation.backfill === undefined ? "" : `; existing rows get "${operation.backfill}"`}`,
      );
    }
    case "drop-column":
      return plain(
        `Delete column ${name(ns, operation.tableName, operation.columnName)} and its data`,
      );
    case "alter-column-type":
      return plain(
        `Change the type of ${name(ns, operation.tableName, operation.columnName)} to ${operation.type}`,
      );
    case "set-column-default":
      return plain(
        `Set the default of ${name(ns, operation.tableName, operation.columnName)} to ${operation.default}`,
      );
    case "drop-column-default":
      return plain(
        `Remove the default of ${name(ns, operation.tableName, operation.columnName)}`,
      );
    case "set-not-null":
      return plain(
        `Make ${name(ns, operation.tableName, operation.columnName)} required`,
      );
    case "drop-not-null":
      return plain(
        `Make ${name(ns, operation.tableName, operation.columnName)} optional`,
      );
    case "alter-column-identity":
      return plain(
        operation.to === null
          ? `Stop generating values for ${name(ns, operation.tableName, operation.columnName)}`
          : `Generate values for ${name(ns, operation.tableName, operation.columnName)} automatically`,
      );
    case "add-primary-key":
      return plain(
        `Set the primary key of ${name(ns, operation.tableName)} to ${operation.primaryKey.columns.join(", ")}`,
      );
    case "add-unique":
      return plain(
        `Require unique values for ${operation.constraint.columns.join(", ")} in ${name(ns, operation.tableName)}`,
      );
    case "add-check":
      return plain(
        `Add check ${operation.constraint.name} to ${name(ns, operation.tableName)}`,
      );
    case "add-foreign-key": {
      const { foreignKey } = operation;
      return plain(
        `Link ${name(ns, operation.tableName)}.${foreignKey.columns.join(", ")} to ${name(foreignKey.references.namespace, foreignKey.references.table)}.${foreignKey.references.columns.join(", ")}`,
      );
    }
    case "drop-constraint":
      return plain(
        `Remove ${CONSTRAINT_NAMES[operation.constraintKind]} ${operation.constraintName} from ${name(ns, operation.tableName)}`,
      );
    case "create-index":
      return plain(
        `Add ${operation.index.unique ? "unique index" : "index"} ${operation.index.name} on ${name(ns, operation.tableName)}`,
      );
    case "drop-index":
      return plain(
        `Remove index ${operation.indexName} from ${name(ns, operation.tableName)}`,
      );
    case "comment-on-table":
      return plain(
        `Update the description of ${name(ns, operation.tableName)}`,
      );
    case "comment-on-column":
      return plain(
        `Update the description of ${name(ns, operation.tableName, operation.columnName)}`,
      );
  }
}

interface Row {
  operation: Operation;
  statement: RenderedStatement;
  text: string;
}

function isBackfillCleanup(operation: Operation, plan: MigrationPlan): boolean {
  return (
    operation.kind === "drop-column-default" &&
    plan.operations.some(
      ({ operation: other }) =>
        other.kind === "add-column" &&
        other.backfill !== undefined &&
        other.namespace === operation.namespace &&
        other.tableName === operation.tableName &&
        other.column.name === operation.columnName,
    )
  );
}

function ChangeList({ rows }: { rows: Row[] }) {
  return (
    <ul className="changes">
      {rows.map((row, index) => (
        <li key={index}>
          <span>
            <RiskBadge risk={row.statement.risk} />
          </span>
          <span className="what">{row.text}</span>
          {row.statement.warnings.length > 0 && (
            <span className="why">{row.statement.warnings.join(" ")}</span>
          )}
          <details>
            <summary>SQL</summary>
            <pre>{row.statement.sql}</pre>
          </details>
        </li>
      ))}
    </ul>
  );
}

/**
 * A migration plan for people: what changes, in plain language and by risk, with the SQL
 * one click away. Executes nothing.
 */
export function PlanView({
  plan,
  script: storedScript,
  emptyMessage,
}: {
  plan: MigrationPlan;
  /** The stored script of a migration revision, shown instead of a fresh rendering. */
  script?: string;
  emptyMessage: string;
}) {
  if (isEmptyPlan(plan)) {
    return <Callout tone="success" title={emptyMessage} />;
  }
  const rendered = renderPostgresMigration(plan);
  const script = storedScript ?? rendered.script;
  const rows: (Row & { technical: boolean })[] = plan.operations.map(
    ({ operation }, index) => {
      const description = describeOperation(operation);
      return {
        operation,
        statement: rendered.statements[index]!,
        text: description.text,
        technical: description.technical || isBackfillCleanup(operation, plan),
      };
    },
  );
  const main = rows.filter((row) => !row.technical);
  const technical = rows.filter((row) => row.technical);
  const count = (risk: Risk) =>
    rows.filter((row) => row.statement.risk === risk).length;

  return (
    <>
      <p>
        <strong>{plural(rows.length, "change")}</strong>
        {count("destructive") > 0 && (
          <>
            {" "}
            · <RiskBadge risk="destructive" /> {count("destructive")}
          </>
        )}
        {count("caution") > 0 && (
          <>
            {" "}
            · <RiskBadge risk="caution" /> {count("caution")}
          </>
        )}
        {count("safe") > 0 && (
          <>
            {" "}
            · <RiskBadge risk="safe" /> {count("safe")}
          </>
        )}
      </p>
      {plan.unsupported.length > 0 && (
        <Callout tone="danger" title="Some changes cannot be made by Skematron">
          <p>They need manual work, so this plan is incomplete:</p>
          <ul>
            {plan.unsupported.map((change) => (
              <li key={`${change.object}:${change.reason}`}>
                <code>{change.object}</code>: {change.reason}
              </li>
            ))}
          </ul>
        </Callout>
      )}
      <div className="card flush">
        <ChangeList rows={main} />
        {technical.length > 0 && (
          <details
            style={{
              padding: "10px 18px",
              borderTop: "1px solid var(--border)",
            }}
          >
            <summary>
              {plural(technical.length, "technical step")} (sequences, temporary
              defaults)
            </summary>
            <ChangeList rows={technical} />
          </details>
        )}
      </div>
      <details className="card">
        <summary>Full SQL script</summary>
        <p className="hint">
          For review. Skematron does not run it against your databases.
        </p>
        <pre>{script}</pre>
      </details>
    </>
  );
}
