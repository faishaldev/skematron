/**
 * The adapter's only requirement on a database driver. `pg.Client` satisfies it.
 *
 * It must be one dedicated, idle connection (a client, or a client checked out
 * of a pool, never the pool itself): introspection runs several statements
 * inside one transaction.
 */
export interface PostgresSession {
  query(text: string): Promise<{ rows: unknown[] }>;
}
