"use server";

import { field, runAction, withFlash } from "../../../../../lib/actions.ts";
import { UserFacingError } from "../../../../../lib/errors.ts";
import { getProject } from "../../../../../lib/projects.ts";
import {
  discardDraft,
  editDraft,
  saveDraft,
  startDraft,
  type DraftEdit,
  type TableRef,
} from "../../../../../lib/schema-drafts.ts";
import {
  columnNames,
  identifier,
  referentialAction,
  sqlType,
} from "../../../../../lib/schema-input.ts";
import { requirePermission } from "../../../../../lib/session.ts";

const projectPath = (slug: string) => `/projects/${encodeURIComponent(slug)}`;
const schemaPath = (slug: string) => `${projectPath(slug)}/schema`;

/** Table pickers send `["namespace","table"]`. */
function tableRef(formData: FormData, name: string): TableRef {
  try {
    const parsed: unknown = JSON.parse(field(formData, name));
    if (Array.isArray(parsed) && parsed.length === 2) {
      const [namespace, table] = parsed as unknown[];
      if (typeof namespace === "string" && typeof table === "string") {
        return { namespace, table };
      }
    }
  } catch {
    // Reported below.
  }
  throw new UserFacingError("Choose a table.");
}

const checked = (formData: FormData, name: string) =>
  field(formData, name) === "on";

function editFrom(formData: FormData): DraftEdit {
  switch (field(formData, "edit")) {
    case "add-table":
      return {
        kind: "add-table",
        namespace: identifier(field(formData, "namespace"), "The schema name"),
        name: identifier(field(formData, "name"), "The table name"),
        idColumn: identifier(field(formData, "idColumn"), "The ID column name"),
        idType: sqlType(field(formData, "idType")),
        identity: checked(formData, "identity"),
      };
    case "add-column":
      return {
        kind: "add-column",
        table: tableRef(formData, "table"),
        name: identifier(field(formData, "name"), "The column name"),
        type: sqlType(field(formData, "type")),
        required: checked(formData, "required"),
        default: field(formData, "default"),
        unique: checked(formData, "unique"),
      };
    case "add-index":
      return {
        kind: "add-index",
        table: tableRef(formData, "table"),
        columns: columnNames(field(formData, "columns"), "indexed columns"),
        unique: checked(formData, "unique"),
        name:
          field(formData, "name").trim() === ""
            ? ""
            : identifier(field(formData, "name"), "The index name"),
      };
    case "add-foreign-key":
      return {
        kind: "add-foreign-key",
        table: tableRef(formData, "table"),
        columns: columnNames(field(formData, "columns"), "columns"),
        references: tableRef(formData, "references"),
        referencedColumns: columnNames(
          field(formData, "referencedColumns"),
          "referenced columns",
          true,
        ),
        onDelete: referentialAction(field(formData, "onDelete")),
        name:
          field(formData, "name").trim() === ""
            ? ""
            : identifier(field(formData, "name"), "The foreign key name"),
      };
    default:
      throw new UserFacingError("Unknown change.");
  }
}

const NOTICES: Record<DraftEdit["kind"], string> = {
  "add-table": "Table added to your draft.",
  "add-column": "Column added to your draft.",
  "add-index": "Index added to your draft.",
  "add-foreign-key": "Foreign key added to your draft.",
};

export async function startDraftAction(formData: FormData): Promise<void> {
  const slug = field(formData, "project");
  await runAction(schemaPath(slug), async () => {
    const actor = await requirePermission("author-migrations");
    await startDraft(actor, await getProject(actor, slug));
    return schemaPath(slug);
  });
}

export async function editSchemaAction(formData: FormData): Promise<void> {
  const slug = field(formData, "project");
  await runAction(schemaPath(slug), async () => {
    const actor = await requirePermission("author-migrations");
    const project = await getProject(actor, slug);
    const edit = editFrom(formData);
    await editDraft(actor, project, edit);
    return withFlash(schemaPath(slug), "notice", NOTICES[edit.kind]);
  });
}

export async function saveDraftAction(formData: FormData): Promise<void> {
  const slug = field(formData, "project");
  await runAction(schemaPath(slug), async () => {
    const actor = await requirePermission("author-migrations");
    const { number, baseNumber } = await saveDraft(
      actor,
      await getProject(actor, slug),
    );
    return baseNumber === null
      ? withFlash(
          `${projectPath(slug)}/versions/${number}`,
          "notice",
          `Saved as version ${number}, the project's first.`,
        )
      : withFlash(
          `${projectPath(slug)}/migrations/new?from=${baseNumber}&to=${number}`,
          "notice",
          `Saved as version ${number}. Create the migration from v${baseNumber} to bring databases there.`,
        );
  });
}

export async function discardDraftAction(formData: FormData): Promise<void> {
  const slug = field(formData, "project");
  await runAction(schemaPath(slug), async () => {
    const actor = await requirePermission("author-migrations");
    await discardDraft(actor, await getProject(actor, slug));
    return withFlash(projectPath(slug), "notice", "Draft discarded.");
  });
}
