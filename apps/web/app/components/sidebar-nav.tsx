"use client";

// The sidebar's links. A client component only to know the current path: it highlights
// where you are and opens the current project's sections. All data comes from the server
// layout, and every page still checks permissions itself.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "../sign-out-action.ts";

export interface SidebarProject {
  slug: string;
  name: string;
}

function Item({
  href,
  label,
  active,
  sub = false,
}: {
  href: string;
  label: string;
  active: boolean;
  sub?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`side-link${sub ? " sub" : ""}${active ? " active" : ""}`}
      aria-current={active ? "page" : undefined}
    >
      {label}
    </Link>
  );
}

export function SidebarNav({
  projects,
  user,
  canManageProjects,
  canManageMembers,
  canViewAudit,
}: {
  projects: SidebarProject[];
  user: { name: string; role: string };
  canManageProjects: boolean;
  canManageMembers: boolean;
  canViewAudit: boolean;
}) {
  const pathname = usePathname();
  const within = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);
  return (
    <nav className="side-nav" aria-label="Main">
      <div className="side-group">
        <div className="side-heading">Projects</div>
        {projects.map((project) => {
          const base = `/projects/${project.slug}`;
          const open = within(base);
          const sections = [
            { href: base, label: "Overview", exact: true },
            { href: `${base}/branches`, label: "Branches" },
            { href: `${base}/versions`, label: "Main versions" },
            { href: `${base}/diagram`, label: "Diagram" },
            { href: `${base}/environments`, label: "Databases" },
            ...(canManageProjects
              ? [{ href: `${base}/settings`, label: "Settings" }]
              : []),
          ];
          return (
            <div key={project.slug}>
              <Item
                href={base}
                label={project.name}
                active={open && !sections.slice(1).some((s) => within(s.href))}
              />
              {open &&
                sections
                  .slice(1)
                  .map((section) => (
                    <Item
                      key={section.href}
                      href={section.href}
                      label={section.label}
                      active={within(section.href)}
                      sub
                    />
                  ))}
            </div>
          );
        })}
        {projects.length === 0 && (
          <span className="side-empty">No projects yet</span>
        )}
        <Item
          href="/projects"
          label={canManageProjects ? "All projects / new" : "All projects"}
          active={pathname === "/projects"}
        />
      </div>
      {(canManageMembers || canViewAudit) && (
        <div className="side-group">
          <div className="side-heading">Organization</div>
          {canManageMembers && (
            <Item
              href="/settings/members"
              label="Members"
              active={within("/settings/members")}
            />
          )}
          {canViewAudit && (
            <Item
              href="/settings/audit"
              label="Audit log"
              active={within("/settings/audit")}
            />
          )}
        </div>
      )}
      <div className="side-user">
        <div>
          <strong>{user.name}</strong>
          <div className="hint">{user.role}</div>
        </div>
        <form action={signOutAction}>
          <button type="submit" className="small">
            Sign out
          </button>
        </form>
      </div>
    </nav>
  );
}
