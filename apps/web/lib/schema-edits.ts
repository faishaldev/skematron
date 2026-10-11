// Edits people make in the schema editor, as data, and how they change a snapshot. The
// result is not trusted yet: the caller normalizes it in the shadow database
// (lib/shadow.ts), which rejects invalid types and defaults with PostgreSQL's own message.
import {
  addColumn,
  addForeignKey,
  addIndex,
  addTable,
  addUniqueConstraint,
  type Column,
  type ReferentialAction,
  type SchemaSnapshot,
} from "@skematron/core";
import { renderIndexDefinition } from "@skematron/adapters";
import { UserFacingError } from "./errors.ts";
import { sqlDefault } from "./schema-input.ts";

export interface TableRef {
  namespace: string;
  table: string;
}

export type SchemaEdit =
  | {
      kind: "add-table";
      namespace: string;
      name: string;
      idColumn: string;
      idType: string;
      identity: boolean;
    }
  | {
      kind: "add-column";
      table: TableRef;
      name: string;
      type: string;
      required: boolean;
      default: string;
      unique: boolean;
    }
  | {
      kind: "add-index";
      table: TableRef;
      columns: string[];
      unique: boolean;
      name: string;
    }
  | {
      kind: "add-foreign-key";
      table: TableRef;
      columns: string[];
      references: TableRef;
      /** Empty: the referenced table's primary key. */
      referencedColumns: string[];
      onDelete: ReferentialAction;
      name: string;
    };

function newColumn(
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

/** Applies one edit with core's edit functions. Fragments are checked later, by PostgreSQL. */
export function applyEdit(
  snapshot: SchemaSnapshot,
  edit: SchemaEdit,
): SchemaSnapshot {
  switch (edit.kind) {
    case "add-table":
      return addTable(snapshot, edit.namespace, {
        name: edit.name,
        columns: [
          newColumn(edit.idColumn, edit.idType, {
            nullable: false,
            identity: edit.identity ? "by-default" : null,
          }),
        ],
        primaryKey: {
          name: `${edit.name}_pkey`,
          columns: [edit.idColumn],
          deferrable: "not-deferrable",
        },
        uniqueConstraints: [],
        checkConstraints: [],
        foreignKeys: [],
        indexes: [],
        comment: null,
      });
    case "add-column": {
      const { namespace, table } = edit.table;
      let next = addColumn(
        snapshot,
        namespace,
        table,
        newColumn(edit.name, edit.type, {
          nullable: !edit.required,
          default: sqlDefault(edit.default),
        }),
      );
      if (edit.unique) {
        next = addUniqueConstraint(next, namespace, table, {
          name: `${table}_${edit.name}_key`,
          columns: [edit.name],
          nullsNotDistinct: false,
          deferrable: "not-deferrable",
        });
      }
      return next;
    }
    case "add-index": {
      const { namespace, table } = edit.table;
      const name = edit.name || `${table}_${edit.columns.join("_")}_idx`;
      return addIndex(snapshot, namespace, table, {
        name,
        unique: edit.unique,
        definition: renderIndexDefinition({
          namespace,
          tableName: table,
          name,
          columns: edit.columns,
          unique: edit.unique,
        }),
      });
    }
    case "add-foreign-key": {
      const { namespace, table } = edit.table;
      let referencedColumns = edit.referencedColumns;
      if (referencedColumns.length === 0) {
        const referenced = snapshot.namespaces
          .find((candidate) => candidate.name === edit.references.namespace)
          ?.tables.find(
            (candidate) => candidate.name === edit.references.table,
          );
        referencedColumns = referenced?.primaryKey?.columns ?? [];
        if (referenced !== undefined && referencedColumns.length === 0) {
          throw new UserFacingError(
            `${edit.references.table} has no primary key; name the referenced columns.`,
          );
        }
      }
      return addForeignKey(snapshot, namespace, table, {
        name: edit.name || `${table}_${edit.columns.join("_")}_fkey`,
        columns: edit.columns,
        references: { ...edit.references, columns: referencedColumns },
        onUpdate: "no-action",
        onDelete: edit.onDelete,
        matchFull: false,
        deferrable: "not-deferrable",
      });
    }
  }
}
