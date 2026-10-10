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

/** A link to a page about one schema; names travel in the query string, URL-encoded. */
export function schemaHref(
  path: string,
  namespace: string,
  extra: Record<string, string> = {},
): string {
  return `${path}?${new URLSearchParams({ ns: namespace, ...extra }).toString()}`;
}

export function formatSavedAt(iso: string): string {
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
