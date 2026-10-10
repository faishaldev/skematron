import {
  SNAPSHOT_FORMAT_VERSION,
  type CheckConstraint,
  type Column,
  type EnumType,
  type ForeignKey,
  type Index,
  type Namespace,
  type PrimaryKey,
  type SchemaSnapshot,
  type Sequence,
  type Table,
  type UniqueConstraint,
} from "./snapshot.ts";

export class SnapshotValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotValidationError";
  }
}

/**
 * Compares strings by UTF-16 code units. Unlike `localeCompare`, the result is
 * the same on every machine, which canonical output requires.
 */
export function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Human-readable dotted name for messages. Not SQL; never parse it. */
export function displayName(...parts: string[]): string {
  return parts.join(".");
}

function sortedByName<T extends { name: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => compareNames(a.name, b.name));
}

function assertUniqueNames(names: readonly string[], context: string): void {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) {
      throw new SnapshotValidationError(
        `Duplicate name ${JSON.stringify(name)} in ${context}.`,
      );
    }
    seen.add(name);
  }
}

function assertColumnsExist(
  columns: readonly string[],
  known: ReadonlySet<string>,
  context: string,
): void {
  if (columns.length === 0) {
    throw new SnapshotValidationError(`${context} has no columns.`);
  }
  for (const column of columns) {
    if (!known.has(column)) {
      throw new SnapshotValidationError(
        `${context} references unknown column ${JSON.stringify(column)}.`,
      );
    }
  }
}

/**
 * Returns a validated copy of the snapshot in canonical form: every object
 * rebuilt with a fixed set of fields, and named collections sorted by name.
 * Column order, enum value order and key column order are significant and kept.
 *
 * Throws SnapshotValidationError for duplicate names or references to
 * columns that do not exist.
 */
export function canonicalizeSnapshot(snapshot: SchemaSnapshot): SchemaSnapshot {
  if (snapshot.formatVersion !== SNAPSHOT_FORMAT_VERSION) {
    throw new SnapshotValidationError(
      `Unsupported snapshot format version ${String(snapshot.formatVersion)}; expected ${SNAPSHOT_FORMAT_VERSION}.`,
    );
  }
  assertUniqueNames(
    snapshot.namespaces.map((namespace) => namespace.name),
    "snapshot namespaces",
  );
  return {
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    dialect: snapshot.dialect,
    namespaces: sortedByName(snapshot.namespaces).map(canonicalNamespace),
  };
}

function canonicalNamespace(namespace: Namespace): Namespace {
  const context = `namespace ${JSON.stringify(namespace.name)}`;
  assertUniqueNames(
    namespace.tables.map((table) => table.name),
    `${context} tables`,
  );
  assertUniqueNames(
    namespace.enums.map((enumType) => enumType.name),
    `${context} enums`,
  );
  assertUniqueNames(
    namespace.sequences.map((sequence) => sequence.name),
    `${context} sequences`,
  );
  const tables = sortedByName(namespace.tables).map((table) =>
    canonicalTable(table, namespace.name),
  );
  return {
    name: namespace.name,
    tables,
    enums: sortedByName(namespace.enums).map((enumType) =>
      canonicalEnum(enumType, namespace.name),
    ),
    sequences: sortedByName(namespace.sequences).map((sequence) =>
      canonicalSequence(sequence, namespace.name, tables),
    ),
  };
}

function canonicalTable(table: Table, namespace: string): Table {
  const context = `table ${displayName(namespace, table.name)}`;
  const columnNames = table.columns.map((column) => column.name);
  assertUniqueNames(columnNames, `${context} columns`);
  assertUniqueNames(
    [
      ...(table.primaryKey === null ? [] : [table.primaryKey.name]),
      ...table.uniqueConstraints.map((constraint) => constraint.name),
      ...table.checkConstraints.map((constraint) => constraint.name),
      ...table.foreignKeys.map((constraint) => constraint.name),
    ],
    `${context} constraints`,
  );
  assertUniqueNames(
    table.indexes.map((index) => index.name),
    `${context} indexes`,
  );

  const known = new Set(columnNames);
  if (table.primaryKey !== null) {
    assertColumnsExist(
      table.primaryKey.columns,
      known,
      `${context} primary key ${JSON.stringify(table.primaryKey.name)}`,
    );
  }
  for (const constraint of table.uniqueConstraints) {
    assertColumnsExist(
      constraint.columns,
      known,
      `${context} unique constraint ${JSON.stringify(constraint.name)}`,
    );
  }
  for (const foreignKey of table.foreignKeys) {
    const fkContext = `${context} foreign key ${JSON.stringify(foreignKey.name)}`;
    assertColumnsExist(foreignKey.columns, known, fkContext);
    if (foreignKey.references.columns.length !== foreignKey.columns.length) {
      throw new SnapshotValidationError(
        `${fkContext} has ${foreignKey.columns.length} columns but references ${foreignKey.references.columns.length}.`,
      );
    }
  }

  return {
    name: table.name,
    columns: table.columns.map(canonicalColumn),
    primaryKey:
      table.primaryKey === null ? null : canonicalPrimaryKey(table.primaryKey),
    uniqueConstraints: sortedByName(table.uniqueConstraints).map(
      canonicalUnique,
    ),
    checkConstraints: sortedByName(table.checkConstraints).map(canonicalCheck),
    foreignKeys: sortedByName(table.foreignKeys).map(canonicalForeignKey),
    indexes: sortedByName(table.indexes).map(canonicalIndex),
    comment: table.comment,
  };
}

function canonicalColumn(column: Column): Column {
  return {
    name: column.name,
    type: column.type,
    nullable: column.nullable,
    default: column.default,
    identity: column.identity,
    generated:
      column.generated === null
        ? null
        : {
            kind: column.generated.kind,
            expression: column.generated.expression,
          },
    collation: column.collation,
    comment: column.comment,
  };
}

function canonicalPrimaryKey(primaryKey: PrimaryKey): PrimaryKey {
  return {
    name: primaryKey.name,
    columns: [...primaryKey.columns],
    deferrable: primaryKey.deferrable,
  };
}

function canonicalUnique(constraint: UniqueConstraint): UniqueConstraint {
  return {
    name: constraint.name,
    columns: [...constraint.columns],
    nullsNotDistinct: constraint.nullsNotDistinct,
    deferrable: constraint.deferrable,
  };
}

function canonicalCheck(constraint: CheckConstraint): CheckConstraint {
  return { name: constraint.name, expression: constraint.expression };
}

function canonicalForeignKey(foreignKey: ForeignKey): ForeignKey {
  return {
    name: foreignKey.name,
    columns: [...foreignKey.columns],
    references: {
      namespace: foreignKey.references.namespace,
      table: foreignKey.references.table,
      columns: [...foreignKey.references.columns],
    },
    onUpdate: foreignKey.onUpdate,
    onDelete: foreignKey.onDelete,
    matchFull: foreignKey.matchFull,
    deferrable: foreignKey.deferrable,
  };
}

function canonicalIndex(index: Index): Index {
  return {
    name: index.name,
    unique: index.unique,
    definition: index.definition,
  };
}

function canonicalEnum(enumType: EnumType, namespace: string): EnumType {
  assertUniqueNames(
    enumType.values,
    `enum ${displayName(namespace, enumType.name)} values`,
  );
  return { name: enumType.name, values: [...enumType.values] };
}

function canonicalSequence(
  sequence: Sequence,
  namespace: string,
  tables: readonly Table[],
): Sequence {
  if (sequence.ownedBy !== null) {
    const { table: tableName, column } = sequence.ownedBy;
    const owner = tables.find((table) => table.name === tableName);
    if (
      owner === undefined ||
      !owner.columns.some((candidate) => candidate.name === column)
    ) {
      throw new SnapshotValidationError(
        `sequence ${displayName(namespace, sequence.name)} is owned by unknown column ${displayName(namespace, tableName, column)}.`,
      );
    }
  }
  return {
    name: sequence.name,
    dataType: sequence.dataType,
    start: sequence.start,
    increment: sequence.increment,
    minValue: sequence.minValue,
    maxValue: sequence.maxValue,
    cache: sequence.cache,
    cycle: sequence.cycle,
    ownedBy:
      sequence.ownedBy === null
        ? null
        : { table: sequence.ownedBy.table, column: sequence.ownedBy.column },
  };
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort(compareNames)) {
      sorted[key] = sortKeysDeep(record[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Canonical serialization (format v1): the canonical snapshot as JSON with
 * object keys sorted by code unit, 2-space indentation and a trailing newline.
 */
export function serializeSnapshot(snapshot: SchemaSnapshot): string {
  return `${JSON.stringify(sortKeysDeep(canonicalizeSnapshot(snapshot)), null, 2)}\n`;
}

/** `sha256:<hex>` of the UTF-8 bytes of `serializeSnapshot(snapshot)`. */
export async function snapshotChecksum(
  snapshot: SchemaSnapshot,
): Promise<string> {
  const bytes = new TextEncoder().encode(serializeSnapshot(snapshot));
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", bytes),
  );
  let hex = "";
  for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
  return `sha256:${hex}`;
}
