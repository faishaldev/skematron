// An entity-relationship diagram of a snapshot, drawn as SVG on the server (no client code,
// no layout library). Tables that others point to are placed left of the tables that point
// to them; each foreign key is a curve from its column to the referenced column. Tables
// without relations are laid out in a grid after the connected ones.
import {
  compareNames,
  type Column,
  type MigrationPlan,
  type SchemaSnapshot,
  type Table,
} from "@skematron/core";
import { plural } from "./ui.tsx";

const HEADER = 32;
const ROW = 22;
const PAD = 8;
const GAP_X = 96;
const GAP_Y = 28;
const MARGIN = 16;
const MAX_ROWS = 18;
const PER_COLUMN = 5;
/** Spacing of the lanes above the tables that carry links between distant columns. */
const LANE = 10;
const CHAR = 7.3;

export interface DiagramHighlights {
  /** Table keys (`namespace.table`) that are new. */
  addedTables: ReadonlySet<string>;
  /** Table keys that exist on both sides but changed. */
  changedTables: ReadonlySet<string>;
  /** Column keys (`namespace.table.column`) that are new in existing tables. */
  addedColumns: ReadonlySet<string>;
  /** Table keys that are gone; listed below the diagram. */
  removedTables: readonly string[];
}

interface Box {
  key: string;
  label: string;
  table: Table;
  rows: Column[];
  hidden: number;
  keyColumns: Set<string>;
  foreignColumns: Set<string>;
  x: number;
  y: number;
  width: number;
  height: number;
}

const keyOf = (namespace: string, table: string) => `${namespace}.${table}`;

const displayType = (type: string) => {
  const short = type.replace(/^public\./, "").replaceAll('"', "");
  return short.length > 26 ? `${short.slice(0, 25)}…` : short;
};

/**
 * What a plan adds and changes, for coloring a branch's diagram. Uses the planner's
 * operations, so the colors always match the list of changes (and renames count as renames
 * once answered).
 */
export function diagramHighlights(plan: MigrationPlan): DiagramHighlights {
  const addedTables = new Set<string>();
  const changedTables = new Set<string>();
  const addedColumns = new Set<string>();
  const removedTables: string[] = [];
  for (const { operation } of plan.operations) {
    const ns = operation.namespace;
    switch (operation.kind) {
      case "create-table":
        addedTables.add(keyOf(ns, operation.table.name));
        break;
      case "drop-table":
        removedTables.push(keyOf(ns, operation.tableName));
        break;
      case "rename-table":
        changedTables.add(keyOf(ns, operation.newName));
        break;
      case "add-column":
        changedTables.add(keyOf(ns, operation.tableName));
        addedColumns.add(
          `${keyOf(ns, operation.tableName)}.${operation.column.name}`,
        );
        break;
      case "rename-column":
        changedTables.add(keyOf(ns, operation.tableName));
        addedColumns.add(
          `${keyOf(ns, operation.tableName)}.${operation.newName}`,
        );
        break;
      default:
        if ("tableName" in operation) {
          changedTables.add(keyOf(ns, operation.tableName));
        }
    }
  }
  for (const key of addedTables) changedTables.delete(key);
  return { addedTables, changedTables, addedColumns, removedTables };
}

function layout(snapshot: SchemaSnapshot) {
  const showNamespace =
    snapshot.namespaces.length > 1 ||
    snapshot.namespaces.some((namespace) => namespace.name !== "public");
  const boxes = new Map<string, Box>();
  for (const namespace of snapshot.namespaces) {
    for (const table of namespace.tables) {
      const key = keyOf(namespace.name, table.name);
      const rows = table.columns.slice(0, MAX_ROWS);
      const foreignColumns = new Set(
        table.foreignKeys.flatMap((foreignKey) => foreignKey.columns),
      );
      const label = showNamespace ? key : table.name;
      const widest = Math.max(
        label.length * 8.2 + 24,
        ...rows.map(
          (column) =>
            (column.name.length + displayType(column.type).length) * CHAR + 70,
        ),
      );
      boxes.set(key, {
        key,
        label,
        table,
        rows,
        hidden: table.columns.length - rows.length,
        keyColumns: new Set(table.primaryKey?.columns ?? []),
        foreignColumns,
        x: 0,
        y: 0,
        width: Math.round(Math.min(Math.max(widest, 180), 400)),
        height:
          HEADER +
          (rows.length + (table.columns.length > rows.length ? 1 : 0)) * ROW +
          PAD,
      });
    }
  }

  // Edges: child (has the foreign key) → parent (is referenced).
  const parents = new Map<string, string[]>();
  const children = new Map<string, number>();
  for (const namespace of snapshot.namespaces) {
    for (const table of namespace.tables) {
      const key = keyOf(namespace.name, table.name);
      for (const foreignKey of table.foreignKeys) {
        const parent = keyOf(
          foreignKey.references.namespace,
          foreignKey.references.table,
        );
        if (parent === key || !boxes.has(parent)) continue;
        parents.set(key, [...(parents.get(key) ?? []), parent]);
        children.set(parent, (children.get(parent) ?? 0) + 1);
      }
    }
  }

  // Level = longest chain of parents; edges that close a cycle are ignored.
  const level = new Map<string, number>();
  const visiting = new Set<string>();
  const levelOf = (key: string): number => {
    const known = level.get(key);
    if (known !== undefined) return known;
    visiting.add(key);
    let value = 0;
    for (const parent of parents.get(key) ?? []) {
      if (!visiting.has(parent)) value = Math.max(value, levelOf(parent) + 1);
    }
    visiting.delete(key);
    level.set(key, value);
    return value;
  };
  const keys = [...boxes.keys()].sort(compareNames);
  const connected = keys.filter((key) => parents.has(key) || children.has(key));
  const isolated = keys.filter((key) => !connected.includes(key));

  // Columns of boxes: one per level (wrapped when long), then the isolated tables.
  const columns: Box[][] = [];
  const position = new Map<string, number>();
  const levels = new Map<number, string[]>();
  for (const key of connected) {
    const value = levelOf(key);
    levels.set(value, [...(levels.get(value) ?? []), key]);
  }
  for (const value of [...levels.keys()].sort((a, b) => a - b)) {
    const members = levels.get(value)!;
    // Keep children near their parents: order by the parents' average position.
    const weight = (key: string) => {
      const placed = (parents.get(key) ?? [])
        .map((parent) => position.get(parent))
        .filter((index): index is number => index !== undefined);
      return placed.length === 0
        ? Number.POSITIVE_INFINITY
        : placed.reduce((sum, index) => sum + index, 0) / placed.length;
    };
    members.sort((a, b) => weight(a) - weight(b) || compareNames(a, b));
    for (let start = 0; start < members.length; start += PER_COLUMN) {
      const column = members.slice(start, start + PER_COLUMN);
      column.forEach((key, index) => position.set(key, start + index));
      columns.push(column.map((key) => boxes.get(key)!));
    }
  }
  for (let start = 0; start < isolated.length; start += PER_COLUMN) {
    columns.push(
      isolated.slice(start, start + PER_COLUMN).map((key) => boxes.get(key)!),
    );
  }

  // Links between columns that are not neighbors would pass behind the tables in between,
  // so they run along a lane of their own above all tables.
  const columnOf = new Map<string, number>();
  columns.forEach((column, index) => {
    for (const box of column) columnOf.set(box.key, index);
  });
  const lanes = new Map<string, number>();
  for (const namespace of snapshot.namespaces) {
    for (const table of namespace.tables) {
      const child = keyOf(namespace.name, table.name);
      for (const foreignKey of table.foreignKeys) {
        const parent = keyOf(
          foreignKey.references.namespace,
          foreignKey.references.table,
        );
        const from = columnOf.get(child);
        const to = columnOf.get(parent);
        if (from === undefined || to === undefined) continue;
        if (Math.abs(from - to) > 1) {
          lanes.set(`${child}:${foreignKey.name}`, MARGIN + lanes.size * LANE);
        }
      }
    }
  }
  const top = MARGIN + (lanes.size === 0 ? 0 : lanes.size * LANE + 14);

  let x = MARGIN;
  let height = 0;
  for (const column of columns) {
    const width = Math.max(...column.map((box) => box.width));
    let y = top;
    for (const box of column) {
      box.x = x;
      box.y = y;
      box.width = width;
      y += box.height + GAP_Y;
    }
    height = Math.max(height, y - GAP_Y + MARGIN);
    x += width + GAP_X;
  }
  return {
    boxes,
    lanes,
    width: Math.max(x - GAP_X + MARGIN, 200),
    height: Math.max(height, 80),
  };
}

function rowY(box: Box, column: string): number {
  const index = box.rows.findIndex((row) => row.name === column);
  return index === -1
    ? box.y + HEADER / 2
    : box.y + HEADER + index * ROW + ROW / 2;
}

/** A link routed up to its lane, across, and down to the referenced table, with round corners. */
function lanePath(
  child: Box,
  childY: number,
  parent: Box,
  parentY: number,
  lane: number,
) {
  const r = 6;
  const shift = ((lane / LANE) % 4) * 6;
  const leftward = parent.x < child.x;
  const x1 = leftward ? child.x : child.x + child.width;
  const x2 = leftward ? parent.x + parent.width : parent.x;
  const g1 = leftward ? x1 - 24 - shift : x1 + 24 + shift;
  const g2 = leftward ? x2 + 24 + shift : x2 - 24 - shift;
  const s1 = leftward ? -1 : 1;
  const s2 = leftward ? 1 : -1;
  return {
    d: [
      `M ${x1} ${childY}`,
      `L ${g1 - s1 * r} ${childY}`,
      `Q ${g1} ${childY} ${g1} ${childY - r}`,
      `L ${g1} ${lane + r}`,
      `Q ${g1} ${lane} ${g1 + s1 * r} ${lane}`,
      `L ${g2 + s2 * r} ${lane}`,
      `Q ${g2} ${lane} ${g2} ${lane + r}`,
      `L ${g2} ${parentY - r}`,
      `Q ${g2} ${parentY} ${g2 - s2 * r} ${parentY}`,
      `L ${x2} ${parentY}`,
    ].join(" "),
    end: { x: x2, y: parentY },
  };
}

function edgePath(child: Box, childY: number, parent: Box, parentY: number) {
  let x1: number;
  let x2: number;
  let bend: number;
  if (parent.x + parent.width <= child.x) {
    x1 = child.x;
    x2 = parent.x + parent.width;
    bend = -Math.max(40, (x1 - x2) / 2);
  } else if (child.x + child.width <= parent.x) {
    x1 = child.x + child.width;
    x2 = parent.x;
    bend = Math.max(40, (x2 - x1) / 2);
  } else {
    // Same column: loop out on the right.
    x1 = child.x + child.width;
    x2 = parent.x + parent.width;
    const c = Math.max(x1, x2) + 48;
    return {
      d: `M ${x1} ${childY} C ${c} ${childY}, ${c} ${parentY}, ${x2} ${parentY}`,
      end: { x: x2, y: parentY },
    };
  }
  return {
    d: `M ${x1} ${childY} C ${x1 + bend} ${childY}, ${x2 - bend} ${parentY}, ${x2} ${parentY}`,
    end: { x: x2, y: parentY },
  };
}

/** The diagram of a snapshot. With `highlights`, new and changed tables and columns are colored. */
export function SchemaDiagram({
  snapshot,
  highlights,
}: {
  snapshot: SchemaSnapshot;
  highlights?: DiagramHighlights;
}) {
  const { boxes, lanes, width, height } = layout(snapshot);
  if (boxes.size === 0) {
    return (
      <div className="card empty">
        <h3>No tables yet</h3>
      </div>
    );
  }
  const edges = snapshot.namespaces.flatMap((namespace) =>
    namespace.tables.flatMap((table) => {
      const child = boxes.get(keyOf(namespace.name, table.name))!;
      return table.foreignKeys.flatMap((foreignKey) => {
        const parent = boxes.get(
          keyOf(foreignKey.references.namespace, foreignKey.references.table),
        );
        if (parent === undefined) return [];
        const childY = rowY(child, foreignKey.columns[0]!);
        const parentY = rowY(parent, foreignKey.references.columns[0]!);
        const lane = lanes.get(`${child.key}:${foreignKey.name}`);
        const path =
          lane === undefined
            ? edgePath(child, childY, parent, parentY)
            : lanePath(child, childY, parent, parentY, lane);
        return [
          {
            key: `${child.key}:${foreignKey.name}`,
            title: `${child.label}.${foreignKey.columns.join(", ")} → ${parent.label}.${foreignKey.references.columns.join(", ")}`,
            ...path,
          },
        ];
      });
    }),
  );
  const tableCount = boxes.size;
  return (
    <>
      <div className="erd-wrap">
        <svg
          className="erd"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Diagram of ${plural(tableCount, "table")} and ${plural(edges.length, "relation")}`}
        >
          <g>
            {edges.map((edge) => (
              <g key={edge.key}>
                <path className="erd-edge" d={edge.d}>
                  <title>{edge.title}</title>
                </path>
                <circle
                  className="erd-dot"
                  cx={edge.end.x}
                  cy={edge.end.y}
                  r={3.5}
                />
              </g>
            ))}
          </g>
          {[...boxes.values()].map((box) => {
            const state = highlights?.addedTables.has(box.key)
              ? "added"
              : highlights?.changedTables.has(box.key)
                ? "changed"
                : "";
            return (
              <g
                key={box.key}
                className={`erd-table ${state}`}
                transform={`translate(${box.x} ${box.y})`}
              >
                <rect
                  className="erd-box"
                  width={box.width}
                  height={box.height}
                  rx={8}
                />
                <rect
                  className="erd-head"
                  width={box.width}
                  height={HEADER}
                  rx={8}
                />
                <rect
                  className="erd-head"
                  y={HEADER - 8}
                  width={box.width}
                  height={8}
                />
                <line
                  className="erd-rule"
                  x1={0}
                  x2={box.width}
                  y1={HEADER}
                  y2={HEADER}
                />
                <text className="erd-title" x={12} y={HEADER / 2 + 5}>
                  {box.label}
                </text>
                {box.rows.map((column, index) => {
                  const y = HEADER + index * ROW;
                  const added = highlights?.addedColumns.has(
                    `${box.key}.${column.name}`,
                  );
                  const marker = box.keyColumns.has(column.name)
                    ? "PK"
                    : box.foreignColumns.has(column.name)
                      ? "FK"
                      : "";
                  return (
                    <g
                      key={column.name}
                      className={added === true ? "erd-row added" : "erd-row"}
                    >
                      {added === true && (
                        <rect
                          className="erd-row-bg"
                          x={1}
                          y={y + 1}
                          width={box.width - 2}
                          height={ROW - 2}
                        />
                      )}
                      {marker !== "" && (
                        <text className="erd-key" x={10} y={y + ROW / 2 + 3.5}>
                          {marker}
                        </text>
                      )}
                      <text
                        className={
                          column.nullable ? "erd-col optional" : "erd-col"
                        }
                        x={34}
                        y={y + ROW / 2 + 4}
                      >
                        {column.name}
                      </text>
                      <text
                        className="erd-type"
                        x={box.width - 12}
                        y={y + ROW / 2 + 4}
                        textAnchor="end"
                      >
                        {displayType(column.type)}
                      </text>
                    </g>
                  );
                })}
                {box.hidden > 0 && (
                  <text
                    className="erd-type"
                    x={34}
                    y={HEADER + box.rows.length * ROW + ROW / 2 + 4}
                  >
                    … {plural(box.hidden, "more column")}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <p className="hint erd-legend">
        <span className="erd-chip key">PK</span> key ·{" "}
        <span className="erd-chip key">FK</span> link to another table (the line
        ends at the table it points to) · <em>italic</em> = optional column
        {highlights !== undefined && (
          <>
            {" "}
            · <span className="erd-chip added">new</span>{" "}
            <span className="erd-chip changed">changed</span>
          </>
        )}
      </p>
      {highlights !== undefined && highlights.removedTables.length > 0 && (
        <p className="hint">
          Removed:{" "}
          {highlights.removedTables
            .map((key) => key.replace(/^public\./, ""))
            .join(", ")}
        </p>
      )}
    </>
  );
}
