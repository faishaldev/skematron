// Errors whose messages are safe to show to the signed-in user. Anything else is shown as
// a generic message and logged on the server.
import {
  PlanningError,
  SchemaEditError,
  SnapshotValidationError,
} from "@skematron/core";
import {
  PostgresIntrospectionError,
  PrismaSchemaError,
} from "@skematron/adapters";
import { ArtifactStoreError } from "@skematron/storage";
import { ConnectionUrlError } from "./connections.ts";
import { InvitationError } from "./membership.ts";
import { SchemaInputError } from "./schema-input.ts";

export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

export class ForbiddenError extends UserFacingError {
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends UserFacingError {
  constructor(message = "Not found.") {
    super(message);
    this.name = "NotFoundError";
  }
}

const SAFE_ERRORS = [
  UserFacingError,
  ConnectionUrlError,
  InvitationError,
  SchemaInputError,
  PostgresIntrospectionError,
  PrismaSchemaError,
  PlanningError,
  SchemaEditError,
  SnapshotValidationError,
  ArtifactStoreError,
];

export function messageFor(error: unknown): string {
  if (SAFE_ERRORS.some((type) => error instanceof type)) {
    return (error as Error).message;
  }
  // Better Auth API errors carry user-facing messages ("Invalid email or password").
  if (
    error instanceof Error &&
    error.name === "APIError" &&
    error.message !== ""
  ) {
    return error.message;
  }
  console.error(error);
  return "Something went wrong. Check the server log for details.";
}

/** Prisma's unique-constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === "P2002"
  );
}
