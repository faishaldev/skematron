/** Always double-quotes, so case and reserved words are preserved exactly. */
export function quoteIdent(name: string): string {
  if (name.length === 0)
    throw new Error("PostgreSQL identifiers cannot be empty.");
  if (name.includes("\0"))
    throw new Error("PostgreSQL identifiers cannot contain NUL.");
  return `"${name.replaceAll('"', '""')}"`;
}

export function quoteQualified(...parts: string[]): string {
  return parts.map(quoteIdent).join(".");
}

/**
 * Like PostgreSQL's quote_literal: quotes are doubled, and a value containing
 * backslashes becomes an E'' string so it means the same thing whatever
 * standard_conforming_strings is set to.
 */
export function quoteLiteral(value: string): string {
  if (value.includes("\0"))
    throw new Error("PostgreSQL strings cannot contain NUL.");
  const quoted = value.replaceAll("'", "''");
  return value.includes("\\")
    ? `E'${quoted.replaceAll("\\", "\\\\")}'`
    : `'${quoted}'`;
}

/**
 * Makes text safe to place after `--`. A line break would end the comment and
 * turn the rest of the text into SQL, so line breaks become spaces.
 */
export function commentText(text: string): string {
  return text.replace(/[\r\n]+/g, " ");
}
