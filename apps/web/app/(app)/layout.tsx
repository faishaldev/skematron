import Link from "next/link";
import type { ReactNode } from "react";
import { can } from "../../lib/roles.ts";
import { requireActor } from "../../lib/session.ts";
import { signOutAction } from "../sign-out-action.ts";

// Signed-in area. This layout only renders navigation: every page, action and route still
// checks the actor and its permission itself.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const actor = await requireActor();
  return (
    <>
      <header className="top">
        <Link href="/projects" className="brand">
          <span className="brand-mark" aria-hidden>
            S
          </span>
          Skematron
        </Link>
        <nav className="nav">
          <Link href="/projects">Projects</Link>
          {can(actor.role, "manage-members") && (
            <Link href="/settings/members">Members</Link>
          )}
          {can(actor.role, "view-audit") && (
            <Link href="/settings/audit">Audit log</Link>
          )}
        </nav>
        <span className="spacer" />
        <span className="tag">
          {actor.name} <span className="badge neutral">{actor.role}</span>
        </span>
        <form action={signOutAction}>
          <button type="submit" className="small">
            Sign out
          </button>
        </form>
      </header>
      <main>{children}</main>
    </>
  );
}
