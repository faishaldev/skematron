import Link from "next/link";
import { notFound } from "next/navigation";
import { planMigration, type SchemaSnapshot } from "@skematron/core";
import { NotFoundError } from "../../../../../lib/errors.ts";
import { getEnvironment, getProject } from "../../../../../lib/projects.ts";
import { can } from "../../../../../lib/roles.ts";
import { requireActor } from "../../../../../lib/session.ts";
import { readLive } from "../../../../../lib/targets.ts";
import { getVersion, loadSnapshot } from "../../../../../lib/versions.ts";
import { PlanView } from "../../../../components/plan-view.tsx";
import {
  ErrorPanel,
  param,
  type SearchParams,
} from "../../../../components/ui.tsx";

export const dynamic = "force-dynamic";

const versionNumber = (value: string | undefined): number =>
  value !== undefined && /^\d{1,9}$/.test(value) ? Number(value) : Number.NaN;

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: SearchParams;
}) {
  const actor = await requireActor();
  const { project: slug } = await params;
  const query = await searchParams;
  const project = await getProject(actor, slug).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const base = `/projects/${project.slug}`;
  const environmentName = param(query.environment);

  let title: string;
  let from: SchemaSnapshot;
  let to: SchemaSnapshot;
  let emptyMessage: string;
  try {
    const fromVersion = await getVersion(
      actor,
      project,
      versionNumber(param(query.from)),
    );
    from = await loadSnapshot(fromVersion);
    if (environmentName !== undefined) {
      if (!can(actor.role, "use-databases")) {
        return (
          <ErrorPanel
            title="Not allowed"
            error="Viewers cannot read live databases."
          />
        );
      }
      const environment = await getEnvironment(actor, project, environmentName);
      to = (await readLive(environment)).snapshot;
      title = `Drift: ${environment.name} since v${fromVersion.number}`;
      emptyMessage = `No drift: ${environment.name} is equivalent to v${fromVersion.number}.`;
    } else {
      const toVersion = await getVersion(
        actor,
        project,
        versionNumber(param(query.to)),
      );
      to = await loadSnapshot(toVersion);
      title = `v${fromVersion.number} → v${toVersion.number}`;
      emptyMessage = `No changes: v${toVersion.number} is equivalent to v${fromVersion.number}.`;
    }
  } catch (error) {
    return (
      <>
        <p>
          <Link href={base}>← {project.name}</Link>
        </p>
        <ErrorPanel title="Cannot compare" error={error} />
      </>
    );
  }

  return (
    <>
      <p>
        <Link href={base}>← {project.name}</Link>
      </p>
      <h1>
        {project.name}: {title}
      </h1>
      <p className="muted">
        The migration from the first to the second schema, with each
        statement&apos;s risk. Review only; nothing is executed.
      </p>
      <PlanView plan={planMigration(from, to)} emptyMessage={emptyMessage} />
    </>
  );
}
