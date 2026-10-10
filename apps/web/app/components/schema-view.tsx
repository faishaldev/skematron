import type {
  Column,
  ForeignKey,
  Namespace,
  SchemaSnapshot,
  Table,
} from "@skematron/core";
import type { UnsupportedObject } from "@skematron/adapters";

/** Browses a snapshot: every namespace's tables, keys, indexes, enums and sequences. */
export function SchemaView({
  snapshot,
  unsupported,
}: {
  snapshot: SchemaSnapshot;
  unsupported: UnsupportedObject[];
}) {
  return (
    <>
      {unsupported.length > 0 && (
        <div className="card error">
          <h3>Not captured</h3>
          <p className="muted">
            Skematron reports these objects but does not include them in
            versions, plans or exports.
          </p>
          <ul>
            {unsupported.map((object) => (
              <li
                key={`${object.kind}:${object.namespace}:${object.table ?? ""}:${object.name}`}
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
              </li>
            ))}
          </ul>
        </div>
      )}
      {snapshot.namespaces.map((namespace) => (
        <NamespaceView key={namespace.name} namespace={namespace} />
      ))}
    </>
  );
}

function NamespaceView({ namespace }: { namespace: Namespace }) {
  return (
    <>
      <h2>
        Schema <code>{namespace.name}</code>
      </h2>
      <p className="muted">
        {namespace.tables.length} tables · {namespace.enums.length} enums ·{" "}
        {namespace.sequences.length} sequences
      </p>
      {namespace.tables.map((table) => (
        <TableCard key={table.name} table={table} />
      ))}
      {namespace.enums.length > 0 && (
        <div className="card">
          <h3>Enums</h3>
          <table>
            <tbody>
              {namespace.enums.map((enumType) => (
                <tr key={enumType.name}>
                  <td>
                    <code>{enumType.name}</code>
                  </td>
                  <td>
                    {enumType.values.map((value) => `'${value}'`).join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {namespace.sequences.length > 0 && (
        <div className="card">
          <h3>Sequences</h3>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Start</th>
                <th>Increment</th>
                <th>Range</th>
                <th>Owned by</th>
              </tr>
            </thead>
            <tbody>
              {namespace.sequences.map((sequence) => (
                <tr key={sequence.name}>
                  <td>
                    <code>{sequence.name}</code>
                  </td>
                  <td>{sequence.dataType}</td>
                  <td>{sequence.start}</td>
                  <td>{sequence.increment}</td>
                  <td>
                    {sequence.minValue} … {sequence.maxValue}
                    {sequence.cycle ? " (cycle)" : ""}
                  </td>
                  <td>
                    {sequence.ownedBy === null
                      ? "—"
                      : `${sequence.ownedBy.table}.${sequence.ownedBy.column}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function describeColumn(column: Column): string {
  if (column.identity !== null) {
    return `identity (${column.identity === "always" ? "always" : "by default"})`;
  }
  if (column.generated !== null) {
    return `generated (${column.generated.kind}): ${column.generated.expression}`;
  }
  return column.default ?? "";
}

function describeForeignKey(foreignKey: ForeignKey): string {
  const { references } = foreignKey;
  const parts = [
    `(${foreignKey.columns.join(", ")}) → ${references.namespace}.${references.table} (${references.columns.join(", ")})`,
  ];
  if (foreignKey.onDelete !== "no-action")
    parts.push(`on delete ${foreignKey.onDelete}`);
  if (foreignKey.onUpdate !== "no-action")
    parts.push(`on update ${foreignKey.onUpdate}`);
  if (foreignKey.matchFull) parts.push("match full");
  if (foreignKey.deferrable !== "not-deferrable")
    parts.push(foreignKey.deferrable);
  return parts.join(" · ");
}

function TableCard({ table }: { table: Table }) {
  const constraints: { kind: string; name: string; detail: string }[] = [
    ...(table.primaryKey === null
      ? []
      : [
          {
            kind: "primary key",
            name: table.primaryKey.name,
            detail: `(${table.primaryKey.columns.join(", ")})`,
          },
        ]),
    ...table.uniqueConstraints.map((constraint) => ({
      kind: "unique",
      name: constraint.name,
      detail: `(${constraint.columns.join(", ")})${constraint.nullsNotDistinct ? " nulls not distinct" : ""}`,
    })),
    ...table.checkConstraints.map((constraint) => ({
      kind: "check",
      name: constraint.name,
      detail: constraint.expression,
    })),
    ...table.foreignKeys.map((foreignKey) => ({
      kind: "foreign key",
      name: foreignKey.name,
      detail: describeForeignKey(foreignKey),
    })),
    ...table.indexes.map((index) => ({
      kind: index.unique ? "unique index" : "index",
      name: index.name,
      detail: index.definition,
    })),
  ];

  return (
    <div className="card" id={`table-${table.name}`}>
      <h3>{table.name}</h3>
      {table.comment !== null && <p className="muted">{table.comment}</p>}
      <table>
        <thead>
          <tr>
            <th>Column</th>
            <th>Type</th>
            <th>Nullable</th>
            <th>Default / identity / generated</th>
            <th>Comment</th>
          </tr>
        </thead>
        <tbody>
          {table.columns.map((column) => (
            <tr key={column.name}>
              <td>
                <code>{column.name}</code>
              </td>
              <td>
                <code>{column.type}</code>
                {column.collation !== null && (
                  <span className="muted"> collate {column.collation}</span>
                )}
              </td>
              <td>{column.nullable ? "yes" : "no"}</td>
              <td>
                {describeColumn(column) !== "" && (
                  <code>{describeColumn(column)}</code>
                )}
              </td>
              <td>{column.comment}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {constraints.length > 0 && (
        <table style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Constraint / index</th>
              <th>Name</th>
              <th>Definition</th>
            </tr>
          </thead>
          <tbody>
            {constraints.map((constraint) => (
              <tr key={`${constraint.kind}:${constraint.name}`}>
                <td>{constraint.kind}</td>
                <td>
                  <code>{constraint.name}</code>
                </td>
                <td>
                  <code>{constraint.detail}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
