/**
 * Schema snapshot model, format version 1.
 *
 * A snapshot describes the structure of a database schema, never its data.
 * Engine-specific SQL fragments (types, default and check expressions, index
 * definitions) are stored verbatim as the source engine printed them.
 *
 * Any change to the shape of these types requires a new format version and an
 * update to ai/knowledges/snapshot-format.md.
 */

export const SNAPSHOT_FORMAT_VERSION = 1;

export type Dialect = "postgresql";

export interface SchemaSnapshot {
  formatVersion: typeof SNAPSHOT_FORMAT_VERSION;
  dialect: Dialect;
  namespaces: Namespace[];
}

/** A schema in the database engine's sense (PostgreSQL `CREATE SCHEMA`). */
export interface Namespace {
  name: string;
  tables: Table[];
  enums: EnumType[];
  sequences: Sequence[];
}

export interface Table {
  name: string;
  /** In ordinal (physical) order. Position is recorded but not compared when planning. */
  columns: Column[];
  primaryKey: PrimaryKey | null;
  uniqueConstraints: UniqueConstraint[];
  checkConstraints: CheckConstraint[];
  foreignKeys: ForeignKey[];
  indexes: Index[];
  comment: string | null;
}

export type IdentityKind = "always" | "by-default";

export interface GeneratedColumn {
  kind: "stored" | "virtual";
  /** Generation expression as SQL. */
  expression: string;
}

export interface Column {
  name: string;
  /** Type as SQL, e.g. `character varying(255)` or `app.order_status`. */
  type: string;
  nullable: boolean;
  /** Default expression as SQL, or null. Always null for identity and generated columns. */
  default: string | null;
  identity: IdentityKind | null;
  generated: GeneratedColumn | null;
  /** Explicit collation as SQL, or null when the type's default collation applies. */
  collation: string | null;
  comment: string | null;
}

export type Deferrability =
  "not-deferrable" | "deferrable" | "deferrable-initially-deferred";

export interface PrimaryKey {
  name: string;
  columns: string[];
  deferrable: Deferrability;
}

export interface UniqueConstraint {
  name: string;
  columns: string[];
  nullsNotDistinct: boolean;
  deferrable: Deferrability;
}

export interface CheckConstraint {
  name: string;
  /** Check expression as SQL, without the CHECK keyword. */
  expression: string;
}

export type ReferentialAction =
  "no-action" | "restrict" | "cascade" | "set-null" | "set-default";

export interface ForeignKeyReference {
  namespace: string;
  table: string;
  columns: string[];
}

export interface ForeignKey {
  name: string;
  columns: string[];
  references: ForeignKeyReference;
  onUpdate: ReferentialAction;
  onDelete: ReferentialAction;
  matchFull: boolean;
  deferrable: Deferrability;
}

/** An index that does not back a primary key or unique constraint. */
export interface Index {
  name: string;
  unique: boolean;
  /** Complete index definition as SQL (for PostgreSQL, `pg_get_indexdef`). */
  definition: string;
}

export interface EnumType {
  name: string;
  /** In sort order. Order is significant. */
  values: string[];
}

export interface SequenceOwner {
  table: string;
  column: string;
}

/** Numeric properties are decimal strings so 64-bit values stay exact. */
export interface Sequence {
  name: string;
  dataType: string;
  start: string;
  increment: string;
  minValue: string;
  maxValue: string;
  cache: string;
  cycle: boolean;
  /** Column that owns the sequence (for example a `serial` column), in the same namespace. */
  ownedBy: SequenceOwner | null;
}

export function emptySnapshot(dialect: Dialect): SchemaSnapshot {
  return { formatVersion: SNAPSHOT_FORMAT_VERSION, dialect, namespaces: [] };
}
