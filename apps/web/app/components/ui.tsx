import type { Risk } from "@skematron/core";

export type SearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

/** The first value of a query parameter, or undefined. */
export function param(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function formatDate(date: Date | string): string {
  const iso = typeof date === "string" ? date : date.toISOString();
  return iso.replace("T", " ").replace(/\.\d+Z$|Z$/, " UTC");
}

export function shortChecksum(checksum: string): string {
  return checksum.slice(0, "sha256:".length + 12);
}

export function RiskBadge({ risk }: { risk: Risk }) {
  return <span className={`badge ${risk}`}>{risk}</span>;
}

export function ErrorPanel({
  title,
  error,
}: {
  title: string;
  error: unknown;
}) {
  return (
    <div className="card error">
      <h3>{title}</h3>
      <p>{error instanceof Error ? error.message : String(error)}</p>
    </div>
  );
}

/** Shows ?notice= and ?error= messages set by server actions. */
export async function Flash({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const notice = param(query.notice);
  const error = param(query.error);
  return (
    <>
      {notice !== undefined && <div className="card notice">{notice}</div>}
      {error !== undefined && <div className="card error">{error}</div>}
    </>
  );
}
