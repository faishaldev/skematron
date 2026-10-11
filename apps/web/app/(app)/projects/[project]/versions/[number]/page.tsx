import Link from "next/link";
import { emptySnapshot, planMigration } from "@skematron/core";
import { renderPostgresMigration } from "@skematron/adapters";
import { db } from "../../../../../../lib/db.ts";
import { can } from "../../../../../../lib/roles.ts";
import { resolveVersion } from "../../../../../../lib/version-pages.ts";
import { loadSnapshot, unsupportedOf } from "../../../../../../lib/versions.ts";
import { SchemaView } from "../../../../../components/schema-view.tsx";
import {
  Breadcrumbs,
  Flash,
  formatDate,
  PageHeader,
  Stat,
  type SearchParams,
} from "../../../../../components/ui.tsx";

export const dynamic = "force-dynamic";

export default async function VersionPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string; number: string }>;
  searchParams: SearchParams;
}) {
  const { actor, project, version } = await resolveVersion(params);
  const snapshot = await loadSnapshot(version);
  const author = await db().user.findUnique({
    where: { id: version.createdById },
    select: { name: true },
  });
  const source = version.source as {
    kind?: string;
    environmentName?: string;
    serverVersion?: string;
    prismaVersion?: string;
    baseVersion?: string;
    branch?: string;
    via?: string;
  };
  const fromPrisma =
    source.kind === "prisma-schema" || source.via === "prisma-schema";
  const base = `/projects/${project.slug}`;
  const here = `${base}/versions/${version.number}`;
  const { script, statements } = renderPostgresMigration(
    planMigration(emptySnapshot("postgresql"), snapshot),
  );
  const origin =
    source.kind === "branch"
      ? `branch ${source.branch} (${source.via === "prisma-schema" ? `a schema.prisma, Prisma ${source.prismaVersion ?? "?"}` : source.via === "introspection" ? `the ${source.environmentName ?? "?"} database` : "the schema editor"}), merged into main`
      : fromPrisma
        ? `schema.prisma (Prisma ${source.prismaVersion ?? "?"})`
        : source.kind === "dashboard"
          ? `the schema editor (${source.baseVersion === "none" || source.baseVersion === undefined ? "a new schema" : `based on v${source.baseVersion}`})`
          : `the ${source.environmentName ?? "?"} database (PostgreSQL ${source.serverVersion ?? "?"})`;
  const tables = snapshot.namespaces.flatMap((namespace) => namespace.tables);
  const columnCount = tables.reduce(
    (total, table) => total + table.columns.length,
    0,
  );
  const enumCount = snapshot.namespaces.reduce(
    (total, namespace) => total + namespace.enums.length,
    0,
  );
  const previous = version.number - 1;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: base },
          { label: `v${version.number}` },
        ]}
      />
      <PageHeader
        title={`Version ${version.number}`}
        subtitle={`From ${origin}. Added by ${author?.name ?? "a former member"} on ${formatDate(version.createdAt)}.`}
        actions={
          previous >= 1 ? (
            <>
              <Link
                href={`${base}/compare?from=${previous}&to=${version.number}`}
                className="button"
              >
                What changed since v{previous}
              </Link>
              {source.kind === "branch" && (
                <Link
                  href={`${base}/branches/${source.branch}`}
                  className="button"
                >
                  Branch {source.branch}
                </Link>
              )}
            </>
          ) : undefined
        }
      />
      <Flash searchParams={searchParams} />
      <div className="stats">
        <Stat label="Tables" value={tables.length} />
        <Stat label="Columns" value={columnCount} />
        <Stat label="Enums" value={enumCount} />
      </div>
      <SchemaView snapshot={snapshot} unsupported={unsupportedOf(version)} />
      <details className="card">
        <summary>Downloads and technical details</summary>
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <a href={`${here}/export.sql`} className="button small">
            SQL that creates this version
          </a>
          <a href={`${here}/snapshot.json`} className="button small">
            Snapshot (JSON)
          </a>
          {fromPrisma && (
            <a href={`${here}/schema.prisma`} className="button small">
              Download schema.prisma
            </a>
          )}
        </div>
        <p className="hint">
          Checksum (identifies this exact version):{" "}
          <code>{version.checksum}</code>
        </p>
        <details>
          <summary>
            Show the SQL ({statements.length} statements that create this
            version from nothing)
          </summary>
          <pre style={{ marginTop: 8 }}>{script}</pre>
        </details>
      </details>
    </>
  );
}
