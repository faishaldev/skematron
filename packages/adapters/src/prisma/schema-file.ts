// Prisma Schema (schema-tool adapter): prepares an uploaded `schema.prisma` for Prisma's own
// CLI. Skematron does not parse models itself; `prisma migrate diff` turns the file into DDL.
// This module only finds the top-level blocks, checks the datasource, and removes connection
// URLs, which Prisma 7 rejects in schema files and which never belong in a stored artifact.

export class PrismaSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrismaSchemaError";
  }
}

export interface PreparedPrismaSchema {
  /**
   * The schema to give `prisma migrate diff`. Removed properties become blank
   * lines, so line numbers in Prisma's messages still match the original file.
   */
  schema: string;
  provider: "postgresql";
  /** Datasource properties that were removed, in file order. */
  removed: string[];
}

/** Datasource properties that hold connection URLs. */
const CONNECTION_PROPERTIES = new Set([
  "url",
  "directUrl",
  "shadowDatabaseUrl",
]);
const POSTGRES_PROVIDERS = new Set(["postgresql", "postgres"]);

interface Block {
  keyword: string;
  name: string;
  /** Line indexes of the header and the closing brace. */
  start: number;
  end: number;
}

/**
 * Checks that the schema has exactly one PostgreSQL datasource and removes its
 * connection URLs. Everything else, generators included, is kept as written:
 * generators carry preview features that the schema may depend on, and
 * `migrate diff` never runs them.
 */
export function preparePrismaSchema(text: string): PreparedPrismaSchema {
  if (text.includes("\0"))
    throw new PrismaSchemaError("The schema contains a NUL character.");
  const lines = text.split("\n");
  const blocks = findBlocks(lines);
  const datasources = blocks.filter((block) => block.keyword === "datasource");
  if (datasources.length !== 1) {
    throw new PrismaSchemaError(
      datasources.length === 0
        ? "The schema has no datasource block."
        : `The schema has ${datasources.length} datasource blocks; exactly one is supported.`,
    );
  }
  const datasource = datasources[0]!;
  if (datasource.start === datasource.end) {
    throw new PrismaSchemaError(
      "Put each property of the datasource block on its own line.",
    );
  }

  const removed: string[] = [];
  let provider: string | null = null;
  for (let index = datasource.start + 1; index < datasource.end; index += 1) {
    const property = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(
      code(lines[index]!),
    );
    if (property === null) continue;
    const key = property[1]!;
    if (key === "provider") {
      provider = /=\s*"([^"\\]*)"/.exec(lines[index]!)?.[1] ?? "";
    } else if (CONNECTION_PROPERTIES.has(key)) {
      removed.push(key);
      lines[index] = lines[index]!.endsWith("\r") ? "\r" : "";
    }
  }
  if (provider === null) {
    throw new PrismaSchemaError(
      `Datasource "${datasource.name}" has no provider.`,
    );
  }
  if (!POSTGRES_PROVIDERS.has(provider)) {
    throw new PrismaSchemaError(
      `Only PostgreSQL schemas are supported; datasource "${datasource.name}" uses ${JSON.stringify(provider)}.`,
    );
  }
  return { schema: lines.join("\n"), provider: "postgresql", removed };
}

const HEADER =
  /^\s*(datasource|generator|model|enum|view|type)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/;

/** Finds top-level blocks by counting braces outside strings and comments. */
function findBlocks(lines: readonly string[]): Block[] {
  const blocks: Block[] = [];
  let depth = 0;
  let open: Omit<Block, "end"> | null = null;
  for (const [index, line] of lines.entries()) {
    const source = code(line);
    if (depth === 0) {
      const header = HEADER.exec(source);
      if (header !== null) {
        open = { keyword: header[1]!, name: header[2]!, start: index };
      } else if (source.trim() !== "") {
        throw new PrismaSchemaError(
          `Line ${index + 1} is outside any block: ${JSON.stringify(line.trim().slice(0, 60))}.`,
        );
      }
    }
    for (const character of source) {
      if (character === "{") depth += 1;
      if (character === "}") depth -= 1;
      if (depth < 0)
        throw new PrismaSchemaError(
          `Line ${index + 1} closes an unopened block.`,
        );
    }
    if (depth === 0 && open !== null) {
      blocks.push({ ...open, end: index });
      open = null;
    }
  }
  if (depth !== 0) throw new PrismaSchemaError("A block is never closed.");
  return blocks;
}

/** The line without comments, and with string contents blanked out. */
function code(line: string): string {
  let result = "";
  let inString = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (inString) {
      if (character === "\\") {
        index += 1;
        result += "  ";
      } else if (character === '"') {
        inString = false;
        result += character;
      } else {
        result += " ";
      }
    } else if (character === '"') {
      inString = true;
      result += character;
    } else if (character === "/" && line[index + 1] === "/") {
      break;
    } else {
      result += character;
    }
  }
  return result;
}
