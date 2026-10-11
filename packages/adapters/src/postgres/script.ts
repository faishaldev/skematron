// SQL scripts as people upload them: schema dumps, ORM exports and migration files.
//
// The splitter follows psql's rules, so a script that psql runs splits the same way:
// quotes, dollar quotes, nested comments, parentheses, and BEGIN ATOMIC function bodies.
// Then each statement is sorted:
// - run it;
// - skip it, when it cannot change the schema Skematron tracks: ownership, privileges,
//   psql's own commands, time limits, rows of a migration tool's history table;
// - or refuse the script, when a statement acts outside one database (databases, roles,
//   tablespaces) or moves rows (COPY).
//
// This only reads text. Running the statements is up to the caller, in a disposable
// database: the refusals give clear messages, they are not a sandbox.
import { migrationHistoryTool } from "../migration-history.ts";

export interface ScriptStatement {
  /** The statement as written, from its first token, without the closing semicolon. */
  sql: string;
  /** The 1-based line it starts on. */
  line: number;
}

export interface SkippedStatement extends ScriptStatement {
  reason: string;
}

export interface PreparedScript {
  /** The statements to run, in order, one at a time. */
  statements: ScriptStatement[];
  skipped: SkippedStatement[];
}

export class SqlScriptError extends Error {
  readonly line: number;

  constructor(message: string, line: number) {
    super(`Line ${line}: ${message}`);
    this.name = "SqlScriptError";
    this.line = line;
  }
}

export interface ScriptPiece extends ScriptStatement {
  /** A psql meta-command (`\restrict`, `\connect`), not SQL. */
  meta: boolean;
}

const SPACE = /\s/;
const IDENTIFIER_START = /[A-Za-z_\u0080-￿]/;
const IDENTIFIER_PART = /[A-Za-z0-9_$\u0080-￿]/;
const DOLLAR_TAG = /\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/y;

/** Splits a script into statements and psql meta-commands, as psql would. */
export function splitPostgresScript(text: string): ScriptPiece[] {
  const pieces: ScriptPiece[] = [];
  let index = 0;
  let line = 1;
  // The current statement: where its first token starts, and what it has opened.
  let start = -1;
  let startLine = 0;
  let parentheses = 0;
  let blocks = 0;
  let words: string[] = [];

  const finish = (end: number) => {
    if (start >= 0) {
      pieces.push({
        sql: text.slice(start, end).trimEnd(),
        line: startLine,
        meta: false,
      });
    }
    start = -1;
    parentheses = 0;
    blocks = 0;
    words = [];
  };

  /** Skips a quoted string or identifier; returns the index after the closing quote. */
  const skipQuoted = (open: number, quote: string, backslashes: boolean) => {
    const openedOn = line;
    let at = open + 1;
    for (;;) {
      if (at >= text.length) {
        throw new SqlScriptError(
          quote === '"'
            ? "A quoted identifier is never closed."
            : "A quoted string is never closed.",
          openedOn,
        );
      }
      const char = text[at]!;
      if (char === "\n") line += 1;
      if (backslashes && char === "\\") {
        if (text[at + 1] === "\n") line += 1;
        at += 2;
      } else if (char === quote) {
        if (text[at + 1] !== quote) return at + 1;
        at += 2;
      } else {
        at += 1;
      }
    }
  };

  // CREATE FUNCTION and CREATE PROCEDURE may have a BEGIN ATOMIC ... END body with
  // semicolons inside; like psql, count BEGIN and CASE against END in those statements.
  const isRoutine = () => {
    const [first, second, third, fourth] = words;
    if (first !== "create") return false;
    const kind = second === "or" && third === "replace" ? fourth : second;
    return kind === "function" || kind === "procedure";
  };

  while (index < text.length) {
    const char = text[index]!;
    const next = text[index + 1];
    if (char === "\n") {
      line += 1;
      index += 1;
      continue;
    }
    if (SPACE.test(char)) {
      index += 1;
      continue;
    }
    if (char === "-" && next === "-") {
      const end = text.indexOf("\n", index);
      index = end < 0 ? text.length : end;
      continue;
    }
    if (char === "/" && next === "*") {
      const openedOn = line;
      let depth = 1;
      index += 2;
      while (depth > 0) {
        if (index >= text.length) {
          throw new SqlScriptError("A /* comment is never closed.", openedOn);
        }
        if (text.startsWith("/*", index)) {
          depth += 1;
          index += 2;
        } else if (text.startsWith("*/", index)) {
          depth -= 1;
          index += 2;
        } else {
          if (text[index] === "\n") line += 1;
          index += 1;
        }
      }
      continue;
    }
    if (char === "\\" && start < 0) {
      const end = text.indexOf("\n", index);
      const stop = end < 0 ? text.length : end;
      pieces.push({ sql: text.slice(index, stop).trim(), line, meta: true });
      index = stop;
      continue;
    }
    if (start < 0) {
      start = index;
      startLine = line;
    }
    if (char === ";") {
      if (parentheses === 0 && blocks === 0) {
        finish(index);
      }
      index += 1;
      continue;
    }
    if (char === "(") {
      parentheses += 1;
      index += 1;
      continue;
    }
    if (char === ")") {
      parentheses = Math.max(0, parentheses - 1);
      index += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      index = skipQuoted(index, char, false);
      continue;
    }
    if (char === "$" && !IDENTIFIER_PART.test(text[index - 1] ?? " ")) {
      DOLLAR_TAG.lastIndex = index;
      const tag = DOLLAR_TAG.exec(text)?.[0];
      if (tag !== undefined) {
        const close = text.indexOf(tag, index + tag.length);
        if (close < 0) {
          throw new SqlScriptError(
            `A ${tag}-quoted string is never closed.`,
            line,
          );
        }
        for (let at = index; at < close; at += 1) {
          if (text[at] === "\n") line += 1;
        }
        index = close + tag.length;
        continue;
      }
    }
    if (IDENTIFIER_START.test(char)) {
      let end = index + 1;
      while (end < text.length && IDENTIFIER_PART.test(text[end]!)) end += 1;
      const word = text.slice(index, end).toLowerCase();
      // E'...' strings use backslash escapes.
      if (word === "e" && text[end] === "'") {
        index = skipQuoted(end, "'", true);
        continue;
      }
      if (words.length < 4) words.push(word);
      if (isRoutine()) {
        if (word === "begin" || word === "case") blocks += 1;
        if (word === "end") blocks = Math.max(0, blocks - 1);
      }
      index = end;
      continue;
    }
    index += 1;
  }
  finish(text.length);
  return pieces;
}

// psql commands that only set up psql itself. Anything else (\connect, \i, \copy) would
// change what the script means, so the script is refused.
const HARMLESS_META = new Set([
  "restrict",
  "unrestrict",
  "set",
  "unset",
  "echo",
  "qecho",
  "pset",
  "timing",
  "encoding",
]);

const REFUSED: readonly { pattern: RegExp; message: string }[] = [
  {
    pattern: /^copy\b/,
    message:
      "COPY moves rows, and Skematron takes schemas without data. For pg_dump, add --schema-only.",
  },
  {
    pattern: /^(?:create|alter|drop) database\b/,
    message:
      "The script creates or changes a whole database. Upload the schema of one database (for pg_dump, leave out --create).",
  },
  {
    pattern:
      /^(?:(?:create|alter|drop) (?:role|user|group|tablespace|subscription)|alter system|reassign owned|drop owned|load)\b/,
    message:
      "The script changes the server (roles, tablespaces or settings), which is not part of a schema. Remove that statement.",
  },
];

const PRIVILEGES = /^(?:grant|revoke|alter default privileges)\b/;
const ROLE_SWITCH =
  /^(?:set (?:session |local )?(?:role|session authorization)|reset (?:role|session authorization))\b/;
const TIME_LIMIT =
  /^(?:set (?:session |local )?|reset )(?:statement_timeout|lock_timeout|idle_in_transaction_session_timeout|idle_session_timeout|transaction_timeout)\b/;
const OWNER_TO = /^alter .* owner to (?:"(?:[^"]|"")+"|[^\s"]+)$/;
// Snapshots keep no comments on schemas or extensions, and changing them needs ownership
// a disposable database's role may not have (PostgreSQL 14's public schema).
const UNTRACKED_COMMENT = /^comment on (?:schema|extension)\b/;
const HISTORY_ROWS =
  /^\s*(?:insert\s+into|update|delete\s+from)\s+(?:only\s+)?(?:(?:"(?:[^"]|"")+"|[\w$]+)\s*\.\s*)?(?:"((?:[^"]|"")+)"|([\w$]+))/i;

/** Why a statement can be skipped, or null to run it. Throws for a refused statement. */
function classify(statement: ScriptStatement): string | null {
  const head = statement.sql.replace(/\s+/g, " ").toLowerCase();
  for (const refused of REFUSED) {
    if (refused.pattern.test(head)) {
      throw new SqlScriptError(refused.message, statement.line);
    }
  }
  if (PRIVILEGES.test(head)) return "privileges";
  if (ROLE_SWITCH.test(head)) return "ownership";
  // Only a plain `ALTER <object> OWNER TO <role>`: not a rename to a column called
  // owner, and not an ALTER TABLE with more actions (commas outside parentheses).
  const actions = head.replace(/\([^()]*\)/g, "");
  if (
    OWNER_TO.test(head) &&
    !/\brename\b/.test(head) &&
    !actions.includes(",")
  ) {
    return "ownership";
  }
  if (TIME_LIMIT.test(head)) return "time limit (Skematron's own limits apply)";
  if (UNTRACKED_COMMENT.test(head)) return "comment Skematron does not track";
  const rows = HISTORY_ROWS.exec(statement.sql);
  if (rows !== null) {
    const table =
      rows[1] !== undefined
        ? rows[1].replaceAll('""', '"')
        : rows[2]!.toLowerCase();
    const tool = migrationHistoryTool(table);
    if (tool !== null) return `${tool} migration history`;
  }
  return null;
}

/**
 * Splits a script and sorts its statements into those to run and those to skip.
 * Throws SqlScriptError, with the line, for a script that cannot run in a single
 * disposable database.
 */
export function preparePostgresScript(text: string): PreparedScript {
  const statements: ScriptStatement[] = [];
  const skipped: SkippedStatement[] = [];
  for (const piece of splitPostgresScript(text)) {
    const statement = { sql: piece.sql, line: piece.line };
    if (piece.meta) {
      const command = /^\\([A-Za-z!?]*)/.exec(piece.sql)?.[1] ?? "";
      if (!HARMLESS_META.has(command)) {
        throw new SqlScriptError(
          `The psql command \\${command} cannot run here. Upload plain SQL for one database.`,
          piece.line,
        );
      }
      skipped.push({ ...statement, reason: "psql command" });
      continue;
    }
    const reason = classify(statement);
    if (reason === null) statements.push(statement);
    else skipped.push({ ...statement, reason });
  }
  return { statements, skipped };
}
