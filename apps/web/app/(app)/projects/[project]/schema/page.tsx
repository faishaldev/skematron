import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { planMigration, type SchemaSnapshot } from "@skematron/core";
import type { UnsupportedObject } from "@skematron/adapters";
import { NotFoundError } from "../../../../../lib/errors.ts";
import { getProject, schemaSourceOf } from "../../../../../lib/projects.ts";
import { can } from "../../../../../lib/roles.ts";
import {
  baseSnapshot,
  draftSnapshot,
  getDraft,
} from "../../../../../lib/schema-drafts.ts";
import { requireActor } from "../../../../../lib/session.ts";
import { listVersions } from "../../../../../lib/versions.ts";
import { PlanView } from "../../../../components/plan-view.tsx";
import { SchemaView } from "../../../../components/schema-view.tsx";
import {
  Breadcrumbs,
  Callout,
  ErrorPanel,
  Flash,
  PageHeader,
  plural,
  type SearchParams,
} from "../../../../components/ui.tsx";
import {
  discardDraftAction,
  editSchemaAction,
  saveDraftAction,
  startDraftAction,
} from "./actions.ts";

export const dynamic = "force-dynamic";

const COMMON_TYPES = [
  "text",
  "varchar(255)",
  "integer",
  "bigint",
  "boolean",
  "numeric(10,2)",
  "date",
  "timestamp with time zone",
  "uuid",
  "jsonb",
];

function TablePicker({
  name,
  tables,
}: {
  name: string;
  tables: { value: string; label: string }[];
}) {
  return (
    <select name={name} required>
      {tables.map((table) => (
        <option key={table.value} value={table.value}>
          {table.label}
        </option>
      ))}
    </select>
  );
}

function Hidden({ project, edit }: { project: string; edit: string }) {
  return (
    <>
      <input type="hidden" name="project" value={project} />
      <input type="hidden" name="edit" value={edit} />
    </>
  );
}

/** One "Add …" form in the side panel; only one is open at a time. */
function Panel({
  title,
  open,
  children,
}: {
  title: string;
  open: boolean;
  children: ReactNode;
}) {
  return (
    <details name="add" open={open}>
      <summary>{title}</summary>
      {children}
    </details>
  );
}

export default async function SchemaEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: SearchParams;
}) {
  const actor = await requireActor();
  const { project: slug } = await params;
  const project = await getProject(actor, slug).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const base = `/projects/${project.slug}`;
  const crumbs = (
    <Breadcrumbs
      items={[
        { label: "Projects", href: "/projects" },
        { label: project.name, href: base },
        { label: "Edit schema" },
      ]}
    />
  );
  if (!can(actor.role, "author-migrations")) {
    return (
      <>
        {crumbs}
        <ErrorPanel title="Not allowed" error="Viewers cannot edit schemas." />
      </>
    );
  }
  if (schemaSourceOf(project) !== "dashboard") {
    return (
      <>
        {crumbs}
        <ErrorPanel
          title="This schema is written in code"
          error="Change it in your code or database, then import a version. An admin can switch the project's schema source to the dashboard on the project page."
        />
      </>
    );
  }
  const [draft, versions] = await Promise.all([
    getDraft(actor, project),
    listVersions(actor, project),
  ]);
  const latest = versions[0];

  if (draft === null) {
    return (
      <>
        {crumbs}
        <PageHeader
          title="Edit schema"
          subtitle="Add tables, columns, indexes and links between tables. Nothing touches your databases."
        />
        <Flash searchParams={searchParams} />
        <Callout
          title={
            latest === undefined
              ? "Start your schema"
              : `Start editing from v${latest.number}`
          }
          actions={
            <form action={startDraftAction}>
              <input type="hidden" name="project" value={project.slug} />
              <button type="submit" className="primary">
                Start editing
              </button>
            </form>
          }
        >
          <ol style={{ margin: "4px 0 0", paddingLeft: 20 }}>
            <li>Your changes go into a private draft that only you see.</li>
            <li>
              PostgreSQL checks every change in a temporary database, so
              mistakes show up right away.
            </li>
            <li>
              When you are done, save the draft as v{(latest?.number ?? 0) + 1},
              then create the migration that brings your databases there.
            </li>
          </ol>
        </Callout>
      </>
    );
  }

  const snapshot: SchemaSnapshot = draftSnapshot(draft);
  const plan = planMigration(await baseSnapshot(draft), snapshot);
  const stale = (latest?.id ?? null) !== draft.baseVersionId;
  const baseLabel =
    draft.baseVersion === null
      ? "an empty schema"
      : `v${draft.baseVersion.number}`;
  const tables = snapshot.namespaces.flatMap((namespace) =>
    namespace.tables.map((table) => ({
      value: JSON.stringify([namespace.name, table.name]),
      label:
        snapshot.namespaces.length > 1
          ? `${namespace.name}.${table.name}`
          : table.name,
    })),
  );
  const namespaces = snapshot.namespaces.map((namespace) => namespace.name);
  const enumTypes = snapshot.namespaces.flatMap((namespace) =>
    namespace.enums.map((enumType) => `${namespace.name}.${enumType.name}`),
  );
  const changeCount = plan.operations.length;
  const nextVersion = (latest?.number ?? 0) + 1;

  return (
    <>
      {crumbs}
      <PageHeader
        title="Edit schema"
        badge={
          <span className="badge info">
            {changeCount === 0
              ? "No changes yet"
              : `${plural(changeCount, "unsaved change")}`}
          </span>
        }
        subtitle={`Your private draft, based on ${baseLabel}. PostgreSQL checks every change in a temporary database; nothing touches your databases.`}
        actions={
          <>
            <form action={discardDraftAction}>
              <input type="hidden" name="project" value={project.slug} />
              <button type="submit" className="danger">
                Discard draft
              </button>
            </form>
            <form action={saveDraftAction}>
              <input type="hidden" name="project" value={project.slug} />
              <button
                type="submit"
                className="primary"
                disabled={stale || changeCount === 0}
              >
                Save as v{nextVersion}
              </button>
            </form>
          </>
        }
      />
      <Flash searchParams={searchParams} />
      {stale && (
        <Callout tone="danger" title="Someone saved a newer version">
          <p>
            v{latest?.number} was saved after this draft started from{" "}
            {baseLabel}, so this draft cannot be saved anymore. Discard it and
            start again from v{latest?.number}.
          </p>
        </Callout>
      )}

      <datalist id="column-types">
        {[...COMMON_TYPES, ...enumTypes].map((type) => (
          <option key={type} value={type} />
        ))}
      </datalist>
      <datalist id="namespaces">
        {namespaces.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <div className="split">
        <div>
          <h2 style={{ marginTop: 8 }}>Your changes</h2>
          <PlanView
            plan={plan}
            emptyMessage={`No changes yet: the draft is the same as ${baseLabel}. Use the panel on the right to add something.`}
          />
          <h2>Schema in this draft</h2>
          <SchemaView
            snapshot={snapshot}
            unsupported={
              (Array.isArray(draft.unsupported)
                ? draft.unsupported
                : []) as unknown as UnsupportedObject[]
            }
          />
        </div>

        <aside className="accordion">
          <Panel title="Add a table" open={tables.length === 0}>
            <form action={editSchemaAction} className="stack">
              <Hidden project={project.slug} edit="add-table" />
              <label>
                Table name
                <input
                  name="name"
                  required
                  maxLength={63}
                  placeholder="e.g. customers"
                />
              </label>
              <div className="row">
                <label>
                  ID column
                  <input name="idColumn" required defaultValue="id" />
                </label>
                <label>
                  ID type
                  <input
                    name="idType"
                    required
                    defaultValue="bigint"
                    list="column-types"
                  />
                </label>
              </div>
              <label className="choice">
                <input type="checkbox" name="identity" defaultChecked />
                Number new rows automatically
              </label>
              <label>
                Schema
                <input
                  name="namespace"
                  list="namespaces"
                  required
                  defaultValue={namespaces[0] ?? "public"}
                />
                <span className="hint">
                  The PostgreSQL schema (namespace). Usually public.
                </span>
              </label>
              <button type="submit" className="primary">
                Add table
              </button>
            </form>
          </Panel>

          {tables.length > 0 && (
            <Panel title="Add a column" open>
              <form action={editSchemaAction} className="stack">
                <Hidden project={project.slug} edit="add-column" />
                <label>
                  Table
                  <TablePicker name="table" tables={tables} />
                </label>
                <label>
                  Column name
                  <input
                    name="name"
                    required
                    maxLength={63}
                    placeholder="e.g. email"
                  />
                </label>
                <label>
                  Type
                  <input
                    name="type"
                    required
                    list="column-types"
                    placeholder="e.g. text, integer, boolean"
                  />
                </label>
                <label>
                  Default value <span className="hint">(optional)</span>
                  <input name="default" placeholder="e.g. 0, 'draft', now()" />
                  <span className="hint">
                    A SQL expression: quote text values, like &apos;draft&apos;.
                  </span>
                </label>
                <label className="choice">
                  <input type="checkbox" name="required" />
                  Required (every row must have a value)
                </label>
                <label className="choice">
                  <input type="checkbox" name="unique" />
                  Unique (no two rows may share a value)
                </label>
                <button type="submit" className="primary">
                  Add column
                </button>
              </form>
            </Panel>
          )}

          {tables.length > 0 && (
            <Panel title="Link two tables (foreign key)" open={false}>
              <form action={editSchemaAction} className="stack">
                <Hidden project={project.slug} edit="add-foreign-key" />
                <label>
                  Table
                  <TablePicker name="table" tables={tables} />
                </label>
                <label>
                  Column(s)
                  <input
                    name="columns"
                    required
                    placeholder="e.g. customer_id"
                  />
                </label>
                <label>
                  Points to table
                  <TablePicker name="references" tables={tables} />
                </label>
                <label>
                  Points to column(s) <span className="hint">(optional)</span>
                  <input
                    name="referencedColumns"
                    placeholder="Default: its ID (primary key)"
                  />
                </label>
                <label>
                  When the row it points to is deleted
                  <select name="onDelete" defaultValue="no-action">
                    <option value="no-action">Refuse the delete</option>
                    <option value="cascade">Delete this row too</option>
                    <option value="set-null">Clear the link (set null)</option>
                    <option value="restrict">
                      Refuse the delete (immediately)
                    </option>
                  </select>
                </label>
                <label>
                  Name <span className="hint">(optional)</span>
                  <input name="name" maxLength={63} />
                </label>
                <button type="submit" className="primary">
                  Add foreign key
                </button>
              </form>
            </Panel>
          )}

          {tables.length > 0 && (
            <Panel title="Speed up lookups (index)" open={false}>
              <form action={editSchemaAction} className="stack">
                <Hidden project={project.slug} edit="add-index" />
                <label>
                  Table
                  <TablePicker name="table" tables={tables} />
                </label>
                <label>
                  Column(s)
                  <input
                    name="columns"
                    required
                    placeholder="e.g. email, created_at"
                  />
                </label>
                <label className="choice">
                  <input type="checkbox" name="unique" />
                  Unique
                </label>
                <label>
                  Name <span className="hint">(optional)</span>
                  <input name="name" maxLength={63} />
                </label>
                <button type="submit" className="primary">
                  Add index
                </button>
              </form>
            </Panel>
          )}
          <p className="hint">
            Removing or renaming things in the editor is not supported yet.{" "}
            <Link href={base}>Back to {project.name}</Link>
          </p>
        </aside>
      </div>
    </>
  );
}
