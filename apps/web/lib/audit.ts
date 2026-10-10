// Audit log of privileged actions (AGENTS.md "Security"). Details never contain secrets:
// no connection URLs, passwords or tokens.
import { db } from "./db.ts";

export type AuditAction =
  | "installation.setup"
  | "member.invite"
  | "member.invite_cancel"
  | "member.join"
  | "member.role_change"
  | "member.remove"
  | "project.create"
  | "environment.create"
  | "environment.update"
  | "environment.delete"
  | "version.import";

export interface AuditEventInput {
  organizationId: string;
  actorId: string | null;
  action: AuditAction;
  targetType: string;
  targetId?: string | null;
  details?: Record<string, string | number | boolean | null | string[]>;
}

export async function recordAudit(event: AuditEventInput): Promise<void> {
  await db().auditEvent.create({
    data: {
      organizationId: event.organizationId,
      actorId: event.actorId,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId ?? null,
      details: event.details ?? {},
    },
  });
}
