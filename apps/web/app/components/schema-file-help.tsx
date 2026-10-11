// Where to get a schema file from common tools, folded away next to every schema upload.
// The commands are the ones the SQL import is tested against
// (packages/adapters/src/postgres/fixtures/scripts) or plain variants of them.

interface Source {
  tool: string;
  /** A command or file name, shown as code. */
  use: string | null;
  note?: string;
}

const WHOLE: Source[] = [
  {
    tool: "Any ORM or migration tool",
    use: "pg_dump --schema-only <database>",
    note: "after running your migrations on an empty database",
  },
  { tool: "Drizzle", use: "npx drizzle-kit export" },
  { tool: "Alembic (SQLAlchemy)", use: "alembic upgrade head --sql" },
  {
    tool: "Rails",
    use: "db/structure.sql",
    note: "with config.active_record.schema_format = :sql",
  },
  { tool: "Prisma", use: null, note: "Upload the schema.prisma itself." },
];

const CHANGES: Source[] = [
  { tool: "Django", use: "python manage.py sqlmigrate <app> <migration>" },
  { tool: "Alembic (SQLAlchemy)", use: "alembic upgrade <from>:<to> --sql" },
  { tool: "Prisma", use: "prisma/migrations/<name>/migration.sql" },
  {
    tool: "Drizzle",
    use: null,
    note: "The .sql files drizzle-kit generate writes.",
  },
];

function Group({ title, sources }: { title: string; sources: Source[] }) {
  return (
    <>
      <tr>
        <th colSpan={2}>{title}</th>
      </tr>
      {sources.map((source) => (
        <tr key={source.tool}>
          <td>{source.tool}</td>
          <td>
            {source.use !== null && <code>{source.use}</code>}
            {source.note !== undefined && (
              <span className="hint">
                {source.use !== null && " "}
                {source.note}
              </span>
            )}
          </td>
        </tr>
      ))}
    </>
  );
}

export function SchemaFileHelp({ changes }: { changes: boolean }) {
  return (
    <details className="card tool-help">
      <summary>How do I get SQL from my ORM or migration tool?</summary>
      <p className="hint">
        Skematron reads PostgreSQL SQL, which every tool can produce. It runs
        the SQL in a temporary database and reads back what it built. Owners,
        privileges and the rows of a tool&apos;s migration history are skipped.
      </p>
      <table>
        <tbody>
          <Group title="The whole schema" sources={WHOLE} />
          {changes && (
            <Group title="Only changes (migrations)" sources={CHANGES} />
          )}
        </tbody>
      </table>
    </details>
  );
}
