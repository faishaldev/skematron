import {
  canonicalizeSnapshot,
  compareNames,
  SNAPSHOT_FORMAT_VERSION,
  type Column,
  type Deferrability,
  type EnumType,
  type IdentityKind,
  type ReferentialAction,
  type SchemaSnapshot,
  type Sequence,
  type Table,
} from "@skematron/core";
import {
  COLUMNS_QUERY,
  constraintsQuery,
  ENUMS_QUERY,
  INDEXES_QUERY,
  NAMESPACES_QUERY,
  OTHER_OBJECTS_QUERY,
  RELATIONS_QUERY,
  SEQUENCES_QUERY,
  sessionSettingsQuery,
  VERSION_QUERY,
} from "./queries.ts";
import type { PostgresSession } from "./session.ts";

export const MIN_POSTGRES_VERSION_NUM = 140000;

export interface IntrospectionOptions {
  /** Capture only these namespaces. Default: every non-system namespace. */
  namespaces?: readonly string[];
  /** Per-statement timeout inside the introspection transaction. Default: 30000. */
  statementTimeoutMs?: number;
}

/** Something in the database that the snapshot does not capture. */
export interface UnsupportedObject {
  /** For example `view`, `trigger`, `exclusion-constraint`. See ai/knowledges/postgresql-support.md. */
  kind: string;
  namespace: string;
  /** The table the object belongs to, for table-level objects. */
  table: string | null;
  name: string;
}

export interface PostgresIntrospection {
  snapshot: SchemaSnapshot;
  unsupported: UnsupportedObject[];
  serverVersion: string;
}

export class PostgresIntrospectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresIntrospectionError";
  }
}

/**
 * Reads the schema structure of a PostgreSQL 14+ database. It runs inside a
 * read-only transaction that is always rolled back, queries only the system
 * catalog, and never reads table rows.
 */
export async function introspectPostgres(
  session: PostgresSession,
  options: IntrospectionOptions = {},
): Promise<PostgresIntrospection> {
  const settings = sessionSettingsQuery(options.statementTimeoutMs ?? 30_000);
  await session.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  let result: PostgresIntrospection;
  try {
    await session.query(settings);
    result = await readCatalog(session, options.namespaces);
  } catch (error) {
    // Keep the original error. Nothing was written, so a failed rollback loses nothing.
    await session.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
  await session.query("ROLLBACK");
  return result;
}

type Row = Record<string, unknown>;

async function rowsOf(session: PostgresSession, sql: string): Promise<Row[]> {
  const { rows } = await session.query(sql);
  if (!Array.isArray(rows)) {
    throw new PostgresIntrospectionError(
      "The database session returned a result without rows.",
    );
  }
  return rows.map((row) => {
    if (row === null || typeof row !== "object") {
      throw new PostgresIntrospectionError(
        "The database session returned a row that is not an object.",
      );
    }
    return row as Row;
  });
}

function invalid(key: string, expected: string): PostgresIntrospectionError {
  return new PostgresIntrospectionError(
    `Catalog column ${key} is not ${expected}.`,
  );
}

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw invalid(key, "text");
  return value;
}

function nullableText(row: Row, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw invalid(key, "text or null");
  return value;
}

function bool(row: Row, key: string): boolean {
  const value = row[key];
  if (typeof value === "boolean") return value;
  if (value === "t" || value === "true") return true;
  if (value === "f" || value === "false") return false;
  throw invalid(key, "a boolean");
}

function int(row: Row, key: string): number {
  const value = row[key];
  const number = typeof value === "string" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number))
    throw invalid(key, "an integer");
  return number;
}

function textList(row: Row, key: string): string[] {
  const value = nullableText(row, key);
  if (value === null) return [];
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    !parsed.every((item) => typeof item === "string")
  ) {
    throw invalid(key, "a JSON list of text");
  }
  return parsed;
}

function deferrability(row: Row): Deferrability {
  if (!bool(row, "deferrable")) return "not-deferrable";
  return bool(row, "deferred") ? "deferrable-initially-deferred" : "deferrable";
}

const REFERENTIAL_ACTIONS: Record<string, ReferentialAction> = {
  a: "no-action",
  r: "restrict",
  c: "cascade",
  n: "set-null",
  d: "set-default",
};

function referentialAction(row: Row, key: string): ReferentialAction {
  const action = REFERENTIAL_ACTIONS[text(row, key)];
  if (action === undefined) throw invalid(key, "a known referential action");
  return action;
}

function identity(row: Row): IdentityKind | null {
  const value = text(row, "identity");
  if (value === "") return null;
  if (value === "a") return "always";
  if (value === "d") return "by-default";
  throw invalid("identity", "a known identity kind");
}

function column(row: Row): Column {
  const expression = nullableText(row, "default_expression");
  const generated = text(row, "generated");
  if (generated !== "" && generated !== "s" && generated !== "v") {
    throw invalid("generated", "a known generated column kind");
  }
  if (generated !== "" && expression === null) {
    throw new PostgresIntrospectionError("Generated column has no expression.");
  }
  return {
    name: text(row, "name"),
    type: text(row, "type"),
    nullable: !bool(row, "not_null"),
    default: generated === "" ? expression : null,
    identity: identity(row),
    generated:
      generated === ""
        ? null
        : {
            kind: generated === "s" ? "stored" : "virtual",
            expression: expression!,
          },
    collation: nullableText(row, "collation"),
    comment: nullableText(row, "comment"),
  };
}

const UNSUPPORTED_RELATIONS: Record<string, string> = {
  p: "partitioned-table",
  v: "view",
  m: "materialized-view",
  f: "foreign-table",
  c: "composite-type",
};

const tableKey = (namespace: string, table: string): string =>
  JSON.stringify([namespace, table]);

async function readCatalog(
  session: PostgresSession,
  requestedNamespaces: readonly string[] | undefined,
): Promise<PostgresIntrospection> {
  const [versionRow] = await rowsOf(session, VERSION_QUERY);
  if (versionRow === undefined)
    throw new PostgresIntrospectionError("Could not read the server version.");
  const versionNum = int(versionRow, "version_num");
  const serverVersion = text(versionRow, "version");
  if (versionNum < MIN_POSTGRES_VERSION_NUM) {
    throw new PostgresIntrospectionError(
      `PostgreSQL ${serverVersion} is not supported. Skematron requires PostgreSQL 14 or newer.`,
    );
  }

  const namespaceRows = await rowsOf(session, NAMESPACES_QUERY);
  const relationRows = await rowsOf(session, RELATIONS_QUERY);
  const columnRows = await rowsOf(session, COLUMNS_QUERY);
  const constraintRows = await rowsOf(session, constraintsQuery(versionNum));
  const indexRows = await rowsOf(session, INDEXES_QUERY);
  const enumRows = await rowsOf(session, ENUMS_QUERY);
  const sequenceRows = await rowsOf(session, SEQUENCES_QUERY);
  const otherRows = await rowsOf(session, OTHER_OBJECTS_QUERY);

  const available = namespaceRows.map((row) => text(row, "name"));
  if (requestedNamespaces !== undefined) {
    const missing = requestedNamespaces.filter(
      (name) => !available.includes(name),
    );
    if (missing.length > 0) {
      throw new PostgresIntrospectionError(
        `Namespace not found or not a user namespace: ${missing.map((name) => JSON.stringify(name)).join(", ")}.`,
      );
    }
  }
  const selected = new Set(requestedNamespaces ?? available);
  const inScope = (row: Row): boolean => selected.has(text(row, "namespace"));

  const unsupported: UnsupportedObject[] = [];
  const report = (
    kind: string,
    namespace: string,
    table: string | null,
    name: string,
  ): void => {
    unsupported.push({ kind, namespace, table, name });
  };

  const tables = new Map<
    string,
    { namespace: string; table: Table; positions: Map<string, number> }
  >();
  for (const row of relationRows.filter(inScope)) {
    const namespace = text(row, "namespace");
    const name = text(row, "name");
    const kind = text(row, "kind");
    if (kind !== "r") {
      report(
        UNSUPPORTED_RELATIONS[kind] ?? `relation-kind-${kind}`,
        namespace,
        null,
        name,
      );
    } else if (bool(row, "is_partition")) {
      report("partition", namespace, null, name);
    } else if (bool(row, "inherits")) {
      report("inherited-table", namespace, null, name);
    } else if (text(row, "persistence") !== "p") {
      report("unlogged-table", namespace, null, name);
    } else {
      if (bool(row, "row_security"))
        report("row-level-security", namespace, name, name);
      tables.set(tableKey(namespace, name), {
        namespace,
        positions: new Map(),
        table: {
          name,
          columns: [],
          primaryKey: null,
          uniqueConstraints: [],
          checkConstraints: [],
          foreignKeys: [],
          indexes: [],
          comment: nullableText(row, "comment"),
        },
      });
    }
  }
  const captured = (row: Row) =>
    tables.get(tableKey(text(row, "namespace"), text(row, "table_name")));

  for (const row of columnRows.filter(inScope)) {
    const entry = captured(row);
    if (entry === undefined) continue;
    const mapped = column(row);
    entry.table.columns.push(mapped);
    entry.positions.set(mapped.name, int(row, "position"));
  }
  for (const { table, positions } of tables.values()) {
    table.columns.sort(
      (a, b) => positions.get(a.name)! - positions.get(b.name)!,
    );
  }

  for (const row of constraintRows.filter(inScope)) {
    const entry = captured(row);
    if (entry === undefined) continue;
    const { namespace, table } = entry;
    const name = text(row, "name");
    const type = text(row, "type");
    if (type === "p") {
      table.primaryKey = {
        name,
        columns: textList(row, "columns"),
        deferrable: deferrability(row),
      };
    } else if (type === "u") {
      table.uniqueConstraints.push({
        name,
        columns: textList(row, "columns"),
        nullsNotDistinct: bool(row, "nulls_not_distinct"),
        deferrable: deferrability(row),
      });
    } else if (type === "c") {
      if (bool(row, "no_inherit"))
        report("check-no-inherit", namespace, table.name, name);
      else
        table.checkConstraints.push({
          name,
          expression: text(row, "check_expression"),
        });
    } else if (type === "f") {
      if (bool(row, "has_delete_set_columns")) {
        report("foreign-key-set-columns", namespace, table.name, name);
        continue;
      }
      table.foreignKeys.push({
        name,
        columns: textList(row, "columns"),
        references: {
          namespace: text(row, "ref_namespace"),
          table: text(row, "ref_table"),
          columns: textList(row, "ref_columns"),
        },
        onUpdate: referentialAction(row, "on_update"),
        onDelete: referentialAction(row, "on_delete"),
        matchFull: text(row, "match_type") === "f",
        deferrable: deferrability(row),
      });
    } else if (type === "x") {
      report("exclusion-constraint", namespace, table.name, name);
    } else if (type !== "t" && type !== "n") {
      // 't' (constraint trigger) is reported with triggers; 'n' (NOT NULL, PostgreSQL 18+) is column nullability.
      report(`constraint-type-${type}`, namespace, table.name, name);
    }
  }

  for (const row of indexRows.filter(inScope)) {
    const entry = captured(row);
    if (entry === undefined) continue;
    const name = text(row, "name");
    if (!bool(row, "is_valid")) {
      report("invalid-index", entry.namespace, entry.table.name, name);
      continue;
    }
    entry.table.indexes.push({
      name,
      unique: bool(row, "is_unique"),
      definition: text(row, "definition"),
    });
  }

  const enums = new Map<string, EnumType[]>();
  for (const row of enumRows.filter(inScope)) {
    const list = enums.get(text(row, "namespace")) ?? [];
    list.push({ name: text(row, "name"), values: textList(row, "labels") });
    enums.set(text(row, "namespace"), list);
  }

  const sequences = new Map<string, Sequence[]>();
  for (const row of sequenceRows.filter(inScope)) {
    const namespace = text(row, "namespace");
    const name = text(row, "name");
    const dependency = nullableText(row, "owner_dependency");
    if (dependency === "i") continue; // An identity column's sequence; implied by the column.
    let ownedBy: Sequence["ownedBy"] = null;
    if (dependency === "a") {
      const ownerTable = text(row, "owner_table");
      if (!tables.has(tableKey(namespace, ownerTable))) {
        report("sequence-of-unsupported-table", namespace, ownerTable, name);
        continue;
      }
      ownedBy = { table: ownerTable, column: text(row, "owner_column") };
    }
    const list = sequences.get(namespace) ?? [];
    list.push({
      name,
      dataType: text(row, "data_type"),
      start: text(row, "start"),
      increment: text(row, "increment"),
      minValue: text(row, "min_value"),
      maxValue: text(row, "max_value"),
      cache: text(row, "cache"),
      cycle: bool(row, "cycle"),
      ownedBy,
    });
    sequences.set(namespace, list);
  }

  for (const row of otherRows.filter(inScope)) {
    report(
      text(row, "kind"),
      text(row, "namespace"),
      nullableText(row, "table_name"),
      text(row, "name"),
    );
  }

  const snapshot = canonicalizeSnapshot({
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    dialect: "postgresql",
    namespaces: [...selected].map((name) => ({
      name,
      tables: [...tables.values()]
        .filter((entry) => entry.namespace === name)
        .map((entry) => entry.table),
      enums: enums.get(name) ?? [],
      sequences: sequences.get(name) ?? [],
    })),
  });
  unsupported.sort(
    (a, b) =>
      compareNames(a.kind, b.kind) ||
      compareNames(a.namespace, b.namespace) ||
      compareNames(a.table ?? "", b.table ?? "") ||
      compareNames(a.name, b.name),
  );
  return { snapshot, unsupported, serverVersion };
}
