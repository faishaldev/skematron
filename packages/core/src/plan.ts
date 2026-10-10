import {
  canonicalizeSnapshot,
  compareNames,
  displayName,
} from "./canonical.ts";
import type {
  CheckConstraint,
  Column,
  Dialect,
  EnumType,
  ForeignKey,
  IdentityKind,
  Index,
  Namespace,
  PrimaryKey,
  SchemaSnapshot,
  Sequence,
  SequenceOwner,
  Table,
  UniqueConstraint,
} from "./snapshot.ts";

/**
 * `safe`: not expected to fail on existing data or lose data.
 * `caution`: may fail on existing data or hold heavy locks, but loses no data.
 * `destructive`: may permanently lose data.
 */
export type Risk = "safe" | "caution" | "destructive";

export type ConstraintKind = "primary-key" | "unique" | "check" | "foreign-key";

export type EnumValuePosition = { before: string } | { after: string } | null;

export type Operation =
  | { kind: "create-namespace"; namespace: string }
  | { kind: "drop-namespace"; namespace: string }
  | { kind: "create-enum"; namespace: string; enum: EnumType }
  | {
      kind: "add-enum-value";
      namespace: string;
      enumName: string;
      value: string;
      position: EnumValuePosition;
    }
  | { kind: "drop-enum"; namespace: string; enumName: string }
  /** Created without an owner; ownership is a separate operation. */
  | { kind: "create-sequence"; namespace: string; sequence: Sequence }
  /** Sets every property except ownership to the given values. */
  | { kind: "alter-sequence"; namespace: string; sequence: Sequence }
  | {
      kind: "set-sequence-owner";
      namespace: string;
      sequenceName: string;
      ownedBy: SequenceOwner | null;
    }
  | { kind: "drop-sequence"; namespace: string; sequenceName: string }
  /**
   * Columns, primary key, unique and check constraints only. Foreign keys,
   * indexes and comments are separate operations.
   */
  | { kind: "create-table"; namespace: string; table: Table }
  | { kind: "drop-table"; namespace: string; tableName: string }
  /** The column's comment is a separate operation. */
  | { kind: "add-column"; namespace: string; tableName: string; column: Column }
  | {
      kind: "drop-column";
      namespace: string;
      tableName: string;
      columnName: string;
    }
  | {
      kind: "alter-column-type";
      namespace: string;
      tableName: string;
      columnName: string;
      type: string;
      collation: string | null;
    }
  | {
      kind: "set-column-default";
      namespace: string;
      tableName: string;
      columnName: string;
      default: string;
    }
  | {
      kind: "drop-column-default";
      namespace: string;
      tableName: string;
      columnName: string;
    }
  | {
      kind: "set-not-null";
      namespace: string;
      tableName: string;
      columnName: string;
    }
  | {
      kind: "drop-not-null";
      namespace: string;
      tableName: string;
      columnName: string;
    }
  | {
      kind: "alter-column-identity";
      namespace: string;
      tableName: string;
      columnName: string;
      from: IdentityKind | null;
      to: IdentityKind | null;
    }
  | {
      kind: "add-primary-key";
      namespace: string;
      tableName: string;
      primaryKey: PrimaryKey;
    }
  | {
      kind: "add-unique";
      namespace: string;
      tableName: string;
      constraint: UniqueConstraint;
    }
  | {
      kind: "add-check";
      namespace: string;
      tableName: string;
      constraint: CheckConstraint;
    }
  | {
      kind: "add-foreign-key";
      namespace: string;
      tableName: string;
      foreignKey: ForeignKey;
    }
  | {
      kind: "drop-constraint";
      namespace: string;
      tableName: string;
      constraintName: string;
      constraintKind: ConstraintKind;
    }
  | { kind: "create-index"; namespace: string; tableName: string; index: Index }
  | {
      kind: "drop-index";
      namespace: string;
      tableName: string;
      indexName: string;
    }
  | {
      kind: "comment-on-table";
      namespace: string;
      tableName: string;
      comment: string | null;
    }
  | {
      kind: "comment-on-column";
      namespace: string;
      tableName: string;
      columnName: string;
      comment: string | null;
    };

export interface PlannedOperation {
  operation: Operation;
  risk: Risk;
  warnings: string[];
}

/** A difference the planner cannot express. A plan that has any is incomplete. */
export interface UnsupportedChange {
  object: string;
  reason: string;
}

export interface MigrationPlan {
  dialect: Dialect;
  /** In execution order. */
  operations: PlannedOperation[];
  unsupported: UnsupportedChange[];
}

export class PlanningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanningError";
  }
}

/** True when the plan has nothing to do, i.e. both snapshots are equivalent. */
export function isEmptyPlan(plan: MigrationPlan): boolean {
  return plan.operations.length === 0 && plan.unsupported.length === 0;
}

// Execution phases. Operations run in phase order, then by (namespace, table, name).
const Phase = {
  createNamespace: 0,
  createEnum: 1,
  createSequence: 2,
  releaseSequenceOwner: 3,
  dropForeignKey: 4,
  dropIndexOrConstraint: 5,
  dropTable: 6,
  createTable: 7,
  dropColumn: 8,
  addColumn: 9,
  dropDefault: 10,
  dropIdentity: 11,
  alterType: 12,
  setDefault: 13,
  dropNotNull: 14,
  setNotNull: 15,
  addIdentity: 16,
  assignSequenceOwner: 17,
  addConstraintOrIndex: 18,
  addForeignKey: 19,
  dropSequence: 20,
  dropEnum: 21,
  dropNamespace: 22,
  comment: 23,
} as const;

interface Entry {
  phase: number;
  key: string[];
  planned: PlannedOperation;
}

interface KeptForeignKey {
  namespace: string;
  tableName: string;
  foreignKey: ForeignKey;
}

interface Context {
  entries: Entry[];
  unsupported: UnsupportedChange[];
  droppedTables: Set<string>;
  droppedColumns: Set<string>;
  /** Surviving tables whose primary key, unique constraint or unique index is dropped. */
  keyChangedTables: Set<string>;
  retypedColumns: Set<string>;
  /** Unchanged foreign keys on surviving tables; may need recreating around other changes. */
  keptForeignKeys: KeptForeignKey[];
}

const tableId = (namespace: string, table: string): string =>
  JSON.stringify([namespace, table]);
const columnId = (namespace: string, table: string, column: string): string =>
  JSON.stringify([namespace, table, column]);

function add(
  context: Context,
  phase: number,
  key: string[],
  operation: Operation,
  risk: Risk,
  warnings: string[] = [],
): void {
  context.entries.push({ phase, key, planned: { operation, risk, warnings } });
}

function compareKeys(a: readonly string[], b: readonly string[]): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const result = compareNames(a[i]!, b[i]!);
    if (result !== 0) return result;
  }
  return a.length - b.length;
}

function same(a: unknown, b: unknown): boolean {
  // Inputs are canonicalized, so field order is fixed and JSON equality is structural equality.
  return JSON.stringify(a) === JSON.stringify(b);
}

function byName<T extends { name: string }>(
  items: readonly T[],
): Map<string, T> {
  return new Map(items.map((item) => [item.name, item]));
}

function emptyNamespace(name: string): Namespace {
  return { name, tables: [], enums: [], sequences: [] };
}

/**
 * Compares two snapshots and returns the ordered operations that turn `from`
 * into `to`, each with a risk level and warnings. Differences that cannot be
 * expressed are listed in `unsupported` instead of being skipped.
 *
 * Objects are matched by name, so a rename appears as a drop plus a create.
 * Column position is ignored because PostgreSQL cannot reorder columns.
 */
export function planMigration(
  from: SchemaSnapshot,
  to: SchemaSnapshot,
): MigrationPlan {
  if (from.dialect !== to.dialect) {
    throw new PlanningError(
      `Cannot plan between dialects ${from.dialect} and ${to.dialect}.`,
    );
  }
  const source = canonicalizeSnapshot(from);
  const target = canonicalizeSnapshot(to);

  const targetTables = new Set<string>();
  for (const namespace of target.namespaces) {
    for (const table of namespace.tables)
      targetTables.add(tableId(namespace.name, table.name));
  }
  const droppedTables = new Set<string>();
  for (const namespace of source.namespaces) {
    for (const table of namespace.tables) {
      const id = tableId(namespace.name, table.name);
      if (!targetTables.has(id)) droppedTables.add(id);
    }
  }

  const context: Context = {
    entries: [],
    unsupported: [],
    droppedTables,
    droppedColumns: new Set(),
    keyChangedTables: new Set(),
    retypedColumns: new Set(),
    keptForeignKeys: [],
  };

  const sourceNamespaces = byName(source.namespaces);
  const targetNamespaces = byName(target.namespaces);
  const names = [
    ...new Set([...sourceNamespaces.keys(), ...targetNamespaces.keys()]),
  ].sort(compareNames);
  for (const name of names) {
    planNamespace(
      context,
      name,
      sourceNamespaces.get(name),
      targetNamespaces.get(name),
    );
  }
  planRecreatedForeignKeys(context);

  context.entries.sort(
    (a, b) => a.phase - b.phase || compareKeys(a.key, b.key),
  );
  context.unsupported.sort(
    (a, b) =>
      compareNames(a.object, b.object) || compareNames(a.reason, b.reason),
  );
  return {
    dialect: target.dialect,
    operations: context.entries.map((entry) => entry.planned),
    unsupported: context.unsupported,
  };
}

function planNamespace(
  context: Context,
  name: string,
  source: Namespace | undefined,
  target: Namespace | undefined,
): void {
  if (source === undefined) {
    add(
      context,
      Phase.createNamespace,
      [name],
      { kind: "create-namespace", namespace: name },
      "safe",
    );
  }
  const before = source ?? emptyNamespace(name);
  const after = target ?? emptyNamespace(name);
  planEnums(context, name, before.enums, after.enums);
  planTables(context, name, before.tables, after.tables);
  // After tables, so sequences dropped together with their owning column are known.
  planSequences(context, name, before.sequences, after.sequences);
  if (target === undefined) {
    add(
      context,
      Phase.dropNamespace,
      [name],
      { kind: "drop-namespace", namespace: name },
      "destructive",
      [
        "Drops the schema. Fails if it still contains objects Skematron does not capture, such as views or functions.",
      ],
    );
  }
}

function planEnums(
  context: Context,
  namespace: string,
  source: readonly EnumType[],
  target: readonly EnumType[],
): void {
  const sourceByName = byName(source);
  const targetByName = byName(target);
  for (const enumType of target) {
    const before = sourceByName.get(enumType.name);
    if (before === undefined) {
      add(
        context,
        Phase.createEnum,
        [namespace, enumType.name],
        { kind: "create-enum", namespace, enum: enumType },
        "safe",
      );
      continue;
    }
    if (same(before.values, enumType.values)) continue;
    const additions = enumValueAdditions(before.values, enumType.values);
    if (additions === null) {
      context.unsupported.push({
        object: displayName(namespace, enumType.name),
        reason:
          "Enum values were removed or reordered. PostgreSQL cannot drop or reorder enum values; create a new type and convert the columns that use it manually.",
      });
      continue;
    }
    for (const { value, position } of additions) {
      add(
        context,
        Phase.createEnum,
        [namespace, enumType.name],
        {
          kind: "add-enum-value",
          namespace,
          enumName: enumType.name,
          value,
          position,
        },
        "safe",
        ["The new value cannot be used in the same transaction that adds it."],
      );
    }
  }
  for (const enumType of source) {
    if (targetByName.has(enumType.name)) continue;
    add(
      context,
      Phase.dropEnum,
      [namespace, enumType.name],
      { kind: "drop-enum", namespace, enumName: enumType.name },
      "destructive",
      ["Drops the type. Fails if any column still uses it."],
    );
  }
}

/**
 * Returns the values to add, in order, with positions that reproduce `target`;
 * or null when `target` does not keep every `source` value in the same order.
 */
function enumValueAdditions(
  source: readonly string[],
  target: readonly string[],
): { value: string; position: EnumValuePosition }[] | null {
  const sourceSet = new Set(source);
  if (
    !same(
      target.filter((value) => sourceSet.has(value)),
      source,
    )
  )
    return null;

  const firstKept = target.find((value) => sourceSet.has(value));
  const additions: { value: string; position: EnumValuePosition }[] = [];
  target.forEach((value, index) => {
    if (sourceSet.has(value)) return;
    const previous = index > 0 ? target[index - 1] : undefined;
    const position: EnumValuePosition =
      previous !== undefined
        ? { after: previous }
        : firstKept !== undefined
          ? { before: firstKept }
          : null;
    additions.push({ value, position });
  });
  return additions;
}

function planTables(
  context: Context,
  namespace: string,
  source: readonly Table[],
  target: readonly Table[],
): void {
  const sourceByName = byName(source);
  const targetByName = byName(target);
  for (const table of target) {
    const before = sourceByName.get(table.name);
    if (before === undefined) planNewTable(context, namespace, table);
    else planTableChanges(context, namespace, before, table);
  }
  for (const table of source) {
    if (targetByName.has(table.name)) continue;
    // Foreign keys between tables that are both being dropped would block the drops.
    for (const foreignKey of table.foreignKeys) {
      const { references } = foreignKey;
      const selfReference =
        references.namespace === namespace && references.table === table.name;
      if (
        !selfReference &&
        context.droppedTables.has(
          tableId(references.namespace, references.table),
        )
      ) {
        add(
          context,
          Phase.dropForeignKey,
          [namespace, table.name, foreignKey.name],
          {
            kind: "drop-constraint",
            namespace,
            tableName: table.name,
            constraintName: foreignKey.name,
            constraintKind: "foreign-key",
          },
          "safe",
        );
      }
    }
    add(
      context,
      Phase.dropTable,
      [namespace, table.name],
      { kind: "drop-table", namespace, tableName: table.name },
      "destructive",
      ["Permanently deletes the table and all of its rows."],
    );
  }
}

function planNewTable(context: Context, namespace: string, table: Table): void {
  const created: Table = {
    ...table,
    columns: table.columns.map((column) => ({ ...column, comment: null })),
    foreignKeys: [],
    indexes: [],
    comment: null,
  };
  add(
    context,
    Phase.createTable,
    [namespace, table.name],
    { kind: "create-table", namespace, table: created },
    "safe",
  );
  for (const index of table.indexes) {
    add(
      context,
      Phase.addConstraintOrIndex,
      [namespace, table.name, index.name],
      { kind: "create-index", namespace, tableName: table.name, index },
      "safe",
    );
  }
  for (const foreignKey of table.foreignKeys) {
    add(
      context,
      Phase.addForeignKey,
      [namespace, table.name, foreignKey.name],
      { kind: "add-foreign-key", namespace, tableName: table.name, foreignKey },
      "safe",
    );
  }
  if (table.comment !== null) {
    add(
      context,
      Phase.comment,
      [namespace, table.name],
      {
        kind: "comment-on-table",
        namespace,
        tableName: table.name,
        comment: table.comment,
      },
      "safe",
    );
  }
  for (const column of table.columns) {
    if (column.comment === null) continue;
    add(
      context,
      Phase.comment,
      [namespace, table.name, column.name],
      {
        kind: "comment-on-column",
        namespace,
        tableName: table.name,
        columnName: column.name,
        comment: column.comment,
      },
      "safe",
    );
  }
}

function planTableChanges(
  context: Context,
  namespace: string,
  before: Table,
  after: Table,
): void {
  const tableName = after.name;
  planColumns(context, namespace, tableName, before.columns, after.columns);

  if (!same(before.primaryKey, after.primaryKey)) {
    if (before.primaryKey !== null) {
      context.keyChangedTables.add(tableId(namespace, tableName));
      add(
        context,
        Phase.dropIndexOrConstraint,
        [namespace, tableName, before.primaryKey.name],
        {
          kind: "drop-constraint",
          namespace,
          tableName,
          constraintName: before.primaryKey.name,
          constraintKind: "primary-key",
        },
        "safe",
      );
    }
    if (after.primaryKey !== null) {
      add(
        context,
        Phase.addConstraintOrIndex,
        [namespace, tableName, after.primaryKey.name],
        {
          kind: "add-primary-key",
          namespace,
          tableName,
          primaryKey: after.primaryKey,
        },
        "caution",
        [
          "Fails if the columns contain duplicates or NULLs. Builds an index while locking the table.",
        ],
      );
    }
  }

  diffNamed(before.uniqueConstraints, after.uniqueConstraints, {
    removed: (constraint) => {
      context.keyChangedTables.add(tableId(namespace, tableName));
      add(
        context,
        Phase.dropIndexOrConstraint,
        [namespace, tableName, constraint.name],
        {
          kind: "drop-constraint",
          namespace,
          tableName,
          constraintName: constraint.name,
          constraintKind: "unique",
        },
        "safe",
      );
    },
    added: (constraint) =>
      add(
        context,
        Phase.addConstraintOrIndex,
        [namespace, tableName, constraint.name],
        { kind: "add-unique", namespace, tableName, constraint },
        "caution",
        [
          "Fails if existing rows contain duplicates. Builds an index while blocking writes.",
        ],
      ),
  });

  diffNamed(before.checkConstraints, after.checkConstraints, {
    removed: (constraint) =>
      add(
        context,
        Phase.dropIndexOrConstraint,
        [namespace, tableName, constraint.name],
        {
          kind: "drop-constraint",
          namespace,
          tableName,
          constraintName: constraint.name,
          constraintKind: "check",
        },
        "safe",
      ),
    added: (constraint) =>
      add(
        context,
        Phase.addConstraintOrIndex,
        [namespace, tableName, constraint.name],
        { kind: "add-check", namespace, tableName, constraint },
        "caution",
        [
          "Fails if existing rows violate the check; scans the table. On large tables consider NOT VALID followed by VALIDATE CONSTRAINT.",
        ],
      ),
  });

  diffNamed(before.foreignKeys, after.foreignKeys, {
    removed: (foreignKey) =>
      add(
        context,
        Phase.dropForeignKey,
        [namespace, tableName, foreignKey.name],
        {
          kind: "drop-constraint",
          namespace,
          tableName,
          constraintName: foreignKey.name,
          constraintKind: "foreign-key",
        },
        "safe",
      ),
    added: (foreignKey) =>
      add(
        context,
        Phase.addForeignKey,
        [namespace, tableName, foreignKey.name],
        { kind: "add-foreign-key", namespace, tableName, foreignKey },
        "caution",
        [
          "Fails if existing rows reference missing keys; validation scans the table. On large tables consider NOT VALID followed by VALIDATE CONSTRAINT.",
        ],
      ),
    unchanged: (foreignKey) =>
      context.keptForeignKeys.push({ namespace, tableName, foreignKey }),
  });

  diffNamed(before.indexes, after.indexes, {
    removed: (index) => {
      // A unique index can back foreign keys that reference this table.
      if (index.unique)
        context.keyChangedTables.add(tableId(namespace, tableName));
      add(
        context,
        Phase.dropIndexOrConstraint,
        [namespace, tableName, index.name],
        { kind: "drop-index", namespace, tableName, indexName: index.name },
        "safe",
      );
    },
    added: (index) =>
      add(
        context,
        Phase.addConstraintOrIndex,
        [namespace, tableName, index.name],
        { kind: "create-index", namespace, tableName, index },
        "caution",
        [
          ...(index.unique
            ? ["Fails if existing rows contain duplicates."]
            : []),
          "Blocks writes while the index builds. On large tables consider CREATE INDEX CONCURRENTLY outside a transaction.",
        ],
      ),
  });

  if (before.comment !== after.comment) {
    add(
      context,
      Phase.comment,
      [namespace, tableName],
      {
        kind: "comment-on-table",
        namespace,
        tableName,
        comment: after.comment,
      },
      "safe",
    );
  }
}

function diffNamed<T extends { name: string }>(
  source: readonly T[],
  target: readonly T[],
  handlers: {
    removed: (item: T) => void;
    added: (item: T) => void;
    unchanged?: (item: T) => void;
  },
): void {
  const targetByName = byName(target);
  const sourceByName = byName(source);
  for (const item of source) {
    const after = targetByName.get(item.name);
    if (after === undefined || !same(item, after)) handlers.removed(item);
  }
  for (const item of target) {
    const before = sourceByName.get(item.name);
    if (before === undefined || !same(before, item)) handlers.added(item);
    else handlers.unchanged?.(item);
  }
}

function planColumns(
  context: Context,
  namespace: string,
  tableName: string,
  source: readonly Column[],
  target: readonly Column[],
): void {
  const sourceByName = byName(source);
  const targetByName = byName(target);
  for (const column of source) {
    if (targetByName.has(column.name)) continue;
    context.droppedColumns.add(columnId(namespace, tableName, column.name));
    add(
      context,
      Phase.dropColumn,
      [namespace, tableName, column.name],
      { kind: "drop-column", namespace, tableName, columnName: column.name },
      "destructive",
      ["Permanently deletes the column and its data."],
    );
  }
  for (const column of target) {
    const before = sourceByName.get(column.name);
    if (before === undefined)
      planNewColumn(context, namespace, tableName, column);
    else planColumnChanges(context, namespace, tableName, before, column);
  }
}

function planNewColumn(
  context: Context,
  namespace: string,
  tableName: string,
  column: Column,
): void {
  let risk: Risk = "safe";
  const warnings: string[] = [];
  if (
    !column.nullable &&
    column.default === null &&
    column.identity === null &&
    column.generated === null
  ) {
    risk = "caution";
    warnings.push(
      "Fails if the table already has rows: the column is NOT NULL and has no default.",
    );
  } else if (column.generated !== null) {
    risk = "caution";
    warnings.push(
      "Computes the value for every existing row, rewriting the table.",
    );
  }
  add(
    context,
    Phase.addColumn,
    [namespace, tableName, column.name],
    {
      kind: "add-column",
      namespace,
      tableName,
      column: { ...column, comment: null },
    },
    risk,
    warnings,
  );
  if (column.comment !== null) {
    add(
      context,
      Phase.comment,
      [namespace, tableName, column.name],
      {
        kind: "comment-on-column",
        namespace,
        tableName,
        columnName: column.name,
        comment: column.comment,
      },
      "safe",
    );
  }
}

function planColumnChanges(
  context: Context,
  namespace: string,
  tableName: string,
  before: Column,
  after: Column,
): void {
  const columnName = after.name;
  const key = [namespace, tableName, columnName];
  if (!same(before.generated, after.generated)) {
    context.unsupported.push({
      object: displayName(namespace, tableName, columnName),
      reason:
        "Generated column was added, removed or given a new expression. Drop and re-add the column manually.",
    });
    return;
  }

  const typeChanged =
    before.type !== after.type || before.collation !== after.collation;
  if (typeChanged && before.default !== null) {
    // The old default may not cast to the new type, so it is re-applied after the change.
    add(
      context,
      Phase.dropDefault,
      key,
      { kind: "drop-column-default", namespace, tableName, columnName },
      "safe",
    );
    if (after.default !== null) {
      add(
        context,
        Phase.setDefault,
        key,
        {
          kind: "set-column-default",
          namespace,
          tableName,
          columnName,
          default: after.default,
        },
        "safe",
      );
    }
  } else if (before.default !== after.default) {
    if (after.default === null) {
      add(
        context,
        Phase.dropDefault,
        key,
        { kind: "drop-column-default", namespace, tableName, columnName },
        "safe",
      );
    } else {
      add(
        context,
        Phase.setDefault,
        key,
        {
          kind: "set-column-default",
          namespace,
          tableName,
          columnName,
          default: after.default,
        },
        "safe",
      );
    }
  }

  if (before.identity !== after.identity) {
    const operation: Operation = {
      kind: "alter-column-identity",
      namespace,
      tableName,
      columnName,
      from: before.identity,
      to: after.identity,
    };
    if (before.identity === null) {
      add(context, Phase.addIdentity, key, operation, "caution", [
        "The identity sequence starts at 1 and may collide with existing values; advance it with setval() after applying.",
      ]);
    } else {
      add(
        context,
        Phase.dropIdentity,
        key,
        operation,
        "safe",
        after.identity === null
          ? ["Also drops the identity's internal sequence."]
          : [],
      );
    }
  }

  if (typeChanged) {
    context.retypedColumns.add(columnId(namespace, tableName, columnName));
    add(
      context,
      Phase.alterType,
      key,
      {
        kind: "alter-column-type",
        namespace,
        tableName,
        columnName,
        type: after.type,
        collation: after.collation,
      },
      "destructive",
      [
        "May fail or lose data (narrowing, precision or incompatible casts) and rewrites the table under an exclusive lock. Add a USING clause if PostgreSQL cannot cast automatically.",
      ],
    );
  }

  if (before.nullable && !after.nullable) {
    add(
      context,
      Phase.setNotNull,
      key,
      { kind: "set-not-null", namespace, tableName, columnName },
      "caution",
      ["Fails if any existing row has NULL in this column; scans the table."],
    );
  } else if (!before.nullable && after.nullable) {
    add(
      context,
      Phase.dropNotNull,
      key,
      { kind: "drop-not-null", namespace, tableName, columnName },
      "safe",
    );
  }

  if (before.comment !== after.comment) {
    add(
      context,
      Phase.comment,
      key,
      {
        kind: "comment-on-column",
        namespace,
        tableName,
        columnName,
        comment: after.comment,
      },
      "safe",
    );
  }
}

/**
 * Foreign keys that did not change still have to be dropped and re-added when
 * the key they reference is recreated or one of their columns changes type,
 * because PostgreSQL refuses those changes while the foreign key exists.
 */
function planRecreatedForeignKeys(context: Context): void {
  for (const { namespace, tableName, foreignKey } of context.keptForeignKeys) {
    const { references } = foreignKey;
    const keyChanged = context.keyChangedTables.has(
      tableId(references.namespace, references.table),
    );
    const retyped =
      foreignKey.columns.some((column) =>
        context.retypedColumns.has(columnId(namespace, tableName, column)),
      ) ||
      references.columns.some((column) =>
        context.retypedColumns.has(
          columnId(references.namespace, references.table, column),
        ),
      );
    if (!keyChanged && !retyped) continue;
    const reason = keyChanged
      ? "a key on the referenced table is being recreated"
      : "one of its columns changes type";
    const key = [namespace, tableName, foreignKey.name];
    add(
      context,
      Phase.dropForeignKey,
      key,
      {
        kind: "drop-constraint",
        namespace,
        tableName,
        constraintName: foreignKey.name,
        constraintKind: "foreign-key",
      },
      "safe",
      [
        `Dropped temporarily because ${reason}; it is re-added later in this plan.`,
      ],
    );
    add(
      context,
      Phase.addForeignKey,
      key,
      { kind: "add-foreign-key", namespace, tableName, foreignKey },
      "caution",
      [`Re-added because ${reason}. Validation scans the table.`],
    );
  }
}

function planSequences(
  context: Context,
  namespace: string,
  source: readonly Sequence[],
  target: readonly Sequence[],
): void {
  const sourceByName = byName(source);
  const targetByName = byName(target);
  for (const sequence of target) {
    const key = [namespace, sequence.name];
    const before = sourceByName.get(sequence.name);
    if (before === undefined) {
      add(
        context,
        Phase.createSequence,
        key,
        {
          kind: "create-sequence",
          namespace,
          sequence: { ...sequence, ownedBy: null },
        },
        "safe",
      );
      if (sequence.ownedBy !== null) {
        add(
          context,
          Phase.assignSequenceOwner,
          key,
          {
            kind: "set-sequence-owner",
            namespace,
            sequenceName: sequence.name,
            ownedBy: sequence.ownedBy,
          },
          "safe",
        );
      }
      continue;
    }
    if (!same({ ...before, ownedBy: null }, { ...sequence, ownedBy: null })) {
      const rangeChanged =
        before.dataType !== sequence.dataType ||
        before.minValue !== sequence.minValue ||
        before.maxValue !== sequence.maxValue;
      add(
        context,
        Phase.createSequence,
        key,
        {
          kind: "alter-sequence",
          namespace,
          sequence: { ...sequence, ownedBy: null },
        },
        rangeChanged ? "caution" : "safe",
        rangeChanged
          ? ["Fails if the sequence's current value is outside the new range."]
          : [],
      );
    }
    if (!same(before.ownedBy, sequence.ownedBy)) {
      if (before.ownedBy !== null) {
        // Released early so dropping the old owner column cannot take the sequence with it.
        add(
          context,
          Phase.releaseSequenceOwner,
          key,
          {
            kind: "set-sequence-owner",
            namespace,
            sequenceName: sequence.name,
            ownedBy: null,
          },
          "safe",
        );
      }
      if (sequence.ownedBy !== null) {
        add(
          context,
          Phase.assignSequenceOwner,
          key,
          {
            kind: "set-sequence-owner",
            namespace,
            sequenceName: sequence.name,
            ownedBy: sequence.ownedBy,
          },
          "safe",
        );
      }
    }
  }
  for (const sequence of source) {
    if (targetByName.has(sequence.name)) continue;
    const owner = sequence.ownedBy;
    if (
      owner !== null &&
      (context.droppedTables.has(tableId(namespace, owner.table)) ||
        context.droppedColumns.has(
          columnId(namespace, owner.table, owner.column),
        ))
    ) {
      continue; // PostgreSQL drops an owned sequence together with its owning column.
    }
    add(
      context,
      Phase.dropSequence,
      [namespace, sequence.name],
      { kind: "drop-sequence", namespace, sequenceName: sequence.name },
      "destructive",
      ["Drops the sequence and loses its current value."],
    );
  }
}
