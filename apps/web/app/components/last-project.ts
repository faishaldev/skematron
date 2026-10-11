// Shared by the server layout and the client sidebar. It lives outside the "use client"
// module on purpose: a server component that imports a value from a client module gets a
// client reference, not the value.

/** Holds only a project slug; the layout checks it against the member's projects. */
export const LAST_PROJECT_COOKIE = "skematron_last_project";
