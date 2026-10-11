// The app's permission policy: one pure function per question, checked on the server
// for every page, action and route handler. Better Auth stores the role names.

export const ROLES = ["viewer", "member", "admin", "owner"] as const;
export type Role = (typeof ROLES)[number];

export type Permission =
  /** View projects, environments (redacted), versions, compare and export. */
  | "read"
  /** Import versions, test connections, check drift. Reads user databases, never writes. */
  | "use-databases"
  /** Create and edit projects and environments, including connection credentials. */
  | "manage-projects"
  /** Invite and remove members, change roles. */
  | "manage-members"
  | "view-audit"
  /** Import Prisma schemas as versions; create, revise and submit migrations. */
  | "author-migrations"
  /** Approve or reject migrations. Never your own: see lib/migrations.ts. */
  | "review-migrations";

const MINIMUM_ROLE: Record<Permission, Role> = {
  read: "viewer",
  "use-databases": "member",
  "manage-projects": "admin",
  "manage-members": "admin",
  "view-audit": "admin",
  "author-migrations": "member",
  "review-migrations": "admin",
};

const rank = (role: Role): number => ROLES.indexOf(role);

/** Parses Better Auth's role field ("admin", or "admin,member" for several roles); the highest wins. */
export function parseRole(value: string): Role | null {
  const roles = value
    .split(",")
    .map((part) => part.trim())
    .filter((part): part is Role =>
      (ROLES as readonly string[]).includes(part),
    );
  if (roles.length === 0) return null;
  return roles.reduce((highest, role) =>
    rank(role) > rank(highest) ? role : highest,
  );
}

export function can(role: Role, permission: Permission): boolean {
  return rank(role) >= rank(MINIMUM_ROLE[permission]);
}

/** Roles an actor may hand out: up to their own level, and never owner (no ownership transfer yet). */
export function assignableRoles(actor: Role): Role[] {
  if (!can(actor, "manage-members")) return [];
  return ROLES.filter((role) => role !== "owner" && rank(role) <= rank(actor));
}

/** Whether the actor may change or remove a member who currently has `target`. */
export function canManageMember(actor: Role, target: Role): boolean {
  return (
    can(actor, "manage-members") &&
    target !== "owner" &&
    rank(target) <= rank(actor)
  );
}
