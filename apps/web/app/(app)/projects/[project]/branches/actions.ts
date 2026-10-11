"use server";

import {
  field,
  runAction,
  uploadedText,
  withFlash,
} from "../../../../../lib/actions.ts";
import {
  closeBranch,
  createBranch,
  editBranch,
  getBranch,
  mergeBranch,
  rebaseBranch,
  reviewBranch,
  submitBranch,
  testBranch,
  uploadPrismaToBranch,
  uploadSqlToBranch,
} from "../../../../../lib/branches.ts";
import { UserFacingError } from "../../../../../lib/errors.ts";
import { answersFromForm } from "../../../../../lib/migrations.ts";
import { MAX_PRISMA_SCHEMA_BYTES } from "../../../../../lib/prisma-import.ts";
import { getProject, schemaSourceOf } from "../../../../../lib/projects.ts";
import {
  describeSkipped,
  MAX_SQL_SCRIPT_BYTES,
} from "../../../../../lib/sql-import.ts";
import type { SchemaEdit, TableRef } from "../../../../../lib/schema-edits.ts";
import {
  columnNames,
  identifier,
  referentialAction,
  sqlType,
} from "../../../../../lib/schema-input.ts";
import { requirePermission } from "../../../../../lib/session.ts";

const projectPath = (slug: string) => `/projects/${encodeURIComponent(slug)}`;
const branchPath = (slug: string, name: string) =>
  `${projectPath(slug)}/branches/${encodeURIComponent(name)}`;

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

function editFrom(formData: FormData): SchemaEdit {
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

const NOTICES: Record<SchemaEdit["kind"], string> = {
  "add-table": "Table added to the branch.",
  "add-column": "Column added to the branch.",
  "add-index": "Index added to the branch.",
  "add-foreign-key": "Foreign key added to the branch.",
};

/** Loads the actor, project and branch named in the form. */
async function load(
  formData: FormData,
  permission: "author-migrations" | "review-migrations",
) {
  const actor = await requirePermission(permission);
  const project = await getProject(actor, field(formData, "project"));
  const branch = await getBranch(actor, project, field(formData, "branch"));
  return { actor, project, branch };
}

export async function createBranchAction(formData: FormData): Promise<void> {
  const slug = field(formData, "project");
  await runAction(`${projectPath(slug)}/branches/new`, async () => {
    const actor = await requirePermission("author-migrations");
    const project = await getProject(actor, slug);
    const branch = await createBranch(actor, project, {
      name: field(formData, "name"),
    });
    return schemaSourceOf(project) === "dashboard"
      ? withFlash(
          `${branchPath(slug, branch.name)}/edit`,
          "notice",
          `Branch ${branch.name} created. Make your changes here.`,
        )
      : withFlash(
          `${branchPath(slug, branch.name)}/upload`,
          "notice",
          `Branch ${branch.name} created. Upload your changes.`,
        );
  });
}

export async function editBranchAction(formData: FormData): Promise<void> {
  const slug = field(formData, "project");
  const name = field(formData, "branch");
  await runAction(`${branchPath(slug, name)}/edit`, async () => {
    const { actor, project, branch } = await load(
      formData,
      "author-migrations",
    );
    const edit = editFrom(formData);
    await editBranch(actor, project, branch, edit);
    return withFlash(
      `${branchPath(slug, name)}/edit`,
      "notice",
      NOTICES[edit.kind],
    );
  });
}

/** Replaces the branch's schema with an upload: SQL (whole schema or changes) or Prisma. */
export async function uploadSchemaAction(formData: FormData): Promise<void> {
  const slug = field(formData, "project");
  const name = field(formData, "branch");
  await runAction(`${branchPath(slug, name)}/upload`, async () => {
    const { actor, project, branch } = await load(
      formData,
      "author-migrations",
    );
    const format = field(formData, "format");
    let note: string;
    if (format === "sql-schema" || format === "sql-changes") {
      const { skipped } = await uploadSqlToBranch(
        actor,
        project,
        branch,
        await uploadedText(formData, MAX_SQL_SCRIPT_BYTES),
        format === "sql-schema" ? "schema" : "changes",
      );
      note = describeSkipped(skipped);
    } else if (format === "prisma") {
      const { removed } = await uploadPrismaToBranch(
        actor,
        project,
        branch,
        await uploadedText(formData, MAX_PRISMA_SCHEMA_BYTES),
      );
      note =
        removed.length === 0
          ? ""
          : ` Removed from the stored file: ${removed.join(", ")}.`;
    } else {
      throw new UserFacingError("Choose what you are uploading.");
    }
    return withFlash(
      branchPath(slug, name),
      "notice",
      `Schema uploaded to ${name}.${note} Run the test next.`,
    );
  });
}

/** Saves answers (if any) and test-runs the branch as it is now. */
export async function testBranchAction(formData: FormData): Promise<void> {
  const slug = field(formData, "project");
  const name = field(formData, "branch");
  await runAction(branchPath(slug, name), async () => {
    const { actor, project, branch } = await load(
      formData,
      "author-migrations",
    );
    const answers = answersFromForm(formData.entries());
    const revision = await testBranch(
      actor,
      project,
      branch,
      field(formData, "withAnswers") === "yes" ? answers : null,
    );
    return withFlash(
      branchPath(slug, name),
      "notice",
      revision.verification === "passed"
        ? "Test run passed."
        : `Test run ${revision.verification}.`,
    );
  });
}

export async function submitBranchAction(formData: FormData): Promise<void> {
  const slug = field(formData, "project");
  const name = field(formData, "branch");
  await runAction(branchPath(slug, name), async () => {
    const { actor, project, branch } = await load(
      formData,
      "author-migrations",
    );
    await submitBranch(actor, project, branch);
    return withFlash(
      branchPath(slug, name),
      "notice",
      "Submitted for review. An admin or owner who did not work on it approves it.",
    );
  });
}

export async function reviewBranchAction(formData: FormData): Promise<void> {
  const slug = field(formData, "project");
  const name = field(formData, "branch");
  await runAction(branchPath(slug, name), async () => {
    const { actor, project, branch } = await load(
      formData,
      "review-migrations",
    );
    const verdict = field(formData, "verdict");
    if (verdict !== "approved" && verdict !== "rejected") {
      throw new UserFacingError("Choose approve or reject.");
    }
    await reviewBranch(actor, project, branch, {
      verdict,
      revisionId: field(formData, "revision"),
      comment: field(formData, "comment"),
      acknowledgeDestructive:
        field(formData, "acknowledgeDestructive") === "on",
    });
    return withFlash(
      branchPath(slug, name),
      "notice",
      verdict === "approved"
        ? "Approved. It can be merged into main now."
        : "Changes requested.",
    );
  });
}

export async function mergeBranchAction(formData: FormData): Promise<void> {
  const slug = field(formData, "project");
  const name = field(formData, "branch");
  await runAction(branchPath(slug, name), async () => {
    const { actor, project, branch } = await load(
      formData,
      "author-migrations",
    );
    const { number } = await mergeBranch(actor, project, branch);
    return withFlash(
      branchPath(slug, name),
      "notice",
      `Merged: main is at v${number} now.`,
    );
  });
}

export async function rebaseBranchAction(formData: FormData): Promise<void> {
  const slug = field(formData, "project");
  const name = field(formData, "branch");
  await runAction(branchPath(slug, name), async () => {
    const { actor, project, branch } = await load(
      formData,
      "author-migrations",
    );
    const { number } = await rebaseBranch(actor, project, branch);
    return withFlash(
      branchPath(slug, name),
      "notice",
      `The branch now starts from v${number}. Check the changes, then test again.`,
    );
  });
}

export async function closeBranchAction(formData: FormData): Promise<void> {
  const slug = field(formData, "project");
  const name = field(formData, "branch");
  await runAction(branchPath(slug, name), async () => {
    const { actor, project, branch } = await load(
      formData,
      "author-migrations",
    );
    await closeBranch(actor, project, branch);
    return withFlash(
      projectPath(slug),
      "notice",
      `Branch ${name} closed. Nothing was added to main.`,
    );
  });
}
