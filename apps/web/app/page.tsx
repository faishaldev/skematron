import Link from "next/link";
import {
  readDatabase,
  snapshotStore,
  type DatabaseRead,
} from "../lib/server.ts";
import { saveSnapshot } from "./actions.ts";
import {
  ErrorPanel,
  formatSavedAt,
  param,
  schemaHref,
  shortChecksum,
  type SearchParams,
} from "./ui.tsx";

export const dynamic = "force-dynamic";

export default async function Overview({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const saved = param((await searchParams).saved);
  let database: DatabaseRead;
  try {
    database = await readDatabase();
  } catch (error) {
    return (
      <>
        <h1>Schemas</h1>
        <ErrorPanel title="Database unavailable" error={error} />
      </>
    );
  }
  const snapshots = await snapshotStore().list();
  const { snapshot, unsupported, serverVersion, source } = database;

  return (
    <>
      <h1>Schemas</h1>
      <p className="muted">
        PostgreSQL {serverVersion} · {source} · read-only
      </p>
      {saved !== undefined && (
        <div className="card notice">
          Saved snapshot <code>{saved}</code>. Change the schema, then use
          Compare to see the migration.
        </div>
      )}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Schema</th>
              <th>Tables</th>
              <th>Enums</th>
              <th>Sequences</th>
              <th>Not captured</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {snapshot.namespaces.map((namespace) => {
              const savedCount = snapshots.filter(
                (record) => record.namespace === namespace.name,
              ).length;
              return (
                <tr key={namespace.name}>
                  <td>
                    <Link href={schemaHref("/schema", namespace.name)}>
                      <strong>{namespace.name}</strong>
                    </Link>
                  </td>
                  <td>{namespace.tables.length}</td>
                  <td>{namespace.enums.length}</td>
                  <td>{namespace.sequences.length}</td>
                  <td>
                    {
                      unsupported.filter(
                        (object) => object.namespace === namespace.name,
                      ).length
                    }
                  </td>
                  <td>
                    <div className="actions">
                      <Link href={schemaHref("/export", namespace.name)}>
                        Export SQL
                      </Link>
                      <form action={saveSnapshot}>
                        <input
                          type="hidden"
                          name="namespace"
                          value={namespace.name}
                        />
                        <button type="submit">Save snapshot</button>
                      </form>
                      {savedCount > 0 && (
                        <Link href={schemaHref("/compare", namespace.name)}>
                          Compare ({savedCount})
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {snapshot.namespaces.every(
        (namespace) => namespace.tables.length === 0,
      ) && (
        <p className="muted">
          No tables yet. To load a sample schema into the test database, run{" "}
          <code>pnpm db:test:seed</code> and reload.
        </p>
      )}

      <h2>Saved snapshots</h2>
      {snapshots.length === 0 ? (
        <p className="muted">
          None yet. Use “Save snapshot” on a schema; snapshots are stored as
          checksummed files in <code>.local/snapshots</code>.
        </p>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Schema</th>
                <th>Saved</th>
                <th>Checksum</th>
                <th>Source</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((record) => (
                <tr key={record.id}>
                  <td>{record.namespace}</td>
                  <td>{formatSavedAt(record.savedAt)}</td>
                  <td>
                    <code>{shortChecksum(record.checksum)}</code>
                  </td>
                  <td>{record.source}</td>
                  <td>
                    <Link
                      href={schemaHref("/compare", record.namespace, {
                        snapshot: record.id,
                      })}
                    >
                      Compare with live
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
