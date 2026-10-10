// Members and invitations of the installation's organization. Changes go through Better Auth
// as the acting user (it enforces organization permissions too); this module adds the app's
// rules (no escalation above your own role, the owner is protected) and the audit log.
import type { Actor } from "./actor.ts";
import { auth } from "./auth.ts";
import { recordAudit } from "./audit.ts";
import { db } from "./db.ts";
import { ForbiddenError, NotFoundError, UserFacingError } from "./errors.ts";
import { normalizeEmail } from "./membership.ts";
import { assertCan } from "./projects.ts";
import {
  assignableRoles,
  canManageMember,
  parseRole,
  ROLES,
  type Role,
} from "./roles.ts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseAssignableRole(actor: Actor, value: string): Role {
  const role = (ROLES as readonly string[]).includes(value)
    ? (value as Role)
    : null;
  if (role === null || !assignableRoles(actor.role).includes(role)) {
    throw new ForbiddenError("You cannot give that role.");
  }
  return role;
}

export async function listMembers(actor: Actor) {
  assertCan(actor, "read");
  return db().member.findMany({
    where: { organizationId: actor.organizationId },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
}

export async function listOpenInvitations(actor: Actor) {
  assertCan(actor, "manage-members");
  return db().invitation.findMany({
    where: {
      organizationId: actor.organizationId,
      status: "pending",
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function inviteMember(
  actor: Actor,
  input: { email: string; role: string },
  requestHeaders: Headers,
): Promise<{ id: string }> {
  assertCan(actor, "manage-members");
  const email = normalizeEmail(input.email);
  if (!EMAIL.test(email))
    throw new UserFacingError("Enter a valid email address.");
  const role = parseAssignableRole(actor, input.role);
  const invitation = await auth.api.createInvitation({
    body: { email, role, organizationId: actor.organizationId },
    headers: requestHeaders,
  });
  await recordAudit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    action: "member.invite",
    targetType: "invitation",
    targetId: invitation.id,
    details: { email, role },
  });
  return { id: invitation.id };
}

export async function cancelInvitation(
  actor: Actor,
  invitationId: string,
  requestHeaders: Headers,
): Promise<void> {
  assertCan(actor, "manage-members");
  const invitation = await db().invitation.findFirst({
    where: { id: invitationId, organizationId: actor.organizationId },
  });
  if (invitation === null) throw new NotFoundError("Invitation not found.");
  await auth.api.cancelInvitation({
    body: { invitationId },
    headers: requestHeaders,
  });
  await recordAudit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    action: "member.invite_cancel",
    targetType: "invitation",
    targetId: invitationId,
    details: { email: invitation.email },
  });
}

async function managedMember(actor: Actor, memberId: string) {
  assertCan(actor, "manage-members");
  const member = await db().member.findFirst({
    where: { id: memberId, organizationId: actor.organizationId },
    include: { user: { select: { email: true } } },
  });
  if (member === null) throw new NotFoundError("Member not found.");
  const current = parseRole(member.role);
  if (member.id === actor.memberId) {
    throw new ForbiddenError("You cannot change your own membership here.");
  }
  if (current === null || !canManageMember(actor.role, current)) {
    throw new ForbiddenError("You cannot change this member.");
  }
  return { member, current };
}

export async function changeMemberRole(
  actor: Actor,
  input: { memberId: string; role: string },
  requestHeaders: Headers,
): Promise<void> {
  const { member, current } = await managedMember(actor, input.memberId);
  const role = parseAssignableRole(actor, input.role);
  if (role === current) return;
  await auth.api.updateMemberRole({
    body: { memberId: member.id, role, organizationId: actor.organizationId },
    headers: requestHeaders,
  });
  await recordAudit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    action: "member.role_change",
    targetType: "member",
    targetId: member.id,
    details: { email: member.user.email, from: current, to: role },
  });
}

export async function removeMember(
  actor: Actor,
  memberId: string,
  requestHeaders: Headers,
): Promise<void> {
  const { member, current } = await managedMember(actor, memberId);
  await auth.api.removeMember({
    body: { memberIdOrEmail: member.id, organizationId: actor.organizationId },
    headers: requestHeaders,
  });
  await recordAudit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    action: "member.remove",
    targetType: "member",
    targetId: member.id,
    details: { email: member.user.email, role: current },
  });
}
