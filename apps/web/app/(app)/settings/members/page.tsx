import { listMembers, listOpenInvitations } from "../../../../lib/members.ts";
import {
  assignableRoles,
  can,
  canManageMember,
  parseRole,
} from "../../../../lib/roles.ts";
import { requireActor } from "../../../../lib/session.ts";
import {
  ErrorPanel,
  Flash,
  formatDate,
  PageHeader,
  type SearchParams,
} from "../../../components/ui.tsx";
import {
  cancelInvitationAction,
  changeRoleAction,
  inviteAction,
  removeMemberAction,
} from "./actions.ts";

export const dynamic = "force-dynamic";

export default async function MembersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const actor = await requireActor();
  if (!can(actor.role, "manage-members")) {
    return (
      <ErrorPanel title="Not allowed" error="Only admins can manage members." />
    );
  }
  const [members, invitations] = await Promise.all([
    listMembers(actor),
    listOpenInvitations(actor),
  ]);
  const roles = assignableRoles(actor.role);
  const origin = process.env.BETTER_AUTH_URL ?? "";

  return (
    <>
      <PageHeader
        title="Members"
        subtitle="Who can use this Skematron. Viewers read; members start, change and merge branches; admins also review branches, manage projects and databases, and invite people."
      />
      <Flash searchParams={searchParams} />
      <div className="card flush">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const role = parseRole(member.role);
              const manageable =
                member.id !== actor.memberId &&
                role !== null &&
                canManageMember(actor.role, role);
              return (
                <tr key={member.id}>
                  <td>{member.user.name}</td>
                  <td>{member.user.email}</td>
                  <td>
                    {manageable ? (
                      <form action={changeRoleAction} className="inline">
                        <input
                          type="hidden"
                          name="memberId"
                          value={member.id}
                        />
                        <select name="role" defaultValue={role}>
                          {roles.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                        <button type="submit">Save</button>
                      </form>
                    ) : (
                      (role ?? member.role)
                    )}
                  </td>
                  <td>
                    {manageable && (
                      <form action={removeMemberAction} className="inline">
                        <input
                          type="hidden"
                          name="memberId"
                          value={member.id}
                        />
                        <button type="submit" className="danger">
                          Remove
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>Invite someone</h2>
      <form action={inviteAction} className="inline card">
        <input
          name="email"
          type="email"
          required
          placeholder="name@example.com"
        />
        <select name="role" defaultValue="member">
          {roles.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
        <button type="submit" className="primary">
          Create invitation
        </button>
      </form>
      <p className="hint">
        No email is sent: copy the invitation link and share it yourself. Roles:
        viewer (read only), member (+ branches), admin (+ reviews, projects,
        databases, members).
      </p>

      <h2>Pending invitations</h2>
      {invitations.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Expires</th>
                <th>Link</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((invitation) => (
                <tr key={invitation.id}>
                  <td>{invitation.email}</td>
                  <td>{invitation.role ?? "member"}</td>
                  <td>{formatDate(invitation.expiresAt)}</td>
                  <td>
                    <code>{`${origin}/invite/${invitation.id}`}</code>
                  </td>
                  <td>
                    <form action={cancelInvitationAction} className="inline">
                      <input
                        type="hidden"
                        name="invitationId"
                        value={invitation.id}
                      />
                      <button type="submit" className="danger">
                        Cancel
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
