"use server";

import { headers } from "next/headers";
import { field, runAction } from "../../../lib/actions.ts";
import { auth } from "../../../lib/auth.ts";
import { recordAudit } from "../../../lib/audit.ts";
import { UserFacingError } from "../../../lib/errors.ts";
import {
  acceptInvitation,
  findOpenInvitation,
} from "../../../lib/membership.ts";

async function join(invitationId: string, user: { id: string; email: string }) {
  const { organizationId, role } = await acceptInvitation(invitationId, user);
  await recordAudit({
    organizationId,
    actorId: user.id,
    action: "member.join",
    targetType: "invitation",
    targetId: invitationId,
    details: { email: user.email, role },
  });
}

/** New user: creates the account for the invited email, then joins. */
export async function signUpAndJoinAction(formData: FormData): Promise<void> {
  const invitationId = field(formData, "invitationId");
  await runAction(`/invite/${encodeURIComponent(invitationId)}`, async () => {
    const invitation = await findOpenInvitation(invitationId);
    if (invitation === null) {
      throw new UserFacingError("This invitation is invalid or has expired.");
    }
    const { user } = await auth.api.signUpEmail({
      body: {
        email: invitation.email,
        name: field(formData, "name"),
        password: field(formData, "password"),
      },
    });
    await join(invitationId, user);
    return "/projects";
  });
}

/** Existing, signed-in user with the invited email: joins. */
export async function joinAction(formData: FormData): Promise<void> {
  const invitationId = field(formData, "invitationId");
  await runAction(`/invite/${encodeURIComponent(invitationId)}`, async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (session === null) throw new UserFacingError("Sign in first.");
    await join(invitationId, session.user);
    return "/projects";
  });
}
