"use client";

// The sidebar's links. A client component only to know the current path: it shows which
// project you are in, highlights where you are, remembers the last project you opened (so
// pages outside a project still show its sections), and closes the project switcher after
// you pick something. All data comes from the server layout, and every page still checks
// permissions itself.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { signOutAction } from "../sign-out-action.ts";
import { Icon, type IconName } from "./icons.tsx";
import { LAST_PROJECT_COOKIE } from "./last-project.ts";

export interface SidebarProject {
  slug: string;
  name: string;
  openBranches: number;
}

function Item({
  href,
  label,
  icon,
  active,
  count,
}: {
  href: string;
  label: string;
  icon: IconName;
  active: boolean;
  count?: number;
}) {
  return (
    <Link
      href={href}
      className={`side-link${active ? " active" : ""}`}
      aria-current={active ? "page" : undefined}
    >
      <Icon name={icon} />
      <span className="side-label">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="side-count" aria-label={`${count} open`}>
          {count}
        </span>
      )}
    </Link>
  );
}

/** Picks the project; a native <details> menu, so it also works without JavaScript. */
function ProjectSwitcher({
  projects,
  current,
  canManageProjects,
}: {
  projects: SidebarProject[];
  current: SidebarProject | undefined;
  canManageProjects: boolean;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    if (menu.current !== null) menu.current.open = false;
  }, [pathname]);
  useEffect(() => {
    const close = (event: Event) => {
      const details = menu.current;
      if (
        details?.open === true &&
        (event instanceof KeyboardEvent
          ? event.key === "Escape"
          : !details.contains(event.target as Node))
      ) {
        details.open = false;
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  return (
    <details className="switcher" ref={menu}>
      <summary>
        <span className="switcher-mark" aria-hidden>
          {(current?.name ?? "?").charAt(0).toUpperCase()}
        </span>
        <span className="switcher-text">
          <span className="switcher-caption">Project</span>
          <span className="switcher-name">
            {current?.name ?? "No projects yet"}
          </span>
        </span>
        <Icon name="chevron" />
      </summary>
      <div className="switcher-menu" role="menu">
        {projects.length > 0 && (
          <div className="switcher-heading">Switch project</div>
        )}
        {projects.map((project) => (
          <Link
            key={project.slug}
            href={`/projects/${project.slug}`}
            role="menuitem"
            className={project.slug === current?.slug ? "active" : ""}
          >
            <span className="switcher-mark small" aria-hidden>
              {project.name.charAt(0).toUpperCase()}
            </span>
            <span className="side-label">{project.name}</span>
            {project.slug === current?.slug && (
              <span className="hint">current</span>
            )}
          </Link>
        ))}
        {projects.length === 0 && (
          <span className="switcher-empty">No projects yet.</span>
        )}
        <div className="switcher-divider" />
        <Link href="/projects" role="menuitem">
          <Icon name="projects" />
          View all projects
        </Link>
        {canManageProjects && (
          <Link href="/projects/new" role="menuitem">
            <Icon name="plus" />
            New project
          </Link>
        )}
      </div>
    </details>
  );
}

export function SidebarNav({
  projects,
  lastProject,
  user,
  canManageProjects,
  canManageMembers,
  canViewAudit,
}: {
  projects: SidebarProject[];
  /** The last project opened, from the cookie; checked by the layout. */
  lastProject: string | undefined;
  user: { name: string; role: string };
  canManageProjects: boolean;
  canManageMembers: boolean;
  canViewAudit: boolean;
}) {
  const pathname = usePathname();
  const within = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);
  const slug = /^\/projects\/([^/]+)/.exec(pathname)?.[1];
  const opened = projects.find((project) => project.slug === slug);
  // Outside a project (all projects, members, audit log) the sidebar keeps showing the
  // last project, or the first one, so its sections never disappear.
  const current =
    opened ??
    projects.find((project) => project.slug === lastProject) ??
    projects[0];
  useEffect(() => {
    if (opened === undefined) return;
    document.cookie = `${LAST_PROJECT_COOKIE}=${encodeURIComponent(opened.slug)}; path=/; max-age=31536000; samesite=lax`;
  }, [opened]);
  const base = current === undefined ? "" : `/projects/${current.slug}`;
  const sections: {
    href: string;
    label: string;
    icon: IconName;
    count?: number;
    match: (path: string) => boolean;
  }[] =
    current === undefined
      ? []
      : [
          {
            href: base,
            label: "Overview",
            icon: "overview",
            match: (path) => path === base,
          },
          {
            href: `${base}/branches`,
            label: "Branches",
            icon: "branches",
            count: current.openBranches,
            match: (path) => path.startsWith(`${base}/branches`),
          },
          {
            href: `${base}/versions`,
            label: "Main versions",
            icon: "versions",
            match: (path) =>
              path.startsWith(`${base}/versions`) ||
              path.startsWith(`${base}/compare`),
          },
          {
            href: `${base}/diagram`,
            label: "Diagram",
            icon: "diagram",
            match: (path) => path.startsWith(`${base}/diagram`),
          },
          {
            href: `${base}/environments`,
            label: "Databases",
            icon: "databases",
            match: (path) => path.startsWith(`${base}/environments`),
          },
          ...(canManageProjects
            ? [
                {
                  href: `${base}/settings`,
                  label: "Settings",
                  icon: "settings" as const,
                  match: (path: string) => path.startsWith(`${base}/settings`),
                },
              ]
            : []),
        ];

  return (
    <nav className="side-nav" aria-label="Main">
      <ProjectSwitcher
        projects={projects}
        current={current}
        canManageProjects={canManageProjects}
      />
      {current !== undefined && (
        <div className="side-group">
          {sections.map((section) => (
            <Item
              key={section.href}
              href={section.href}
              label={section.label}
              icon={section.icon}
              count={section.count}
              active={section.match(pathname)}
            />
          ))}
        </div>
      )}
      {current === undefined && (
        <div className="side-group">
          <p className="side-empty">
            {canManageProjects
              ? "Create your first project to get started."
              : "Ask an admin to create a project."}
          </p>
          {canManageProjects && (
            <Item
              href="/projects/new"
              label="New project"
              icon="plus"
              active={false}
            />
          )}
        </div>
      )}
      {(canManageMembers || canViewAudit) && (
        <div className="side-group">
          <div className="side-heading">Workspace</div>
          {canManageMembers && (
            <Item
              href="/settings/members"
              label="Members"
              icon="members"
              active={within("/settings/members")}
            />
          )}
          {canViewAudit && (
            <Item
              href="/settings/audit"
              label="Audit log"
              icon="audit"
              active={within("/settings/audit")}
            />
          )}
        </div>
      )}
      <div className="side-user">
        <span className="avatar" aria-hidden>
          {user.name.charAt(0).toUpperCase()}
        </span>
        <div className="side-user-text">
          <strong>{user.name}</strong>
          <span className="hint">{user.role}</span>
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
