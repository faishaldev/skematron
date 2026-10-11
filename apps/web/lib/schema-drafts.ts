// Schema drafts: one person's working copy of a project's schema in the dashboard editor,
// for projects whose schema source is "dashboard". Each edit goes through @skematron/core's
// edit functions and is then normalized in the shadow database, so the draft always holds
// what PostgreSQL really creates (and invalid types or defaults are rejected right away).
// Saving records the draft as the next version and deletes it.
import {
  addColumn,
  addForeignKey,
  addIndex,
  addTable,
  addUniqueConstraint,
  emptySnapshot,
  isEmptyPlan,
  planMigration,
  serializeSnapshot,
  type Column,
  type ReferentialAction,
  type SchemaSnapshot,
} from "@skematron/core";
import {
  renderIndexDefinition,
  type UnsupportedObject,
} from "@skematron/adapters";
import type { Actor } from "./actor.ts";
import { db } from "./db.ts";
import { isUniqueViolation, UserFacingError } from "./errors.ts";
import { assertCan, schemaSourceOf, type Project } from "./projects.ts";
import { sqlDefault } from "./schema-input.ts";
import { normalizeSnapshot } from "./shadow.ts";
import {
  listVersions,
  loadSnapshot,
  recordVersion,
  unsupportedOf,
} from "./versions.ts";

export interface TableRef {
  namespace: string;
  table: string;
}

export type DraftEdit =
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

function requireDashboardSource(project: Project): void {
  if (schemaSourceOf(project) !== "dashboard") {
    throw new UserFacingError(
      "This project's schema is written in code: change it there, then import it. An admin can switch the project's schema source to the dashboard.",
    );
  }
}

function findDraft(actor: Actor, project: Project) {
  return db().schemaDraft.findUnique({
    where: {
      projectId_userId: { projectId: project.id, userId: actor.userId },
    },
    include: { baseVersion: true },
  });
}

export type SchemaDraft = NonNullable<Awaited<ReturnType<typeof findDraft>>>;

export function draftSnapshot(draft: SchemaDraft): SchemaSnapshot {
  return draft.snapshot as unknown as SchemaSnapshot;
}

function draftUnsupported(draft: SchemaDraft): UnsupportedObject[] {
  return Array.isArray(draft.unsupported)
    ? (draft.unsupported as unknown as UnsupportedObject[])
    : [];
}

/** The draft's base snapshot: its version's, or empty for a project without versions. */
export async function baseSnapshot(
  draft: SchemaDraft,
): Promise<SchemaSnapshot> {
  return draft.baseVersion === null
    ? emptySnapshot("postgresql")
    : loadSnapshot(draft.baseVersion);
}

/** The actor's draft for this project, or null. Drafts are private to their author. */
export async function getDraft(actor: Actor, project: Project) {
  assertCan(actor, "author-migrations");
  return findDraft(actor, project);
}

/** Starts a draft from the latest version (or from nothing), unless one exists. */
export async function startDraft(
  actor: Actor,
  project: Project,
): Promise<SchemaDraft> {
  assertCan(actor, "author-migrations");
  requireDashboardSource(project);
  const existing = await findDraft(actor, project);
  if (existing !== null) return existing;
  const latest = (await listVersions(actor, project))[0];
  const snapshot =
    latest === undefined
      ? emptySnapshot("postgresql")
      : await loadSnapshot(latest);
  try {
    await db().schemaDraft.create({
      data: {
        projectId: project.id,
        userId: actor.userId,
        baseVersionId: latest?.id ?? null,
        snapshot: JSON.parse(serializeSnapshot(snapshot)),
        unsupported: (latest === undefined ? [] : unsupportedOf(latest)).map(
          (object) => ({ ...object }),
        ),
      },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
  return (await findDraft(actor, project))!;
}

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

function applyEdit(snapshot: SchemaSnapshot, edit: DraftEdit): SchemaSnapshot {
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

/** Applies one edit, checks the result in the shadow database, and saves it to the draft. */
export async function editDraft(
  actor: Actor,
  project: Project,
  edit: DraftEdit,
): Promise<void> {
  assertCan(actor, "author-migrations");
  requireDashboardSource(project);
  const draft = await findDraft(actor, project);
  if (draft === null) throw new UserFacingError("Start editing first.");
  const edited = applyEdit(draftSnapshot(draft), edit);
  const normalized = await normalizeSnapshot(edited, draftUnsupported(draft));
  await db().schemaDraft.update({
    where: { id: draft.id },
    data: {
      snapshot: JSON.parse(serializeSnapshot(normalized.snapshot)),
      unsupported: normalized.unsupported.map((object) => ({ ...object })),
    },
  });
}

export async function discardDraft(
  actor: Actor,
  project: Project,
): Promise<void> {
  assertCan(actor, "author-migrations");
  await db().schemaDraft.deleteMany({
    where: { projectId: project.id, userId: actor.userId },
  });
}

/**
 * Records the draft as the project's next version and deletes the draft. Refused when
 * another version was saved since the draft started, so newer changes are never lost.
 */
export async function saveDraft(
  actor: Actor,
  project: Project,
): Promise<{ number: number; baseNumber: number | null }> {
  assertCan(actor, "author-migrations");
  requireDashboardSource(project);
  const draft = await findDraft(actor, project);
  if (draft === null) throw new UserFacingError("There is no draft to save.");
  const snapshot = draftSnapshot(draft);
  if (isEmptyPlan(planMigration(await baseSnapshot(draft), snapshot))) {
    throw new UserFacingError("The draft has no changes to save.");
  }
  const result = await recordVersion(actor, project, {
    snapshot,
    unsupported: draftUnsupported(draft),
    source: {
      kind: "dashboard",
      baseVersion:
        draft.baseVersion === null ? "none" : String(draft.baseVersion.number),
    },
    basedOn: { versionId: draft.baseVersionId },
  });
  await db().schemaDraft.delete({ where: { id: draft.id } });
  return {
    number: result.number,
    baseNumber: draft.baseVersion?.number ?? null,
  };
}
