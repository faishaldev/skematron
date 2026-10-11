// Guided planning: decisions the planner cannot take from two snapshots alone.
//
// Snapshots match objects by name, so a rename looks like a drop plus a create, and an added
// NOT NULL column cannot be filled on a table that has rows. Instead of guessing, the planner
// asks: each question has a stable id, and the caller answers it by id. Answers are applied to
// a copy of `from` (renames) or to single operations (backfills); nothing else changes.
import {
  canonicalizeSnapshot,
  compareNames,
  displayName,
} from "./canonical.ts";
import { PlanningError } from "./errors.ts";
import type {
  Column,
  Namespace,
  SchemaSnapshot,
  Sequence,
  Table,
} from "./snapshot.ts";

/** For a rename question: renamed to one of the candidates, or really dropped. */
export type RenameAnswer =
  { choice: "rename"; to: string } | { choice: "drop" };

/** For a backfill question: a value for existing rows, or no backfill (fails if rows exist). */
export type BackfillAnswer =
  { choice: "backfill"; value: string } | { choice: "skip" };

export type Answer = RenameAnswer | BackfillAnswer;

/** Answers keyed by question id. */
export type Answers = Readonly<Record<string, Answer>>;

/** A table in `from` that is missing from `to`, where `to` has tables with the same columns. */
export interface RenameTableQuestion {
  id: string;
  kind: "rename-table";
  namespace: string;
  tableName: string;
  candidates: string[];
  answer: RenameAnswer | null;
}

/** A column missing from `to`, where the same table gained columns of the same type. */
export interface RenameColumnQuestion {
  id: string;
  kind: "rename-column";
  namespace: string;
  /** The table's name after any table renames. */
  tableName: string;
  columnName: string;
  candidates: string[];
  answer: RenameAnswer | null;
}

/** A sequence missing from `to`, where `to` has sequences with the same properties. */
export interface RenameSequenceQuestion {
  id: string;
  kind: "rename-sequence";
  namespace: string;
  sequenceName: string;
  candidates: string[];
  answer: RenameAnswer | null;
}

/** A NOT NULL column without a default, added to a table that already exists. */
export interface BackfillQuestion {
  id: string;
  kind: "backfill";
  namespace: string;
  tableName: string;
  columnName: string;
  /** The column's type as SQL; a backfill value must be valid input for it. */
  type: string;
  answer: BackfillAnswer | null;
}

export type Question =
  | RenameTableQuestion
  | RenameColumnQuestion
  | RenameSequenceQuestion
  | BackfillQuestion;

export type RenameOperation =
  | {
      kind: "rename-table";
      namespace: string;
      tableName: string;
      newName: string;
    }
  | {
      kind: "rename-column";
      namespace: string;
      /** The table's name after any table renames, which run first. */
      tableName: string;
      columnName: string;
      newName: string;
    }
  | {
      kind: "rename-sequence";
      namespace: string;
      sequenceName: string;
      newName: string;
    };

export interface Backfill {
  namespace: string;
  tableName: string;
  columnName: string;
  value: string;
}

export interface ResolvedQuestions {
  /** `from` with the answered renames applied, canonicalized. */
  source: SchemaSnapshot;
  renames: RenameOperation[];
  backfills: Backfill[];
  /** Every current question, answered or not, in a deterministic order. */
  questions: Question[];
}

const questionId = (...parts: string[]): string => JSON.stringify(parts);

function byName<T extends { name: string }>(
  items: readonly T[],
): Map<string, T> {
  return new Map(items.map((item) => [item.name, item]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Finds the questions for `source` → `target` and applies the answers given.
 * Questions come in stages, and answers to earlier stages decide which later
 * questions exist: table renames, then column renames, then sequence renames,
 * then backfills. Both snapshots must be canonical.
 */
export function resolveQuestions(
  source: SchemaSnapshot,
  target: SchemaSnapshot,
  answers: Answers,
  ignoreUnusedAnswers: boolean,
): ResolvedQuestions {
  const used = new Set<string>();
  const take = (id: string): unknown => {
    if (!Object.hasOwn(answers, id)) return undefined;
    used.add(id);
    return answers[id];
  };
  const questions: Question[] = [];
  const renames: RenameOperation[] = [];
  const backfills: Backfill[] = [];
  const targetNamespaces = byName(target.namespaces);
  let current = source;

  // Stage 1: tables.
  for (const namespace of current.namespaces) {
    const after = targetNamespaces.get(namespace.name);
    if (after === undefined) continue;
    const claims = new Claims();
    const sourceTables = byName(namespace.tables);
    const targetTables = byName(after.tables);
    const added = after.tables.filter((table) => !sourceTables.has(table.name));
    for (const table of namespace.tables) {
      if (targetTables.has(table.name) || table.columns.length === 0) continue;
      const shape = tableShape(table);
      const candidates = names(
        added.filter((candidate) => tableShape(candidate) === shape),
      );
      if (candidates.length === 0) continue;
      const subject = `table ${displayName(namespace.name, table.name)}`;
      const id = questionId("rename-table", namespace.name, table.name);
      const answer = renameAnswer(take(id), candidates, subject);
      questions.push({
        id,
        kind: "rename-table",
        namespace: namespace.name,
        tableName: table.name,
        candidates,
        answer,
      });
      if (answer?.choice !== "rename") continue;
      claims.claim(answer.to, subject);
      renames.push({
        kind: "rename-table",
        namespace: namespace.name,
        tableName: table.name,
        newName: answer.to,
      });
    }
  }
  current = applyRenames(current, renames);

  // Stage 2: columns of tables that exist on both sides.
  const columnRenames: RenameOperation[] = [];
  for (const namespace of current.namespaces) {
    const after = targetNamespaces.get(namespace.name);
    if (after === undefined) continue;
    const targetTables = byName(after.tables);
    for (const table of namespace.tables) {
      const targetTable = targetTables.get(table.name);
      if (targetTable === undefined) continue;
      const claims = new Claims();
      const sourceColumns = byName(table.columns);
      const targetColumns = byName(targetTable.columns);
      const added = targetTable.columns.filter(
        (column) => !sourceColumns.has(column.name),
      );
      for (const column of table.columns) {
        if (targetColumns.has(column.name)) continue;
        const candidates = names(
          added.filter((candidate) => sameColumnType(column, candidate)),
        );
        if (candidates.length === 0) continue;
        const subject = `column ${displayName(namespace.name, table.name, column.name)}`;
        const id = questionId(
          "rename-column",
          namespace.name,
          table.name,
          column.name,
        );
        const answer = renameAnswer(take(id), candidates, subject);
        questions.push({
          id,
          kind: "rename-column",
          namespace: namespace.name,
          tableName: table.name,
          columnName: column.name,
          candidates,
          answer,
        });
        if (answer?.choice !== "rename") continue;
        claims.claim(answer.to, subject);
        columnRenames.push({
          kind: "rename-column",
          namespace: namespace.name,
          tableName: table.name,
          columnName: column.name,
          newName: answer.to,
        });
      }
    }
  }
  current = applyRenames(current, columnRenames);
  renames.push(...columnRenames);

  // Stage 3: sequences, except those dropped together with the column that owns them.
  const sequenceRenames: RenameOperation[] = [];
  for (const namespace of current.namespaces) {
    const after = targetNamespaces.get(namespace.name);
    if (after === undefined) continue;
    const claims = new Claims();
    const sourceSequences = byName(namespace.sequences);
    const targetSequences = byName(after.sequences);
    const targetTables = byName(after.tables);
    const added = after.sequences.filter(
      (sequence) => !sourceSequences.has(sequence.name),
    );
    for (const sequence of namespace.sequences) {
      if (targetSequences.has(sequence.name)) continue;
      const owner = sequence.ownedBy;
      if (
        owner !== null &&
        !targetTables
          .get(owner.table)
          ?.columns.some((column) => column.name === owner.column)
      ) {
        continue;
      }
      const candidates = names(
        added.filter((candidate) => sameSequenceSettings(sequence, candidate)),
      );
      if (candidates.length === 0) continue;
      const subject = `sequence ${displayName(namespace.name, sequence.name)}`;
      const id = questionId("rename-sequence", namespace.name, sequence.name);
      const answer = renameAnswer(take(id), candidates, subject);
      questions.push({
        id,
        kind: "rename-sequence",
        namespace: namespace.name,
        sequenceName: sequence.name,
        candidates,
        answer,
      });
      if (answer?.choice !== "rename") continue;
      claims.claim(answer.to, subject);
      sequenceRenames.push({
        kind: "rename-sequence",
        namespace: namespace.name,
        sequenceName: sequence.name,
        newName: answer.to,
      });
    }
  }
  current = applyRenames(current, sequenceRenames);
  renames.push(...sequenceRenames);

  // Stage 4: NOT NULL columns without a default, added to existing tables.
  for (const namespace of current.namespaces) {
    const after = targetNamespaces.get(namespace.name);
    if (after === undefined) continue;
    const sourceTables = byName(namespace.tables);
    for (const table of after.tables) {
      const before = sourceTables.get(table.name);
      if (before === undefined) continue;
      const existing = new Set(before.columns.map((column) => column.name));
      for (const column of table.columns) {
        if (
          existing.has(column.name) ||
          column.nullable ||
          column.default !== null ||
          column.identity !== null ||
          column.generated !== null
        ) {
          continue;
        }
        const subject = `column ${displayName(namespace.name, table.name, column.name)}`;
        const id = questionId(
          "backfill",
          namespace.name,
          table.name,
          column.name,
        );
        const answer = backfillAnswer(take(id), subject);
        questions.push({
          id,
          kind: "backfill",
          namespace: namespace.name,
          tableName: table.name,
          columnName: column.name,
          type: column.type,
          answer,
        });
        if (answer?.choice === "backfill") {
          backfills.push({
            namespace: namespace.name,
            tableName: table.name,
            columnName: column.name,
            value: answer.value,
          });
        }
      }
    }
  }

  if (!ignoreUnusedAnswers) {
    const unused = Object.keys(answers)
      .filter((id) => !used.has(id))
      .sort(compareNames);
    if (unused.length > 0) {
      throw new PlanningError(
        `${unused.length === 1 ? "An answer does" : "Some answers do"} not match any question: ${unused.join(", ")}.`,
      );
    }
  }
  return { source: current, renames, backfills, questions };
}

/** Rejects two renames to the same new name within one scope. */
class Claims {
  #claimed = new Map<string, string>();

  claim(name: string, subject: string): void {
    const other = this.#claimed.get(name);
    if (other !== undefined) {
      throw new PlanningError(
        `${capitalize(other)} and ${subject} cannot both be renamed to ${JSON.stringify(name)}.`,
      );
    }
    this.#claimed.set(name, subject);
  }
}

const capitalize = (text: string): string =>
  text.charAt(0).toUpperCase() + text.slice(1);

const names = (items: readonly { name: string }[]): string[] =>
  items.map((item) => item.name).sort(compareNames);

function tableShape(table: Table): string {
  return JSON.stringify(
    table.columns
      .map((column) => [column.name, column.type, column.collation])
      .sort((a, b) => compareNames(a[0]!, b[0]!)),
  );
}

function sameColumnType(a: Column, b: Column): boolean {
  return (
    a.type === b.type &&
    a.collation === b.collation &&
    JSON.stringify(a.generated) === JSON.stringify(b.generated)
  );
}

function sameSequenceSettings(a: Sequence, b: Sequence): boolean {
  // Canonical input has a fixed field order, so JSON equality is structural equality.
  const settings = (sequence: Sequence) =>
    JSON.stringify({ ...sequence, name: "", ownedBy: null });
  return settings(a) === settings(b);
}

function renameAnswer(
  raw: unknown,
  candidates: readonly string[],
  subject: string,
): RenameAnswer | null {
  if (raw === undefined) return null;
  if (isRecord(raw) && raw.choice === "drop") return { choice: "drop" };
  if (isRecord(raw) && raw.choice === "rename" && typeof raw.to === "string") {
    if (!candidates.includes(raw.to)) {
      throw new PlanningError(
        `${capitalize(subject)} cannot be renamed to ${JSON.stringify(raw.to)}. Choose one of: ${candidates.join(", ")}.`,
      );
    }
    return { choice: "rename", to: raw.to };
  }
  throw new PlanningError(
    `The answer for ${subject} must be a rename to one of: ${candidates.join(", ")}; or a drop.`,
  );
}

function backfillAnswer(raw: unknown, subject: string): BackfillAnswer | null {
  if (raw === undefined) return null;
  if (isRecord(raw) && raw.choice === "skip") return { choice: "skip" };
  if (
    isRecord(raw) &&
    raw.choice === "backfill" &&
    typeof raw.value === "string"
  ) {
    return { choice: "backfill", value: raw.value };
  }
  throw new PlanningError(
    `The answer for ${subject} must be a backfill value or a skip.`,
  );
}

/** Applies renames to a canonical snapshot, including every reference to the renamed objects. */
function applyRenames(
  snapshot: SchemaSnapshot,
  renames: readonly RenameOperation[],
): SchemaSnapshot {
  if (renames.length === 0) return snapshot;
  let namespaces = snapshot.namespaces;
  for (const rename of renames) {
    namespaces = namespaces.map((namespace) => renameIn(namespace, rename));
  }
  return canonicalizeSnapshot({ ...snapshot, namespaces });
}

function renameIn(namespace: Namespace, rename: RenameOperation): Namespace {
  const local = namespace.name === rename.namespace;
  switch (rename.kind) {
    case "rename-table": {
      const renamed = (table: string) =>
        local && table === rename.tableName ? rename.newName : table;
      return {
        ...namespace,
        tables: namespace.tables.map((table) => ({
          ...table,
          name: renamed(table.name),
          foreignKeys: table.foreignKeys.map((foreignKey) =>
            foreignKey.references.namespace === rename.namespace &&
            foreignKey.references.table === rename.tableName
              ? {
                  ...foreignKey,
                  references: {
                    ...foreignKey.references,
                    table: rename.newName,
                  },
                }
              : foreignKey,
          ),
        })),
        sequences: namespace.sequences.map((sequence) =>
          sequence.ownedBy === null
            ? sequence
            : {
                ...sequence,
                ownedBy: {
                  ...sequence.ownedBy,
                  table: renamed(sequence.ownedBy.table),
                },
              },
        ),
      };
    }
    case "rename-column": {
      const isTable = (namespaceName: string, table: string) =>
        namespaceName === rename.namespace && table === rename.tableName;
      const renamed = (column: string) =>
        column === rename.columnName ? rename.newName : column;
      return {
        ...namespace,
        tables: namespace.tables.map((table) => {
          const own = isTable(namespace.name, table.name);
          const foreignKeys = table.foreignKeys.map((foreignKey) => {
            const { references } = foreignKey;
            return {
              ...foreignKey,
              columns: own
                ? foreignKey.columns.map(renamed)
                : foreignKey.columns,
              references: isTable(references.namespace, references.table)
                ? { ...references, columns: references.columns.map(renamed) }
                : references,
            };
          });
          if (!own) return { ...table, foreignKeys };
          return {
            ...table,
            columns: table.columns.map((column) => ({
              ...column,
              name: renamed(column.name),
            })),
            primaryKey:
              table.primaryKey === null
                ? null
                : {
                    ...table.primaryKey,
                    columns: table.primaryKey.columns.map(renamed),
                  },
            uniqueConstraints: table.uniqueConstraints.map((constraint) => ({
              ...constraint,
              columns: constraint.columns.map(renamed),
            })),
            foreignKeys,
          };
        }),
        sequences: namespace.sequences.map((sequence) =>
          local &&
          sequence.ownedBy?.table === rename.tableName &&
          sequence.ownedBy.column === rename.columnName
            ? {
                ...sequence,
                ownedBy: { ...sequence.ownedBy, column: rename.newName },
              }
            : sequence,
        ),
      };
    }
    case "rename-sequence":
      if (!local) return namespace;
      return {
        ...namespace,
        sequences: namespace.sequences.map((sequence) =>
          sequence.name === rename.sequenceName
            ? { ...sequence, name: rename.newName }
            : sequence,
        ),
      };
  }
}
