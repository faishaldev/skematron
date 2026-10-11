import Link from "next/link";
import type { ReactNode } from "react";
import { listProjects } from "../../lib/projects.ts";
import { can } from "../../lib/roles.ts";
import { requireActor } from "../../lib/session.ts";
import { SidebarNav } from "../components/sidebar-nav.tsx";

// Signed-in area: a sidebar and the page. This layout only renders navigation: every page,
// action and route still checks the actor and its permission itself.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const actor = await requireActor();
  const projects = await listProjects(actor);
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/projects" className="brand">
          <span className="brand-mark" aria-hidden>
            S
          </span>
          Skematron
        </Link>
        <SidebarNav
          projects={projects.map((project) => ({
            slug: project.slug,
            name: project.name,
            openBranches: project._count.branches,
          }))}
          user={{ name: actor.name, role: actor.role }}
          canManageProjects={can(actor.role, "manage-projects")}
          canManageMembers={can(actor.role, "manage-members")}
          canViewAudit={can(actor.role, "view-audit")}
        />
      </aside>
      <main>{children}</main>
    </div>
  );
}
