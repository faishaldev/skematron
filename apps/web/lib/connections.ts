// Validation and redaction of database connection URLs entered by admins.
// The full URL is only ever stored encrypted; `hint` is what people see.

export class ConnectionUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionUrlError";
  }
}

/**
 * Query parameters allowed in a connection URL. Others are rejected, notably the ones that
 * make the server read local files (sslcert, sslkey, sslrootcert, passfile) or set
 * arbitrary session options.
 */
const ALLOWED_PARAMETERS = new Set([
  "host",
  "port",
  "sslmode",
  "connect_timeout",
  "application_name",
]);

export interface ValidatedConnection {
  url: string;
  /** e.g. `postgresql://app@db.internal:5432/app`, never containing the password. */
  hint: string;
}

export function validateConnectionUrl(input: string): ValidatedConnection {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new ConnectionUrlError(
      "Enter a URL like postgresql://user:password@host:5432/database.",
    );
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new ConnectionUrlError("Only postgresql:// URLs are supported.");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (database === "" || database.includes("/")) {
    throw new ConnectionUrlError(
      "The URL must name exactly one database, e.g. …/mydb.",
    );
  }
  if (url.hostname === "" && !url.searchParams.has("host")) {
    throw new ConnectionUrlError("The URL must include a host.");
  }
  for (const name of url.searchParams.keys()) {
    if (!ALLOWED_PARAMETERS.has(name)) {
      throw new ConnectionUrlError(
        `The URL parameter "${name}" is not allowed. Allowed: ${[...ALLOWED_PARAMETERS].join(", ")}.`,
      );
    }
  }
  return { url: url.toString(), hint: redactConnectionUrl(url.toString()) };
}

/** The URL without its password and query string; a socket directory is shown as `host=`. */
export function redactConnectionUrl(input: string): string {
  const url = new URL(input);
  const user =
    url.username === "" ? "" : `${decodeURIComponent(url.username)}@`;
  const host = url.hostname === "" ? "" : url.hostname;
  const port = url.port === "" ? "" : `:${url.port}`;
  const socket = url.searchParams.get("host");
  return `postgresql://${user}${host}${port}${url.pathname}${socket === null ? "" : ` (socket ${socket})`}`;
}
