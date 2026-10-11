// Projects and environments. Every query is scoped to the actor's organization, and every
// change checks the actor's permission and is audited.
import type { Actor } from "./actor.ts";
import { recordAudit } from "./audit.ts";
import { validateConnectionUrl } from "./connections.ts";
import { db } from "./db.ts";
import { secretKey } from "./env.ts";
import {
  ForbiddenError,
  isUniqueViolation,
  NotFoundError,
  UserFacingError,
} from "./errors.ts";
import { can, type Permission } from "./roles.ts";
import { encryptSecret } from "./secrets.ts";
import { isSlug, slugify } from "./slugs.ts";

export function assertCan(actor: Actor, permission: Permission): void {
  if (!can(actor.role, permission)) throw new ForbiddenError();
}

export async function listProjects(actor: Actor) {
  assertCan(actor, "read");
  return db().project.findMany({
    where: { organizationId: actor.organizationId },
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: { environments: true, versions: true, migrations: true },
      },
    },
  });
}

export async function getProject(actor: Actor, slug: string) {
  assertCan(actor, "read");
  const project = isSlug(slug)
    ? await db().project.findUnique({
        where: {
          organizationId_slug: { organizationId: actor.organizationId, slug },
        },
      })
    : null;
  if (project === null) throw new NotFoundError("Project not found.");
  return project;
}

export type Project = Awaited<ReturnType<typeof getProject>>;

/**
 * Where a project's schema is written. "code": a schema.prisma, migrations in the
 * application's repository, or the database itself; versions are imported. "dashboard":
 * the schema editor; versions are saved from it.
 */
export type SchemaSource = "code" | "dashboard";

export function parseSchemaSource(value: string): SchemaSource {
  if (value !== "code" && value !== "dashboard") {
    throw new UserFacingError("Choose where the schema is written.");
  }
  return value;
}

export function schemaSourceOf(project: {
  schemaSource: string;
}): SchemaSource {
  return project.schemaSource === "dashboard" ? "dashboard" : "code";
}

/** Refuses work that belongs to the other schema source, so a project has one source of truth. */
export function requireSchemaSource(
  project: { schemaSource: string },
  source: SchemaSource,
): void {
  if (schemaSourceOf(project) === source) return;
  throw new UserFacingError(
    source === "code"
      ? "This project's schema is written in Skematron's editor, so change it there. An admin can switch the project to code in its settings."
      : "This project's schema is written in code: upload the changed schema.prisma instead. An admin can switch the project to the schema editor in its settings.",
  );
}

export async function setSchemaSource(
  actor: Actor,
  project: Project,
  source: SchemaSource,
): Promise<void> {
  assertCan(actor, "manage-projects");
  if (schemaSourceOf(project) === source) return;
  await db().project.update({
    where: { id: project.id },
    data: { schemaSource: source },
  });
  await recordAudit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    action: "project.update",
    targetType: "project",
    targetId: project.id,
    details: { slug: project.slug, schemaSource: source },
  });
}

export async function createProject(
  actor: Actor,
  name: string,
  schemaSource: SchemaSource = "code",
) {
  assertCan(actor, "manage-projects");
  const trimmed = name.trim();
  if (trimmed === "" || trimmed.length > 80) {
    throw new UserFacingError("Enter a project name of up to 80 characters.");
  }
  const base = slugify(trimmed);
  for (let suffix = 1; suffix <= 50; suffix += 1) {
    const slug = suffix === 1 ? base : `${base}-${suffix}`;
    try {
      const project = await db().project.create({
        data: {
          organizationId: actor.organizationId,
          name: trimmed,
          slug,
          schemaSource,
          createdById: actor.userId,
        },
      });
      await recordAudit({
        organizationId: actor.organizationId,
        actorId: actor.userId,
        action: "project.create",
        targetType: "project",
        targetId: project.id,
        details: { name: trimmed, slug, schemaSource },
      });
      return project;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new UserFacingError("Could not find a free URL for this project name.");
}

export interface EnvironmentInput {
  name: string;
  /** Required when creating. When updating, empty means "keep the stored URL". */
  connectionUrl: string;
  namespaces: string[];
}

const ENVIRONMENT_NAME = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

function validateEnvironment(input: EnvironmentInput) {
  const name = input.name.trim();
  if (!ENVIRONMENT_NAME.test(name)) {
    throw new UserFacingError(
      "Environment names use lowercase letters, digits and dashes (e.g. production, staging-eu).",
    );
  }
  const namespaces = [
    ...new Set(
      input.namespaces.map((namespace) => namespace.trim()).filter(Boolean),
    ),
  ];
  if (
    namespaces.length === 0 ||
    namespaces.length > 20 ||
    namespaces.some((namespace) => namespace.length > 63)
  ) {
    throw new UserFacingError(
      "List 1 to 20 schemas to track (each up to 63 characters), e.g. public.",
    );
  }
  return { name, namespaces };
}

export async function listEnvironments(actor: Actor, project: Project) {
  assertCan(actor, "read");
  return db().environment.findMany({
    where: { projectId: project.id },
    orderBy: { name: "asc" },
  });
}

export async function getEnvironment(
  actor: Actor,
  project: Project,
  name: string,
) {
  assertCan(actor, "read");
  const environment = ENVIRONMENT_NAME.test(name)
    ? await db().environment.findUnique({
        where: { projectId_name: { projectId: project.id, name } },
      })
    : null;
  if (environment === null) throw new NotFoundError("Environment not found.");
  return environment;
}

export type Environment = Awaited<ReturnType<typeof getEnvironment>>;

export async function createEnvironment(
  actor: Actor,
  project: Project,
  input: EnvironmentInput,
) {
  assertCan(actor, "manage-projects");
  const { name, namespaces } = validateEnvironment(input);
  const connection = validateConnectionUrl(input.connectionUrl);
  try {
    const environment = await db().environment.create({
      data: {
        projectId: project.id,
        name,
        engine: "postgresql",
        connectionCiphertext: encryptSecret(connection.url, secretKey()),
        connectionHint: connection.hint,
        namespaces,
        createdById: actor.userId,
      },
    });
    await recordAudit({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      action: "environment.create",
      targetType: "environment",
      targetId: environment.id,
      details: {
        project: project.slug,
        name,
        target: connection.hint,
        namespaces,
      },
    });
    return environment;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new UserFacingError(`An environment named ${name} already exists.`);
    }
    throw error;
  }
}

export async function updateEnvironment(
  actor: Actor,
  project: Project,
  environment: Environment,
  input: EnvironmentInput,
) {
  assertCan(actor, "manage-projects");
  const { name, namespaces } = validateEnvironment(input);
  const connection =
    input.connectionUrl.trim() === ""
      ? null
      : validateConnectionUrl(input.connectionUrl);
  try {
    const updated = await db().environment.update({
      where: { id: environment.id },
      data: {
        name,
        namespaces,
        ...(connection === null
          ? {}
          : {
              connectionCiphertext: encryptSecret(connection.url, secretKey()),
              connectionHint: connection.hint,
            }),
      },
    });
    await recordAudit({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      action: "environment.update",
      targetType: "environment",
      targetId: environment.id,
      details: {
        project: project.slug,
        name,
        namespaces,
        connectionChanged: connection !== null,
        target: updated.connectionHint,
      },
    });
    return updated;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new UserFacingError(`An environment named ${name} already exists.`);
    }
    throw error;
  }
}

/** Deletes the database target. Versions imported from it stay, with their provenance. */
export async function deleteEnvironment(
  actor: Actor,
  project: Project,
  environment: Environment,
) {
  assertCan(actor, "manage-projects");
  await db().environment.delete({ where: { id: environment.id } });
  await recordAudit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    action: "environment.delete",
    targetType: "environment",
    targetId: environment.id,
    details: { project: project.slug, name: environment.name },
  });
}
