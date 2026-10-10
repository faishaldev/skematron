// Who may join the installation: the first-run owner, or someone holding a pending
// invitation. Single-organization mode: the installation owns exactly one organization.
import { randomUUID } from "node:crypto";
import { db } from "./db.ts";

export const INSTALLATION_ID = 1;

export class InvitationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvitationError";
  }
}

export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase();

export async function getInstallation() {
  return db().installation.findUnique({ where: { id: INSTALLATION_ID } });
}

/** The installation's organization once setup is complete. */
export async function installationOrganizationId(): Promise<string | null> {
  const installation = await getInstallation();
  return installation?.status === "complete"
    ? installation.organizationId
    : null;
}

/**
 * Sign-up gate, called by Better Auth before it creates any user. Allows the owner while
 * first-run setup is pending, and afterwards only emails with a pending, unexpired invitation.
 */
export async function maySignUp(email: string): Promise<boolean> {
  const address = normalizeEmail(email);
  const installation = await getInstallation();
  if (installation === null) return false;
  if (installation.status === "pending") {
    return normalizeEmail(installation.ownerEmail) === address;
  }
  if (installation.organizationId === null) return false;
  const invitation = await db().invitation.findFirst({
    where: {
      organizationId: installation.organizationId,
      email: { equals: address, mode: "insensitive" },
      status: "pending",
      expiresAt: { gt: new Date() },
    },
  });
  return invitation !== null;
}

/** A pending, unexpired invitation of this installation, or null. */
export async function findOpenInvitation(invitationId: string) {
  const organizationId = await installationOrganizationId();
  if (organizationId === null) return null;
  const invitation = await db().invitation.findFirst({
    where: { id: invitationId, organizationId, status: "pending" },
  });
  return invitation !== null && invitation.expiresAt > new Date()
    ? invitation
    : null;
}

/** Makes the user a member with the invitation's role and marks the invitation accepted. */
export async function acceptInvitation(
  invitationId: string,
  user: { id: string; email: string },
): Promise<{ organizationId: string; role: string }> {
  return db().$transaction(async (tx) => {
    const invitation = await tx.invitation.findUnique({
      where: { id: invitationId },
    });
    if (
      invitation === null ||
      invitation.status !== "pending" ||
      invitation.expiresAt <= new Date()
    ) {
      throw new InvitationError("This invitation is no longer valid.");
    }
    if (normalizeEmail(invitation.email) !== normalizeEmail(user.email)) {
      throw new InvitationError(
        "This invitation was sent to a different email address.",
      );
    }
    const existing = await tx.member.findFirst({
      where: { organizationId: invitation.organizationId, userId: user.id },
    });
    const role = invitation.role ?? "member";
    if (existing === null) {
      await tx.member.create({
        data: {
          id: randomUUID(),
          organizationId: invitation.organizationId,
          userId: user.id,
          role,
          createdAt: new Date(),
        },
      });
    }
    await tx.invitation.update({
      where: { id: invitationId },
      data: { status: "accepted" },
    });
    return { organizationId: invitation.organizationId, role };
  });
}
