// Snapshot builders for tests. Exported as `@skematron/core/testing`; not part of the public API.
import {
  SNAPSHOT_FORMAT_VERSION,
  type Column,
  type ForeignKey,
  type ForeignKeyReference,
  type Namespace,
  type SchemaSnapshot,
  type Sequence,
  type Table,
} from "./snapshot.ts";

export function snapshot(...namespaces: Namespace[]): SchemaSnapshot {
  return {
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    dialect: "postgresql",
    namespaces,
  };
}

export function namespace(
  name: string,
  overrides: Partial<Namespace> = {},
): Namespace {
  return { name, tables: [], enums: [], sequences: [], ...overrides };
}

export function table(name: string, overrides: Partial<Table> = {}): Table {
  return {
    name,
    columns: [],
    primaryKey: null,
    uniqueConstraints: [],
    checkConstraints: [],
    foreignKeys: [],
    indexes: [],
    comment: null,
    ...overrides,
  };
}

export function column(
  name: string,
  type: string,
  overrides: Partial<Column> = {},
): Column {
  return {
    name,
    type,
    nullable: true,
    default: null,
    identity: null,
    generated: null,
    collation: null,
    comment: null,
    ...overrides,
  };
}

export function foreignKey(
  name: string,
  columns: string[],
  references: ForeignKeyReference,
  overrides: Partial<ForeignKey> = {},
): ForeignKey {
  return {
    name,
    columns,
    references,
    onUpdate: "no-action",
    onDelete: "no-action",
    matchFull: false,
    deferrable: "not-deferrable",
    ...overrides,
  };
}

export function sequence(
  name: string,
  overrides: Partial<Sequence> = {},
): Sequence {
  return {
    name,
    dataType: "integer",
    start: "1",
    increment: "1",
    minValue: "1",
    maxValue: "2147483647",
    cache: "1",
    cycle: false,
    ownedBy: null,
    ...overrides,
  };
}
