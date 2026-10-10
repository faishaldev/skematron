// Better Auth configuration. Kept free of `server-only` so the Better Auth CLI can load it
// (`pnpm dlx auth@1.7.7 generate`); only server modules import it.
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";
import { db } from "./db.ts";
import { installationOrganizationId, maySignUp } from "./membership.ts";

// Organization-management permissions in Better Auth. App permissions live in roles.ts.
const ac = createAccessControl(defaultStatements);
export const authRoles = {
  // Owners may not delete the installation's organization, not even through the API.
  owner: ac.newRole({ ...ownerAc.statements, organization: ["update"] }),
  admin: ac.newRole(adminAc.statements),
  member: ac.newRole(memberAc.statements),
  viewer: ac.newRole(memberAc.statements),
};

export const auth = betterAuth({
  appName: "Skematron",
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(db(), { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    autoSignIn: true,
  },
  telemetry: { enabled: false },
  databaseHooks: {
    user: {
      create: {
        // Invitation-only sign-up, enforced for every way of creating a user.
        before: async (user) => {
          if (!(await maySignUp(user.email))) {
            throw new APIError("FORBIDDEN", {
              message: "Sign-up is by invitation only.",
            });
          }
        },
      },
    },
    session: {
      create: {
        before: async (session) => ({
          data: {
            ...session,
            activeOrganizationId: await installationOrganizationId(),
          },
        }),
      },
    },
  },
  plugins: [
    organization({
      ac,
      roles: authRoles,
      allowUserToCreateOrganization: false,
      // Invitations are shared as links on the members page; no email is sent.
      async sendInvitationEmail() {},
    }),
    nextCookies(), // Must stay last.
  ],
});
