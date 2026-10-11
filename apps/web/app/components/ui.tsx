import Link from "next/link";
import type { ReactNode } from "react";
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

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "10 Oct 2026, 11:49 UTC". Fixed format, so server rendering never depends on a locale. */
export function formatDate(date: Date | string): string {
  const value = typeof date === "string" ? new Date(date) : date;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getUTCDate()} ${MONTHS[value.getUTCMonth()]} ${value.getUTCFullYear()}, ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())} UTC`;
}

export function shortChecksum(checksum: string): string {
  return checksum.slice(0, "sha256:".length + 12);
}

const RISK_LABELS: Record<Risk, string> = {
  safe: "Safe",
  caution: "Caution",
  destructive: "Deletes data",
};

export function RiskBadge({ risk }: { risk: Risk }) {
  return <span className={`badge ${risk}`}>{RISK_LABELS[risk]}</span>;
}

export function ErrorPanel({
  title,
  error,
}: {
  title: string;
  error: unknown;
}) {
  return (
    <Callout tone="danger" title={title}>
      <p>{error instanceof Error ? error.message : String(error)}</p>
    </Callout>
  );
}

/** Shows ?notice= and ?error= messages set by server actions. */
export async function Flash({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const notice = param(query.notice);
  const error = param(query.error);
  return (
    <>
      {notice !== undefined && <Callout tone="success" title={notice} />}
      {error !== undefined && (
        <Callout tone="danger" title="That did not work">
          <p>{error}</p>
        </Callout>
      )}
    </>
  );
}

export function Breadcrumbs({
  items,
}: {
  items: { label: string; href?: string }[];
}) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumbs">
      {items.map((item, index) => (
        <span key={`${index}:${item.label}`} className="crumb">
          {index > 0 && (
            <span className="sep" aria-hidden>
              /
            </span>
          )}
          {item.href === undefined ? (
            item.label
          ) : (
            <Link href={item.href}>{item.label}</Link>
          )}
        </span>
      ))}
    </nav>
  );
}

/** Title, optional badge and subtitle on the left; the page's main actions on the right. */
export function PageHeader({
  title,
  badge,
  subtitle,
  actions,
}: {
  title: ReactNode;
  badge?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <div className="title">
          <h1>{title}</h1>
          {badge}
        </div>
        {subtitle !== undefined && <p className="subtitle">{subtitle}</p>}
      </div>
      {actions !== undefined && <div className="toolbar">{actions}</div>}
    </div>
  );
}

const CALLOUT_ICONS = {
  info: "→",
  success: "✓",
  warning: "!",
  danger: "✕",
} as const;

/** A highlighted message: what to do next, or what just happened. */
export function Callout({
  tone = "info",
  title,
  children,
  actions,
}: {
  tone?: keyof typeof CALLOUT_ICONS;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      className={`callout ${tone}`}
      role={tone === "danger" ? "alert" : undefined}
    >
      <span className="icon" aria-hidden>
        {CALLOUT_ICONS[tone]}
      </span>
      <div className="body">
        <h3>{title}</h3>
        {children}
        {actions !== undefined && <div className="toolbar">{actions}</div>}
      </div>
    </div>
  );
}

export type StepState = "done" | "current" | "failed" | "upcoming" | "later";

/** A horizontal progress indicator. */
export function Steps({
  steps,
}: {
  steps: { label: string; state: StepState }[];
}) {
  return (
    <ol className="steps">
      {steps.map((step, index) => (
        <li key={step.label} className={step.state}>
          <span className="dot">
            {step.state === "done"
              ? "✓"
              : step.state === "failed"
                ? "✕"
                : index + 1}
          </span>
          {step.label}
        </li>
      ))}
    </ol>
  );
}

/** What to show where a list is still empty: what it is for, and how to start. */
export function Empty({
  title,
  children,
  actions,
}: {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="card empty">
      <h3>{title}</h3>
      {children}
      {actions !== undefined && <div className="toolbar">{actions}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {detail !== undefined && <div className="detail">{detail}</div>}
    </div>
  );
}

/** "1 table", "3 tables". */
export function plural(
  count: number,
  singular: string,
  pluralForm = `${singular}s`,
) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
