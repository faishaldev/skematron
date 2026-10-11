import type { MigrationStatus } from "../../lib/migrations.ts";

const BADGE: Record<MigrationStatus, { tone: string; label: string }> = {
  draft: { tone: "neutral", label: "Draft" },
  in_review: { tone: "caution", label: "In review" },
  approved: { tone: "safe", label: "Approved" },
  rejected: { tone: "destructive", label: "Rejected" },
};

export function StatusBadge({ status }: { status: MigrationStatus }) {
  const { tone, label } = BADGE[status];
  return <span className={`badge ${tone}`}>{label}</span>;
}
