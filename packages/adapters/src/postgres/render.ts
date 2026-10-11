import type {
  CheckConstraint,
  Column,
  Deferrability,
  ForeignKey,
  IdentityKind,
  MigrationPlan,
  Operation,
  PrimaryKey,
  ReferentialAction,
  Risk,
  Sequence,
  Table,
  UniqueConstraint,
} from "@skematron/core";
import {
  commentText,
  quoteIdent,
  quoteLiteral,
  quoteQualified,
} from "./quote.ts";

export interface RenderedStatement {
  /** One SQL statement without the trailing semicolon. */
  sql: string;
  risk: Risk;
  warnings: string[];
}

export interface RenderedMigration {
  /** In execution order, one per planned operation. */
  statements: RenderedStatement[];
  /** The full script for review: a header, then each statement with its risk and warnings. */
  script: string;
}

/**
 * Renders a migration plan as PostgreSQL SQL for review. Rendering executes
 * nothing. Identifiers are always quoted; SQL fragments stored in the snapshot
 * (types, defaults, expressions, index definitions) are inserted verbatim.
 */
export function renderPostgresMigration(
  plan: MigrationPlan,
): RenderedMigration {
  if (plan.dialect !== "postgresql") {
    throw new Error(`Cannot render a ${plan.dialect} plan as PostgreSQL.`);
  }
  const statements = plan.operations.map((planned) => ({
    sql: renderOperation(planned.operation),
    risk: planned.risk,
    warnings: planned.warnings,
  }));
  return { statements, script: renderScript(plan, statements) };
}

/**
 * The definition of a new B-tree index on plain columns, for snapshots edited by hand.
 * PostgreSQL prints definitions in its own style (`pg_get_indexdef`); run the result
 * through a real database and introspect it to get the stored form.
 */
export function renderIndexDefinition(input: {
  namespace: string;
  tableName: string;
  name: string;
  columns: readonly string[];
  unique: boolean;
}): string {
  if (input.columns.length === 0)
    throw new Error("An index needs at least one column.");
  return `CREATE ${input.unique ? "UNIQUE " : ""}INDEX ${quoteIdent(input.name)} ON ${quoteQualified(input.namespace, input.tableName)} USING btree (${columnList(input.columns)})`;
}

function renderScript(
  plan: MigrationPlan,
  statements: RenderedStatement[],
): string {
  const count = (risk: Risk) =>
    statements.filter((statement) => statement.risk === risk).length;
  const lines = [
    "-- Skematron migration plan for PostgreSQL. Nothing has been executed.",
    "-- Review every statement before applying it.",
    `-- Operations: ${statements.length} (${count("destructive")} destructive, ${count("caution")} caution, ${count("safe")} safe)`,
  ];
  const open = plan.questions.filter((question) => question.answer === null);
  if (open.length > 0) {
    lines.push(
      "--",
      `-- OPEN QUESTIONS: ${open.length}. Answer them before applying; the answers can change this plan.`,
    );
  }
  if (plan.unsupported.length > 0) {
    lines.push(
      "--",
      "-- UNSUPPORTED CHANGES: this plan is incomplete. Handle these manually:",
    );
    for (const change of plan.unsupported)
      lines.push(`--   ${commentText(`${change.object}: ${change.reason}`)}`);
  }
  const destructive = statements.filter(
    (statement) => statement.risk === "destructive",
  );
  if (destructive.length > 0) {
    lines.push("--", "-- DESTRUCTIVE OPERATIONS:");
    for (const statement of destructive)
      lines.push(`--   ${summarize(statement.sql)}`);
  }
  if (statements.length === 0) lines.push("--", "-- No changes.");
  for (const statement of statements) {
    const note =
      statement.warnings.length > 0 ? ` ${statement.warnings.join(" ")}` : "";
    lines.push(
      "",
      `-- [${statement.risk}]${commentText(note)}`,
      `${statement.sql};`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function summarize(sql: string): string {
  const line = commentText(sql);
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

function renderOperation(operation: Operation): string {
  const { namespace } = operation;
  switch (operation.kind) {
    case "rename-table":
      return `ALTER TABLE ${quoteQualified(namespace, operation.tableName)} RENAME TO ${quoteIdent(operation.newName)}`;
    case "rename-column":
      return `${alterTable(namespace, operation.tableName)} RENAME COLUMN ${quoteIdent(operation.columnName)} TO ${quoteIdent(operation.newName)}`;
    case "rename-sequence":
      return `ALTER SEQUENCE ${quoteQualified(namespace, operation.sequenceName)} RENAME TO ${quoteIdent(operation.newName)}`;
    case "create-namespace":
      return `CREATE SCHEMA IF NOT EXISTS ${quoteIdent(namespace)}`;
    case "drop-namespace":
      return `DROP SCHEMA ${quoteIdent(namespace)}`;
    case "create-enum":
      return `CREATE TYPE ${quoteQualified(namespace, operation.enum.name)} AS ENUM (${operation.enum.values.map(quoteLiteral).join(", ")})`;
    case "add-enum-value": {
      const { position } = operation;
      const placement =
        position === null
          ? ""
          : "before" in position
            ? ` BEFORE ${quoteLiteral(position.before)}`
            : ` AFTER ${quoteLiteral(position.after)}`;
      return `ALTER TYPE ${quoteQualified(namespace, operation.enumName)} ADD VALUE ${quoteLiteral(operation.value)}${placement}`;
    }
    case "drop-enum":
      return `DROP TYPE ${quoteQualified(namespace, operation.enumName)}`;
    case "create-sequence":
      return `CREATE SEQUENCE ${quoteQualified(namespace, operation.sequence.name)} ${sequenceOptions(operation.sequence)}`;
    case "alter-sequence":
      return `ALTER SEQUENCE ${quoteQualified(namespace, operation.sequence.name)} ${sequenceOptions(operation.sequence)}`;
    case "set-sequence-owner": {
      const owner =
        operation.ownedBy === null
          ? "NONE"
          : quoteQualified(
              namespace,
              operation.ownedBy.table,
              operation.ownedBy.column,
            );
      return `ALTER SEQUENCE ${quoteQualified(namespace, operation.sequenceName)} OWNED BY ${owner}`;
    }
    case "drop-sequence":
      return `DROP SEQUENCE ${quoteQualified(namespace, operation.sequenceName)}`;
    case "create-table":
      return createTable(namespace, operation.table);
    case "drop-table":
      return `DROP TABLE ${quoteQualified(namespace, operation.tableName)}`;
    case "add-column": {
      // A backfill fills existing rows through a temporary default; the planner drops it later.
      const column =
        operation.backfill === undefined
          ? operation.column
          : {
              ...operation.column,
              default: `${quoteLiteral(operation.backfill)}::${operation.column.type}`,
            };
      return `${alterTable(namespace, operation.tableName)} ADD COLUMN ${columnDefinition(column)}`;
    }
    case "drop-column":
      return `${alterTable(namespace, operation.tableName)} DROP COLUMN ${quoteIdent(operation.columnName)}`;
    case "alter-column-type": {
      const collation =
        operation.collation === null ? "" : ` COLLATE ${operation.collation}`;
      return `${alterColumn(namespace, operation.tableName, operation.columnName)} TYPE ${operation.type}${collation}`;
    }
    case "set-column-default":
      return `${alterColumn(namespace, operation.tableName, operation.columnName)} SET DEFAULT ${operation.default}`;
    case "drop-column-default":
      return `${alterColumn(namespace, operation.tableName, operation.columnName)} DROP DEFAULT`;
    case "set-not-null":
      return `${alterColumn(namespace, operation.tableName, operation.columnName)} SET NOT NULL`;
    case "drop-not-null":
      return `${alterColumn(namespace, operation.tableName, operation.columnName)} DROP NOT NULL`;
    case "alter-column-identity": {
      const prefix = alterColumn(
        namespace,
        operation.tableName,
        operation.columnName,
      );
      if (operation.to === null) return `${prefix} DROP IDENTITY`;
      if (operation.from === null)
        return `${prefix} ADD GENERATED ${identityKeyword(operation.to)} AS IDENTITY`;
      return `${prefix} SET GENERATED ${identityKeyword(operation.to)}`;
    }
    case "add-primary-key":
      return `${alterTable(namespace, operation.tableName)} ADD ${primaryKeyClause(operation.primaryKey)}`;
    case "add-unique":
      return `${alterTable(namespace, operation.tableName)} ADD ${uniqueClause(operation.constraint)}`;
    case "add-check":
      return `${alterTable(namespace, operation.tableName)} ADD ${checkClause(operation.constraint)}`;
    case "add-foreign-key":
      return `${alterTable(namespace, operation.tableName)} ADD ${foreignKeyClause(operation.foreignKey)}`;
    case "drop-constraint":
      return `${alterTable(namespace, operation.tableName)} DROP CONSTRAINT ${quoteIdent(operation.constraintName)}`;
    case "create-index":
      return operation.index.definition;
    case "drop-index":
      return `DROP INDEX ${quoteQualified(namespace, operation.indexName)}`;
    case "comment-on-table":
      return `COMMENT ON TABLE ${quoteQualified(namespace, operation.tableName)} IS ${commentValue(operation.comment)}`;
    case "comment-on-column":
      return `COMMENT ON COLUMN ${quoteQualified(namespace, operation.tableName, operation.columnName)} IS ${commentValue(operation.comment)}`;
  }
}

const alterTable = (namespace: string, table: string): string =>
  `ALTER TABLE ${quoteQualified(namespace, table)}`;

const alterColumn = (
  namespace: string,
  table: string,
  column: string,
): string =>
  `${alterTable(namespace, table)} ALTER COLUMN ${quoteIdent(column)}`;

const commentValue = (comment: string | null): string =>
  comment === null ? "NULL" : quoteLiteral(comment);

const identityKeyword = (kind: IdentityKind): string =>
  kind === "always" ? "ALWAYS" : "BY DEFAULT";

const columnList = (columns: readonly string[]): string =>
  columns.map(quoteIdent).join(", ");

function integer(value: string, field: string): string {
  if (!/^-?\d+$/.test(value))
    throw new Error(
      `Sequence ${field} must be an integer, got ${JSON.stringify(value)}.`,
    );
  return value;
}

function sequenceOptions(sequence: Sequence): string {
  return [
    `AS ${sequence.dataType}`,
    `INCREMENT BY ${integer(sequence.increment, "increment")}`,
    `MINVALUE ${integer(sequence.minValue, "minValue")}`,
    `MAXVALUE ${integer(sequence.maxValue, "maxValue")}`,
    `START WITH ${integer(sequence.start, "start")}`,
    `CACHE ${integer(sequence.cache, "cache")}`,
    sequence.cycle ? "CYCLE" : "NO CYCLE",
  ].join(" ");
}

function createTable(namespace: string, table: Table): string {
  const parts = [
    ...table.columns.map(columnDefinition),
    ...(table.primaryKey === null ? [] : [primaryKeyClause(table.primaryKey)]),
    ...table.uniqueConstraints.map(uniqueClause),
    ...table.checkConstraints.map(checkClause),
  ];
  const name = quoteQualified(namespace, table.name);
  return parts.length === 0
    ? `CREATE TABLE ${name} ()`
    : `CREATE TABLE ${name} (\n${parts.map((part) => `  ${part}`).join(",\n")}\n)`;
}

function columnDefinition(column: Column): string {
  let sql = `${quoteIdent(column.name)} ${column.type}`;
  if (column.collation !== null) sql += ` COLLATE ${column.collation}`;
  if (column.identity !== null)
    sql += ` GENERATED ${identityKeyword(column.identity)} AS IDENTITY`;
  if (column.generated !== null) {
    sql += ` GENERATED ALWAYS AS (${column.generated.expression}) ${column.generated.kind === "stored" ? "STORED" : "VIRTUAL"}`;
  }
  if (column.default !== null) sql += ` DEFAULT ${column.default}`;
  if (!column.nullable) sql += " NOT NULL";
  return sql;
}

function deferrableClause(deferrable: Deferrability): string {
  if (deferrable === "deferrable") return " DEFERRABLE";
  if (deferrable === "deferrable-initially-deferred")
    return " DEFERRABLE INITIALLY DEFERRED";
  return "";
}

function primaryKeyClause(primaryKey: PrimaryKey): string {
  return `CONSTRAINT ${quoteIdent(primaryKey.name)} PRIMARY KEY (${columnList(primaryKey.columns)})${deferrableClause(primaryKey.deferrable)}`;
}

function uniqueClause(constraint: UniqueConstraint): string {
  const nulls = constraint.nullsNotDistinct ? " NULLS NOT DISTINCT" : "";
  return `CONSTRAINT ${quoteIdent(constraint.name)} UNIQUE${nulls} (${columnList(constraint.columns)})${deferrableClause(constraint.deferrable)}`;
}

function checkClause(constraint: CheckConstraint): string {
  return `CONSTRAINT ${quoteIdent(constraint.name)} CHECK (${constraint.expression})`;
}

const REFERENTIAL_ACTIONS: Record<ReferentialAction, string> = {
  "no-action": "NO ACTION",
  restrict: "RESTRICT",
  cascade: "CASCADE",
  "set-null": "SET NULL",
  "set-default": "SET DEFAULT",
};

function foreignKeyClause(foreignKey: ForeignKey): string {
  const { references } = foreignKey;
  let sql = `CONSTRAINT ${quoteIdent(foreignKey.name)} FOREIGN KEY (${columnList(foreignKey.columns)}) REFERENCES ${quoteQualified(references.namespace, references.table)} (${columnList(references.columns)})`;
  if (foreignKey.matchFull) sql += " MATCH FULL";
  if (foreignKey.onUpdate !== "no-action")
    sql += ` ON UPDATE ${REFERENTIAL_ACTIONS[foreignKey.onUpdate]}`;
  if (foreignKey.onDelete !== "no-action")
    sql += ` ON DELETE ${REFERENTIAL_ACTIONS[foreignKey.onDelete]}`;
  return sql + deferrableClause(foreignKey.deferrable);
}
