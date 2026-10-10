import Link from "next/link";
import { emptySnapshot, planMigration } from "@skematron/core";
import { renderPostgresMigration } from "@skematron/adapters";
import { db } from "../../../../../../lib/db.ts";
import { resolveVersion } from "../../../../../../lib/version-pages.ts";
import { loadSnapshot, unsupportedOf } from "../../../../../../lib/versions.ts";
import { SchemaView } from "../../../../../components/schema-view.tsx";
import {
  Flash,
  formatDate,
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
  const { project, version } = await resolveVersion(params);
  const snapshot = await loadSnapshot(version);
  const author = await db().user.findUnique({
    where: { id: version.createdById },
    select: { name: true },
  });
  const source = version.source as {
    environmentName?: string;
    serverVersion?: string;
  };
  const base = `/projects/${project.slug}`;
  const here = `${base}/versions/${version.number}`;
  const { script, statements } = renderPostgresMigration(
    planMigration(emptySnapshot("postgresql"), snapshot),
  );

  return (
    <>
      <p>
        <Link href={base}>← {project.name}</Link>
      </p>
      <h1>
        {project.name} v{version.number}
      </h1>
      <p className="muted">
        Imported {formatDate(version.createdAt)} by{" "}
        {author?.name ?? "a former member"} from{" "}
        {source.environmentName ?? "an environment"} (PostgreSQL{" "}
        {source.serverVersion ?? "?"}). Checksum <code>{version.checksum}</code>
      </p>
      <Flash searchParams={searchParams} />
      <div className="actions card">
        <a href={`${here}/export.sql`}>Download .sql</a>
        <a href={`${here}/snapshot.json`}>Download snapshot (JSON)</a>
        {version.number > 1 && (
          <Link
            href={`${base}/compare?from=${version.number - 1}&to=${version.number}`}
          >
            Compare with v{version.number - 1}
          </Link>
        )}
      </div>
      <details className="card">
        <summary>
          Export SQL ({statements.length} statements, recreates this version
          from nothing)
        </summary>
        <pre>{script}</pre>
      </details>
      <SchemaView snapshot={snapshot} unsupported={unsupportedOf(version)} />
    </>
  );
}
