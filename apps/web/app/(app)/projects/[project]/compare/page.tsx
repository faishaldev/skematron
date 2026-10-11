import Link from "next/link";
import { notFound } from "next/navigation";
import {
  openQuestions,
  planMigration,
  type SchemaSnapshot,
} from "@skematron/core";
import { NotFoundError } from "../../../../../lib/errors.ts";
import { getEnvironment, getProject } from "../../../../../lib/projects.ts";
import { can } from "../../../../../lib/roles.ts";
import { requireActor } from "../../../../../lib/session.ts";
import { readLive } from "../../../../../lib/targets.ts";
import { getVersion, loadSnapshot } from "../../../../../lib/versions.ts";
import { PlanView } from "../../../../components/plan-view.tsx";
import {
  Breadcrumbs,
  Callout,
  ErrorPanel,
  PageHeader,
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
  let subtitle: string;
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
      subtitle = `What would change if the ${environment.name} database were brought back to v${fromVersion.number}. Read only; nothing is executed.`;
      emptyMessage = `No drift: ${environment.name} is equivalent to v${fromVersion.number}.`;
    } else {
      const toVersion = await getVersion(
        actor,
        project,
        versionNumber(param(query.to)),
      );
      to = await loadSnapshot(toVersion);
      title = `What changed: v${fromVersion.number} → v${toVersion.number}`;
      subtitle = `The changes that turn v${fromVersion.number} into v${toVersion.number}, with the risk of each. Read only; nothing is executed.`;
      emptyMessage = `No changes: v${toVersion.number} is equivalent to v${fromVersion.number}.`;
    }
  } catch (error) {
    return (
      <>
        <Breadcrumbs
          items={[
            { label: "Projects", href: "/projects" },
            { label: project.name, href: base },
            { label: "Compare" },
          ]}
        />
        <ErrorPanel title="Cannot compare" error={error} />
      </>
    );
  }

  const plan = planMigration(from, to);
  const questions = openQuestions(plan).length;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: base },
          { label: "Compare" },
        ]}
      />
      <PageHeader title={title} subtitle={subtitle} />
      {questions > 0 && (
        <Callout
          tone="warning"
          title={`Skematron has ${questions} ${questions === 1 ? "question" : "questions"} about this change`}
        >
          <p>
            For example, whether a column was renamed or removed. Until they are
            answered, the list below deletes and re-creates instead, which loses
            data.
          </p>
        </Callout>
      )}
      <PlanView plan={plan} emptyMessage={emptyMessage} />
    </>
  );
}
