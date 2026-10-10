// Who is making this request. Every page, server action and route handler calls
// requireActor() or requirePermission(); layouts are not a security boundary.
import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Actor } from "./actor.ts";
import { auth } from "./auth.ts";
import { db } from "./db.ts";
import { ForbiddenError } from "./errors.ts";
import { getInstallation } from "./membership.ts";
import { can, parseRole, type Permission } from "./roles.ts";

export async function currentSession() {
  return auth.api.getSession({ headers: await headers() });
}

/** The signed-in member; redirects to /setup, /sign-in or /no-access otherwise. */
export async function requireActor(): Promise<Actor> {
  const installation = await getInstallation();
  if (
    installation?.status !== "complete" ||
    installation.organizationId === null
  ) {
    redirect("/setup");
  }
  const session = await currentSession();
  if (session === null) redirect("/sign-in");
  const member = await db().member.findFirst({
    where: {
      organizationId: installation.organizationId,
      userId: session.user.id,
    },
  });
  const role = member === null ? null : parseRole(member.role);
  if (member === null || role === null) redirect("/no-access");
  return {
    userId: session.user.id,
    name: session.user.name,
    email: session.user.email,
    organizationId: installation.organizationId,
    memberId: member.id,
    role,
  };
}

export async function requirePermission(
  permission: Permission,
): Promise<Actor> {
  const actor = await requireActor();
  if (!can(actor.role, permission)) throw new ForbiddenError();
  return actor;
}
