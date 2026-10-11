import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
  baseOf,
  branchStatusOf,
  getBranch,
  headOf,
  headUnsupportedOf,
} from "../../../../../../../lib/branches.ts";
import { NotFoundError } from "../../../../../../../lib/errors.ts";
import { planMigration } from "@skematron/core";
import {
  getProject,
  schemaSourceOf,
} from "../../../../../../../lib/projects.ts";
import { can } from "../../../../../../../lib/roles.ts";
import { requireActor } from "../../../../../../../lib/session.ts";
import {
  diagramHighlights,
  SchemaDiagram,
} from "../../../../../../components/diagram.tsx";
import { PlanView } from "../../../../../../components/plan-view.tsx";
import { SchemaView } from "../../../../../../components/schema-view.tsx";
import {
  Breadcrumbs,
  ErrorPanel,
  Flash,
  PageHeader,
  plural,
  type SearchParams,
} from "../../../../../../components/ui.tsx";
import { editBranchAction } from "../../actions.ts";

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

function Hidden({
  project,
  branch,
  edit,
}: {
  project: string;
  branch: string;
  edit: string;
}) {
  return (
    <>
      <input type="hidden" name="project" value={project} />
      <input type="hidden" name="branch" value={branch} />
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

export default async function EditBranchPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string; name: string }>;
  searchParams: SearchParams;
}) {
  const actor = await requireActor();
  const { project: slug, name } = await params;
  let loaded;
  try {
    const project = await getProject(actor, slug);
    loaded = { project, branch: await getBranch(actor, project, name) };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { project, branch } = loaded;
  const base = `/projects/${project.slug}`;
  const here = `${base}/branches/${branch.name}`;
  const crumbs = (
    <Breadcrumbs
      items={[
        { label: "Projects", href: "/projects" },
        { label: project.name, href: base },
        { label: "Branches", href: `${base}/branches` },
        { label: branch.name, href: here },
        { label: "Edit" },
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
          error="Upload your changes to the branch instead. An admin can switch the project to the schema editor in its settings."
        />
      </>
    );
  }
  if (branchStatusOf(branch) !== "open") {
    return (
      <>
        {crumbs}
        <ErrorPanel
          title={`This branch is ${branchStatusOf(branch)}`}
          error="It can no longer change. Start a new branch for further changes."
        />
      </>
    );
  }

  const snapshot = headOf(branch);
  const baseSnapshot = (await baseOf(branch)).snapshot;
  const plan = planMigration(baseSnapshot, snapshot);
  const baseLabel =
    branch.baseVersion === null
      ? "an empty schema"
      : `v${branch.baseVersion.number}`;
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

  return (
    <>
      {crumbs}
      <PageHeader
        title={`Edit ${branch.name}`}
        badge={
          <span className="badge info">
            {changeCount === 0
              ? "No changes yet"
              : plural(changeCount, "change")}
          </span>
        }
        subtitle={`Changes compared with ${baseLabel} on main. Everyone on the team can edit this branch; PostgreSQL checks every change in a temporary database, and nothing touches your databases.`}
        actions={
          <Link href={here} className="button primary">
            Done: test and review
          </Link>
        }
      />
      <Flash searchParams={searchParams} />

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
          <h2 style={{ marginTop: 8 }}>Changes in this branch</h2>
          <PlanView
            plan={plan}
            emptyMessage={`No changes yet: the branch is the same as ${baseLabel}. Use the panel on the right to add something.`}
          />
          <h2>Diagram</h2>
          <SchemaDiagram
            snapshot={snapshot}
            highlights={diagramHighlights(plan)}
          />
          <details className="card">
            <summary>Tables in detail</summary>
            <SchemaView
              snapshot={snapshot}
              unsupported={headUnsupportedOf(branch)}
            />
          </details>
        </div>

        <aside className="accordion">
          <Panel title="Add a table" open={tables.length === 0}>
            <form action={editBranchAction} className="stack">
              <Hidden
                project={project.slug}
                branch={branch.name}
                edit="add-table"
              />
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
              <form action={editBranchAction} className="stack">
                <Hidden
                  project={project.slug}
                  branch={branch.name}
                  edit="add-column"
                />
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
              <form action={editBranchAction} className="stack">
                <Hidden
                  project={project.slug}
                  branch={branch.name}
                  edit="add-foreign-key"
                />
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
              <form action={editBranchAction} className="stack">
                <Hidden
                  project={project.slug}
                  branch={branch.name}
                  edit="add-index"
                />
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
            Removing or renaming things in the editor is not supported yet.
          </p>
        </aside>
      </div>
    </>
  );
}
