import Link from "next/link";
import { branchStatusOf, type listBranches } from "../../lib/branches.ts";
import { statusOf } from "../../lib/migrations.ts";
import type { Environment } from "../../lib/projects.ts";
import { unsupportedOf, type SchemaVersion } from "../../lib/versions.ts";
import { importVersionAction } from "../(app)/projects/[project]/actions.ts";
import { BranchBadge } from "./branch-status.tsx";
import { formatDate, plural } from "./ui.tsx";

export type BranchRow = Awaited<ReturnType<typeof listBranches>>[number];

export const reviewOf = (branch: BranchRow) =>
  branch.migration === null ? "draft" : statusOf(branch.migration);

export function BranchTable({
  branches,
  base,
}: {
  branches: BranchRow[];
  base: string;
}) {
  return (
    <table>
      <thead>
        <tr>
          <th>Branch</th>
          <th>From</th>
          <th>Status</th>
          <th>Last change</th>
        </tr>
      </thead>
      <tbody>
        {branches.map((branch) => (
          <tr key={branch.id}>
            <td>
              <Link href={`${base}/branches/${branch.name}`}>
                <strong>{branch.name}</strong>
              </Link>
            </td>
            <td>
              {branch.baseVersion === null
                ? "empty"
                : `v${branch.baseVersion.number}`}
              {branch.mergedVersion !== null &&
                ` → v${branch.mergedVersion.number}`}
            </td>
            <td>
              <BranchBadge
                status={branchStatusOf(branch)}
                review={reviewOf(branch)}
              />
            </td>
            <td className="muted">{formatDate(branch.updatedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function VersionTable({
  versions,
  base,
}: {
  versions: SchemaVersion[];
  base: string;
}) {
  return (
    <table>
      <thead>
        <tr>
          <th>Version</th>
          <th>Added</th>
          <th>From</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {versions.map((version) => {
          const origin = version.source as {
            kind?: string;
            environmentName?: string;
            branch?: string;
          };
          const untracked = unsupportedOf(version).length;
          return (
            <tr key={version.id}>
              <td>
                <Link href={`${base}/versions/${version.number}`}>
                  <strong>v{version.number}</strong>
                </Link>
              </td>
              <td className="muted">{formatDate(version.createdAt)}</td>
              <td>
                {origin.kind === "branch" ? (
                  <Link href={`${base}/branches/${origin.branch}`}>
                    Branch {origin.branch}
                  </Link>
                ) : origin.kind === "prisma-schema" ? (
                  "schema.prisma (baseline)"
                ) : origin.kind === "dashboard" ? (
                  "Schema editor"
                ) : (
                  `Database ${origin.environmentName ?? ""} (baseline)`
                )}
              </td>
              <td>
                {untracked > 0 && (
                  <span className="badge caution">
                    {plural(untracked, "object")} not tracked
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function EnvironmentTable({
  environments,
  base,
  projectSlug,
  canUseDatabases,
  latestNumber,
}: {
  environments: Environment[];
  base: string;
  projectSlug: string;
  canUseDatabases: boolean;
  latestNumber: number | null;
}) {
  return (
    <table>
      <thead>
        <tr>
          <th>Environment</th>
          <th>Connection</th>
          <th>Schemas</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {environments.map((environment) => (
          <tr key={environment.id}>
            <td>
              <Link href={`${base}/environments/${environment.name}`}>
                <strong>{environment.name}</strong>
              </Link>
            </td>
            <td>
              <code>{environment.connectionHint}</code>
            </td>
            <td>{environment.namespaces.join(", ")}</td>
            <td>
              {canUseDatabases && (
                <div className="actions">
                  <form action={importVersionAction}>
                    <input type="hidden" name="project" value={projectSlug} />
                    <input
                      type="hidden"
                      name="environment"
                      value={environment.name}
                    />
                    <button type="submit" className="small">
                      Import schema
                    </button>
                  </form>
                  {latestNumber !== null && (
                    <Link
                      href={`${base}/compare?from=${latestNumber}&environment=${environment.name}`}
                      className="button small"
                    >
                      Check drift
                    </Link>
                  )}
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
