"use server";

import { headers } from "next/headers";
import { field, runAction, withFlash } from "../../../../lib/actions.ts";
import {
  cancelInvitation,
  changeMemberRole,
  inviteMember,
  removeMember,
} from "../../../../lib/members.ts";
import { requirePermission } from "../../../../lib/session.ts";

const MEMBERS = "/settings/members";

export async function inviteAction(formData: FormData): Promise<void> {
  await runAction(MEMBERS, async () => {
    const actor = await requirePermission("manage-members");
    const email = field(formData, "email");
    await inviteMember(
      actor,
      { email, role: field(formData, "role") },
      await headers(),
    );
    return withFlash(
      MEMBERS,
      "notice",
      `Invitation created for ${email}. Copy its link from Pending invitations and send it to them.`,
    );
  });
}

export async function cancelInvitationAction(
  formData: FormData,
): Promise<void> {
  await runAction(MEMBERS, async () => {
    const actor = await requirePermission("manage-members");
    await cancelInvitation(
      actor,
      field(formData, "invitationId"),
      await headers(),
    );
    return withFlash(MEMBERS, "notice", "Invitation cancelled.");
  });
}

export async function changeRoleAction(formData: FormData): Promise<void> {
  await runAction(MEMBERS, async () => {
    const actor = await requirePermission("manage-members");
    await changeMemberRole(
      actor,
      { memberId: field(formData, "memberId"), role: field(formData, "role") },
      await headers(),
    );
    return withFlash(MEMBERS, "notice", "Role updated.");
  });
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  await runAction(MEMBERS, async () => {
    const actor = await requirePermission("manage-members");
    await removeMember(actor, field(formData, "memberId"), await headers());
    return withFlash(MEMBERS, "notice", "Member removed.");
  });
}
