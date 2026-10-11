// Checks for what people type into the schema editor. Everything is normalized in the
// shadow database afterwards; these only keep typed fragments to what a name, type or
// default can look like, so no input can add statements or comments. Pure; see policy.test.ts.
import type { ReferentialAction } from "@skematron/core";

/** Its messages are safe to show (see errors.ts). */
export class SchemaInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaInputError";
  }
}

export function identifier(value: string, what: string): string {
  const name = value.trim();
  if (name === "" || Buffer.byteLength(name) > 63 || name.includes("\0")) {
    throw new SchemaInputError(`${what} must be 1 to 63 bytes long.`);
  }
  return name;
}

const NAME = String.raw`(?:"[^"\0]+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const TYPE = new RegExp(
  String.raw`^${NAME}(?:\.${NAME})?(?: [A-Za-z]+)*(?:\(\d+(?:, ?\d+)?\))?(?: [A-Za-z]+)*(?:\[\])*$`,
);

/** A type as SQL: `text`, `numeric(10,2)`, `timestamp with time zone`, `app.status`, `text[]`. */
export function sqlType(value: string): string {
  const type = value.trim().replace(/\s+/g, " ");
  if (type.length > 100 || !TYPE.test(type)) {
    throw new SchemaInputError(
      `${JSON.stringify(value.trim())} is not a type Skematron accepts, e.g. text, bigint, numeric(10,2), timestamp with time zone.`,
    );
  }
  return type;
}

/** A default expression as SQL, or null. No statement separators or comments. */
export function sqlDefault(value: string): string | null {
  const expression = value.trim();
  if (expression === "") return null;
  if (
    expression.length > 500 ||
    /[;\0]/.test(expression) ||
    expression.includes("--") ||
    expression.includes("/*")
  ) {
    throw new SchemaInputError(
      "A default is one SQL expression, e.g. 0, 'draft', now(); without ; or comments.",
    );
  }
  return expression;
}

/** "a, b" → ["a", "b"]. Empty is allowed only when `optional`. */
export function columnNames(
  value: string,
  what: string,
  optional = false,
): string[] {
  const names = value
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length === 0 && !optional) {
    throw new SchemaInputError(`List the ${what}, separated by commas.`);
  }
  return names.map((name) => identifier(name, "A column name"));
}

const REFERENTIAL_ACTIONS: readonly ReferentialAction[] = [
  "no-action",
  "restrict",
  "cascade",
  "set-null",
  "set-default",
];

export function referentialAction(value: string): ReferentialAction {
  const action = REFERENTIAL_ACTIONS.find((candidate) => candidate === value);
  if (action === undefined)
    throw new SchemaInputError("Choose what happens on delete.");
  return action;
}
