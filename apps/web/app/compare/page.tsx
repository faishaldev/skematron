import Link from "next/link";
import {
  isEmptyPlan,
  planMigration,
  snapshotChecksum,
  type Risk,
  type SchemaSnapshot,
} from "@skematron/core";
import { renderPostgresMigration } from "@skematron/adapters";
import { readDatabase, snapshotStore } from "../../lib/server.ts";
import type { SnapshotRecord } from "../../lib/snapshots.ts";
import {
  ErrorPanel,
  formatSavedAt,
  param,
  RiskBadge,
  schemaHref,
  shortChecksum,
  type SearchParams,
} from "../ui.tsx";

export const dynamic = "force-dynamic";

export default async function ComparePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const query = await searchParams;
  const name = param(query.ns);
  const id = param(query.snapshot);
  if (name === undefined) {
    return (
      <ErrorPanel
        title="No schema selected"
        error="Open Compare from the overview."
      />
    );
  }
  const store = snapshotStore();

  if (id === undefined) {
    const records = (await store.list()).filter(
      (record) => record.namespace === name,
    );
    return (
      <>
        <p>
          <Link href="/">← Schemas</Link>
        </p>
        <h1>Compare {name} with a saved snapshot</h1>
        {records.length === 0 ? (
          <p className="muted">
            No snapshots of this schema yet. Save one from the overview.
          </p>
        ) : (
          <div className="card">
            <ul>
              {records.map((record) => (
                <li key={record.id}>
                  <Link
                    href={schemaHref("/compare", name, { snapshot: record.id })}
                  >
                    {formatSavedAt(record.savedAt)}
                  </Link>{" "}
                  <code>{shortChecksum(record.checksum)}</code>
                </li>
              ))}
            </ul>
          </div>
        )}
      </>
    );
  }

  let saved: { record: SnapshotRecord; snapshot: SchemaSnapshot };
  let live: SchemaSnapshot;
  try {
    saved = await store.load(id);
    if (saved.record.namespace !== name) {
      throw new Error(
        `Snapshot ${id} is of schema ${saved.record.namespace}, not ${name}.`,
      );
    }
    live = (await readDatabase([name])).snapshot;
  } catch (error) {
    return <ErrorPanel title="Cannot compare" error={error} />;
  }

  const plan = planMigration(saved.snapshot, live);
  const rendered = renderPostgresMigration(plan);
  const liveChecksum = await snapshotChecksum(live);
  const count = (risk: Risk) =>
    rendered.statements.filter((statement) => statement.risk === risk).length;

  return (
    <>
      <p>
        <Link href={schemaHref("/schema", name)}>← {name}</Link>
      </p>
      <h1>Changes in {name} since the snapshot</h1>
      <p className="muted">
        Snapshot {formatSavedAt(saved.record.savedAt)} (
        <code>{shortChecksum(saved.record.checksum)}</code>) → live schema (
        <code>{shortChecksum(liveChecksum)}</code>). This is the migration from
        the snapshot to the current schema, for review only; nothing is
        executed.
      </p>

      {isEmptyPlan(plan) ? (
        <div className="card notice">
          No changes: the live schema is equivalent to the snapshot
          {liveChecksum === saved.record.checksum
            ? " (identical checksum)."
            : " (checksums differ only in column order, which PostgreSQL cannot change)."}
        </div>
      ) : (
        <>
          <p>
            {rendered.statements.length} operations:{" "}
            <RiskBadge risk="destructive" /> {count("destructive")} ·{" "}
            <RiskBadge risk="caution" /> {count("caution")} ·{" "}
            <RiskBadge risk="safe" /> {count("safe")}
          </p>
          {plan.unsupported.length > 0 && (
            <div className="card error">
              <h3>Incomplete plan</h3>
              <p>
                These changes cannot be expressed as a migration and need manual
                work:
              </p>
              <ul>
                {plan.unsupported.map((change) => (
                  <li key={`${change.object}:${change.reason}`}>
                    <code>{change.object}</code>: {change.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th>Risk</th>
                  <th>Statement</th>
                </tr>
              </thead>
              <tbody>
                {rendered.statements.map((statement, index) => (
                  <tr key={index}>
                    <td>
                      <RiskBadge risk={statement.risk} />
                    </td>
                    <td>
                      <pre>{statement.sql}</pre>
                      {statement.warnings.length > 0 && (
                        <p className="muted">{statement.warnings.join(" ")}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2>Full script</h2>
          <pre>{rendered.script}</pre>
        </>
      )}
    </>
  );
}
