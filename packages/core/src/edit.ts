// Schema editing: small, explicit changes to a snapshot, for schemas written in the dashboard.
// Each function returns a new canonical snapshot and never changes its input. SQL fragments
// (types, defaults, index definitions) are taken as given; the caller checks them against
// a real database engine.
import { canonicalizeSnapshot, displayName } from "./canonical.ts";
import type {
  Column,
  ForeignKey,
  Index,
  Namespace,
  SchemaSnapshot,
  Table,
  UniqueConstraint,
} from "./snapshot.ts";

export class SchemaEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaEditError";
  }
}

function requireName(name: string, what: string): void {
  if (name.trim() === "" || name !== name.trim()) {
    throw new SchemaEditError(
      `${what} must not be empty or start or end with spaces.`,
    );
  }
}

function findTable(
  snapshot: SchemaSnapshot,
  namespace: string,
  tableName: string,
): Table {
  const table = snapshot.namespaces
    .find((candidate) => candidate.name === namespace)
    ?.tables.find((candidate) => candidate.name === tableName);
  if (table === undefined) {
    throw new SchemaEditError(
      `Table ${displayName(namespace, tableName)} does not exist.`,
    );
  }
  return table;
}

/** Replaces one table, then canonicalizes (which also rejects duplicate names). */
function withTable(
  snapshot: SchemaSnapshot,
  namespace: string,
  tableName: string,
  change: (table: Table) => Table,
): SchemaSnapshot {
  findTable(snapshot, namespace, tableName);
  return canonicalizeSnapshot({
    ...snapshot,
    namespaces: snapshot.namespaces.map((candidate) =>
      candidate.name !== namespace
        ? candidate
        : {
            ...candidate,
            tables: candidate.tables.map((table) =>
              table.name === tableName ? change(table) : table,
            ),
          },
    ),
  });
}

/**
 * Adds a table with its columns, primary key and unique constraints. The
 * namespace is created when it does not exist yet.
 */
export function addTable(
  snapshot: SchemaSnapshot,
  namespace: string,
  table: Table,
): SchemaSnapshot {
  requireName(namespace, "The schema name");
  requireName(table.name, "The table name");
  if (table.columns.length === 0) {
    throw new SchemaEditError("A new table needs at least one column.");
  }
  for (const column of table.columns) requireName(column.name, "A column name");
  const existing = snapshot.namespaces.find(
    (candidate) => candidate.name === namespace,
  );
  if (existing?.tables.some((candidate) => candidate.name === table.name)) {
    throw new SchemaEditError(
      `Table ${displayName(namespace, table.name)} already exists.`,
    );
  }
  const target: Namespace = existing ?? {
    name: namespace,
    tables: [],
    enums: [],
    sequences: [],
  };
  return canonicalizeSnapshot({
    ...snapshot,
    namespaces: [
      ...snapshot.namespaces.filter(
        (candidate) => candidate.name !== namespace,
      ),
      { ...target, tables: [...target.tables, table] },
    ],
  });
}

/** Adds a column at the end of an existing table. */
export function addColumn(
  snapshot: SchemaSnapshot,
  namespace: string,
  tableName: string,
  column: Column,
): SchemaSnapshot {
  requireName(column.name, "The column name");
  if (
    findTable(snapshot, namespace, tableName).columns.some(
      (candidate) => candidate.name === column.name,
    )
  ) {
    throw new SchemaEditError(
      `Column ${displayName(namespace, tableName, column.name)} already exists.`,
    );
  }
  return withTable(snapshot, namespace, tableName, (table) => ({
    ...table,
    columns: [...table.columns, column],
  }));
}

export function addUniqueConstraint(
  snapshot: SchemaSnapshot,
  namespace: string,
  tableName: string,
  constraint: UniqueConstraint,
): SchemaSnapshot {
  requireName(constraint.name, "The constraint name");
  return withTable(snapshot, namespace, tableName, (table) => ({
    ...table,
    uniqueConstraints: [...table.uniqueConstraints, constraint],
  }));
}

export function addIndex(
  snapshot: SchemaSnapshot,
  namespace: string,
  tableName: string,
  index: Index,
): SchemaSnapshot {
  requireName(index.name, "The index name");
  return withTable(snapshot, namespace, tableName, (table) => ({
    ...table,
    indexes: [...table.indexes, index],
  }));
}

/** Adds a foreign key. The referenced table and columns must exist. */
export function addForeignKey(
  snapshot: SchemaSnapshot,
  namespace: string,
  tableName: string,
  foreignKey: ForeignKey,
): SchemaSnapshot {
  requireName(foreignKey.name, "The foreign key name");
  const { references } = foreignKey;
  const referenced = findTable(
    snapshot,
    references.namespace,
    references.table,
  );
  const missing = references.columns.filter(
    (column) =>
      !referenced.columns.some((candidate) => candidate.name === column),
  );
  if (references.columns.length === 0 || missing.length > 0) {
    throw new SchemaEditError(
      missing.length > 0
        ? `Table ${displayName(references.namespace, references.table)} has no column ${missing.join(", ")}.`
        : "Choose the referenced columns.",
    );
  }
  return withTable(snapshot, namespace, tableName, (table) => ({
    ...table,
    foreignKeys: [...table.foreignKeys, foreignKey],
  }));
}
