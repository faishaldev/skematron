import type { Role } from "./roles.ts";

/** The signed-in member performing a request. */
export interface Actor {
  userId: string;
  name: string;
  email: string;
  organizationId: string;
  memberId: string;
  role: Role;
}
