// First-run setup: creates the installation's owner and its one organization.
import { auth } from "./auth.ts";
import { recordAudit } from "./audit.ts";
import { db } from "./db.ts";
import { UserFacingError, isUniqueViolation } from "./errors.ts";
import {
  getInstallation,
  INSTALLATION_ID,
  normalizeEmail,
} from "./membership.ts";
import { slugify } from "./slugs.ts";

export interface SetupInput {
  organizationName: string;
  name: string;
  email: string;
  password: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Claims setup by writing the single installation row; fails if setup is already complete. */
async function claimSetup(ownerEmail: string): Promise<void> {
  const existing = await getInstallation();
  if (existing?.status === "complete") {
    throw new UserFacingError("Setup is already complete. Sign in instead.");
  }
  if (existing === null) {
    try {
      await db().installation.create({
        data: { id: INSTALLATION_ID, status: "pending", ownerEmail },
      });
      return;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return claimSetup(ownerEmail); // Someone else just claimed it; re-check.
    }
  }
  // A previous attempt did not finish: let this one take over.
  await db().installation.update({
    where: { id: INSTALLATION_ID, status: "pending" },
    data: { ownerEmail },
  });
}

/** The owner's account: created now, or (when retrying a failed setup) signed in with the same password. */
async function ownerAccount(input: SetupInput): Promise<{ id: string }> {
  try {
    const { user } = await auth.api.signUpEmail({
      body: { email: input.email, password: input.password, name: input.name },
    });
    return user;
  } catch (error) {
    if (!/already exists/i.test((error as Error).message)) throw error;
    const { user } = await auth.api.signInEmail({
      body: { email: input.email, password: input.password },
    });
    return user;
  }
}

export async function runSetup(input: SetupInput): Promise<void> {
  const organizationName = input.organizationName.trim();
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  if (organizationName === "" || organizationName.length > 80) {
    throw new UserFacingError(
      "Enter an organization name of up to 80 characters.",
    );
  }
  if (name === "" || name.length > 80) {
    throw new UserFacingError("Enter your name (up to 80 characters).");
  }
  if (!EMAIL.test(email))
    throw new UserFacingError("Enter a valid email address.");
  if (input.password.length < 12) {
    throw new UserFacingError("Use a password of at least 12 characters.");
  }

  await claimSetup(email);
  const user = await ownerAccount({ ...input, name, email });
  // Server-side, without session headers: allowed even though users cannot create organizations.
  const organization = await auth.api.createOrganization({
    body: {
      name: organizationName,
      slug: slugify(organizationName),
      userId: user.id,
    },
  });
  if (organization === null)
    throw new Error("Better Auth did not create the organization.");
  await db().installation.update({
    where: { id: INSTALLATION_ID },
    data: { status: "complete", organizationId: organization.id },
  });
  await recordAudit({
    organizationId: organization.id,
    actorId: user.id,
    action: "installation.setup",
    targetType: "organization",
    targetId: organization.id,
    details: { organization: organizationName },
  });
}
