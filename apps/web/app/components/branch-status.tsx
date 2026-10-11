import type { BranchStatus } from "../../lib/branches.ts";
import type { MigrationStatus } from "../../lib/migrations.ts";

/** One badge for where a branch is: open, in review, approved, merged, closed. */
export function BranchBadge({
  status,
  review,
}: {
  status: BranchStatus;
  review: MigrationStatus;
}) {
  const [tone, label] =
    status === "merged"
      ? ["safe", "Merged"]
      : status === "closed"
        ? ["neutral", "Closed"]
        : review === "in_review"
          ? ["caution", "In review"]
          : review === "approved"
            ? ["safe", "Approved"]
            : review === "rejected"
              ? ["destructive", "Changes requested"]
              : ["info", "Open"];
  return <span className={`badge ${tone}`}>{label}</span>;
}
