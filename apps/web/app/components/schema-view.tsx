import type {
  Column,
  Index,
  Namespace,
  SchemaSnapshot,
  Table,
} from "@skematron/core";
import type { UnsupportedObject } from "@skematron/adapters";
import { Callout, plural } from "./ui.tsx";

/** A type for reading: `public."Role"` becomes `Role`. */
function displayType(type: string): string {
  return type.replace(/^public\./, "").replaceAll('"', "");
}

/** What fills a column when a row does not say: plain words where possible. */
function columnDefault(column: Column): string {
  if (column.identity !== null) return "generated automatically";
  if (column.generated !== null)
    return `computed: ${column.generated.expression}`;
  if (column.default === null) return "";
  if (column.default.startsWith("nextval(")) return "auto-increment";
  // 'USER'::public."Role" reads as 'USER'.
  return column.default.replace(/^('(?:[^']|'')*')::[^']+$/, "$1");
}

/** The columns of a plain index definition, e.g. "email" from "… USING btree (email)". */
function indexColumns(index: Index): string | null {
  const columns = / USING \w+ \((.+)\)$/.exec(index.definition)?.[1];
  return columns === undefined ? null : columns.replaceAll('"', "");
}

const ACTIONS: Record<string, string> = {
  restrict: "restrict",
  cascade: "cascade",
  "set-null": "set null",
  "set-default": "set default",
};

function TableCard({ table }: { table: Table }) {
  const keyColumns = new Set(table.primaryKey?.columns ?? []);
  return (
    <div className="card flush" id={`table-${table.name}`}>
      <div style={{ padding: "14px 18px 10px" }}>
        <h3 style={{ margin: 0 }}>
          {table.name}{" "}
          <span className="hint">{plural(table.columns.length, "column")}</span>
        </h3>
        {table.comment !== null && <p className="muted">{table.comment}</p>}
      </div>
      <table>
        <thead>
          <tr>
            <th>Column</th>
            <th>Type</th>
            <th>Required</th>
            <th>Default</th>
          </tr>
        </thead>
        <tbody>
          {table.columns.map((column) => (
            <tr key={column.name}>
              <td>
                <code>{column.name}</code>
                {keyColumns.has(column.name) && (
                  <>
                    {" "}
                    <span className="badge info">key</span>
                  </>
                )}
              </td>
              <td>
                {displayType(column.type)}
                {column.collation !== null && (
                  <span className="hint"> · collation {column.collation}</span>
                )}
              </td>
              <td>
                {column.nullable ? <span className="muted">no</span> : "yes"}
              </td>
              <td>
                {columnDefault(column) === "" ? (
                  <span className="muted">—</span>
                ) : (
                  <code>{columnDefault(column)}</code>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <TableExtras table={table} />
    </div>
  );
}

function TableExtras({ table }: { table: Table }) {
  const chips: { key: string; label: string; title?: string }[] = [
    ...table.uniqueConstraints.map((constraint) => ({
      key: `u:${constraint.name}`,
      label: `Unique: ${constraint.columns.join(", ")}`,
      title: constraint.name,
    })),
    ...table.foreignKeys.map((foreignKey) => {
      const { references } = foreignKey;
      const target = `${references.namespace === "public" ? "" : `${references.namespace}.`}${references.table}.${references.columns.join(", ")}`;
      const onDelete =
        foreignKey.onDelete === "no-action"
          ? ""
          : ` · on delete ${ACTIONS[foreignKey.onDelete]}`;
      return {
        key: `f:${foreignKey.name}`,
        label: `${foreignKey.columns.join(", ")} → ${target}${onDelete}`,
        title: foreignKey.name,
      };
    }),
    ...table.indexes.map((index) => ({
      key: `i:${index.name}`,
      label: `${index.unique ? "Unique index" : "Index"}: ${indexColumns(index) ?? index.name}`,
      title: index.definition,
    })),
    ...table.checkConstraints.map((constraint) => ({
      key: `c:${constraint.name}`,
      label: `Check: ${constraint.expression}`,
      title: constraint.name,
    })),
  ];
  if (chips.length === 0) return null;
  return (
    <div className="chips" style={{ padding: "10px 18px 14px" }}>
      {chips.map((chip) => (
        <span key={chip.key} className="chip" title={chip.title}>
          {chip.label}
        </span>
      ))}
    </div>
  );
}

function NamespaceView({
  namespace,
  showName,
}: {
  namespace: Namespace;
  showName: boolean;
}) {
  return (
    <>
      {showName && (
        <h2>
          Schema <code>{namespace.name}</code>
        </h2>
      )}
      {namespace.tables.length === 0 && <p className="muted">No tables yet.</p>}
      {namespace.tables.map((table) => (
        <TableCard key={table.name} table={table} />
      ))}
      {namespace.enums.length > 0 && (
        <div className="card">
          <h3>Enums</h3>
          {namespace.enums.map((enumType) => (
            <p key={enumType.name}>
              <code>{enumType.name}</code>:{" "}
              <span className="chips" style={{ display: "inline-flex" }}>
                {enumType.values.map((value) => (
                  <span key={value} className="chip">
                    {value}
                  </span>
                ))}
              </span>
            </p>
          ))}
        </div>
      )}
      {namespace.sequences.length > 0 && (
        <details className="card">
          <summary>
            {plural(namespace.sequences.length, "sequence")} (counters behind
            auto-increment columns)
          </summary>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Used by</th>
                <th>Type</th>
                <th>Start / step</th>
              </tr>
            </thead>
            <tbody>
              {namespace.sequences.map((sequence) => (
                <tr key={sequence.name}>
                  <td>
                    <code>{sequence.name}</code>
                  </td>
                  <td>
                    {sequence.ownedBy === null
                      ? "—"
                      : `${sequence.ownedBy.table}.${sequence.ownedBy.column}`}
                  </td>
                  <td>{sequence.dataType}</td>
                  <td>
                    {sequence.start} / {sequence.increment}
                    {sequence.cycle ? " (cycles)" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </>
  );
}

/** Browses a snapshot: tables with their columns, keys and indexes; enums; sequences. */
export function SchemaView({
  snapshot,
  unsupported,
}: {
  snapshot: SchemaSnapshot;
  unsupported: UnsupportedObject[];
}) {
  const showNames =
    snapshot.namespaces.length > 1 ||
    snapshot.namespaces.some((namespace) => namespace.name !== "public");
  return (
    <>
      {unsupported.length > 0 && (
        <Callout
          tone="warning"
          title={`${plural(unsupported.length, "object")} in the database Skematron does not track`}
        >
          <p>
            They exist, but are not part of versions, migrations or exports:
          </p>
          <div className="chips">
            {unsupported.map((object) => (
              <span
                key={`${object.kind}:${object.namespace}:${object.table ?? ""}:${object.name}`}
                className="chip"
              >
                {object.kind}{" "}
                <code>
                  {[
                    object.namespace,
                    object.table !== null && object.table !== object.name
                      ? object.table
                      : null,
                    object.name,
                  ]
                    .filter((part) => part !== null)
                    .join(".")}
                </code>
              </span>
            ))}
          </div>
        </Callout>
      )}
      {snapshot.namespaces.length === 0 && (
        <p className="muted">The schema is empty.</p>
      )}
      {snapshot.namespaces.map((namespace) => (
        <NamespaceView
          key={namespace.name}
          namespace={namespace}
          showName={showNames}
        />
      ))}
    </>
  );
}
