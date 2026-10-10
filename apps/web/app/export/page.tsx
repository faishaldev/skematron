import Link from "next/link";
import { emptySnapshot, planMigration } from "@skematron/core";
import { renderPostgresMigration } from "@skematron/adapters";
import { readDatabase, type DatabaseRead } from "../../lib/server.ts";
import { ErrorPanel, param, schemaHref, type SearchParams } from "../ui.tsx";

export const dynamic = "force-dynamic";

export default async function ExportPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const name = param((await searchParams).ns);
  if (name === undefined) {
    return (
      <ErrorPanel
        title="No schema selected"
        error="Open a schema from the overview."
      />
    );
  }
  let database: DatabaseRead;
  try {
    database = await readDatabase([name]);
  } catch (error) {
    return <ErrorPanel title={`Cannot read schema ${name}`} error={error} />;
  }
  const { script, statements } = renderPostgresMigration(
    planMigration(emptySnapshot("postgresql"), database.snapshot),
  );

  return (
    <>
      <p>
        <Link href={schemaHref("/schema", name)}>← {name}</Link>
      </p>
      <h1>Export SQL: {name}</h1>
      <p className="muted">
        {statements.length} statements that recreate this schema from nothing.
        Nothing is executed.{" "}
        <a href={schemaHref("/export/sql", name)}>Download .sql</a>
      </p>
      {database.unsupported.length > 0 && (
        <div className="card error">
          Not included: {database.unsupported.length} object(s) Skematron does
          not capture (see the{" "}
          <Link href={schemaHref("/schema", name)}>schema page</Link>).
        </div>
      )}
      <pre>{script}</pre>
    </>
  );
}
