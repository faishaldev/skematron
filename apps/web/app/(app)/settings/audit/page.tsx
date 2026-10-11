import { db } from "../../../../lib/db.ts";
import { can } from "../../../../lib/roles.ts";
import { requireActor } from "../../../../lib/session.ts";
import { ErrorPanel, formatDate, PageHeader } from "../../../components/ui.tsx";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const actor = await requireActor();
  if (!can(actor.role, "view-audit")) {
    return (
      <ErrorPanel
        title="Not allowed"
        error="Only admins can view the audit log."
      />
    );
  }
  const events = await db().auditEvent.findMany({
    where: { organizationId: actor.organizationId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const actorIds = [
    ...new Set(
      events.map((event) => event.actorId).filter((id) => id !== null),
    ),
  ];
  const users = await db().user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, name: true, email: true },
  });
  const nameOf = new Map(
    users.map((user) => [user.id, `${user.name} <${user.email}>`]),
  );

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="The latest 200 important actions: who did what, and when. Details never contain passwords or connection secrets."
      />
      <div className="card flush">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td>{formatDate(event.createdAt)}</td>
                <td>
                  {event.actorId === null
                    ? "—"
                    : (nameOf.get(event.actorId) ?? "former member")}
                </td>
                <td>
                  <code>{event.action}</code>
                </td>
                <td>
                  <code>{JSON.stringify(event.details)}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
