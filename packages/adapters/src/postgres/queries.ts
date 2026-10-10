// Catalog queries for PostgreSQL 14+. They read only pg_catalog, never table rows.
//
// Conventions:
// - Each query starts with a `/* skematron:<name> */` marker (used by tests and visible in pg_stat_activity).
// - Every column is cast to text, int4 or bool, and lists are returned as JSON text,
//   so results do not depend on a driver's type parsing.
// - Version-specific catalog columns are gated in the query builders below.
// - Names are filtered to user namespaces; objects that belong to extensions are skipped.

/** Excludes system schemas (names starting with pg_ are reserved) and schemas owned by extensions. */
function userNamespace(alias: string): string {
  return `${alias}.nspname <> 'information_schema'
    AND ${alias}.nspname NOT LIKE 'pg\\_%'
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.classid = 'pg_namespace'::regclass AND d.objid = ${alias}.oid AND d.deptype = 'e'
    )`;
}

function notExtensionMember(catalog: string, oid: string): string {
  return `NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.classid = '${catalog}'::regclass AND d.objid = ${oid} AND d.deptype = 'e'
    )`;
}

/**
 * Pins every setting that changes how the catalog prints names and constants,
 * so the same schema always produces the same snapshot. Transaction-local.
 */
export function sessionSettingsQuery(statementTimeoutMs: number): string {
  if (!Number.isSafeInteger(statementTimeoutMs) || statementTimeoutMs <= 0) {
    throw new RangeError("statementTimeoutMs must be a positive integer.");
  }
  return `/* skematron:settings */
SELECT pg_catalog.set_config('search_path', '', true),
       pg_catalog.set_config('statement_timeout', '${statementTimeoutMs}', true),
       pg_catalog.set_config('standard_conforming_strings', 'on', true),
       pg_catalog.set_config('quote_all_identifiers', 'off', true),
       pg_catalog.set_config('DateStyle', 'ISO, YMD', true),
       pg_catalog.set_config('IntervalStyle', 'postgres', true),
       pg_catalog.set_config('TimeZone', 'UTC', true),
       pg_catalog.set_config('extra_float_digits', '1', true),
       pg_catalog.set_config('bytea_output', 'hex', true)`;
}

export const VERSION_QUERY = `/* skematron:version */
SELECT current_setting('server_version_num')::int4 AS version_num,
       current_setting('server_version')::text AS version`;

export const NAMESPACES_QUERY = `/* skematron:namespaces */
SELECT n.nspname::text AS name
FROM pg_namespace n
WHERE ${userNamespace("n")}`;

export const RELATIONS_QUERY = `/* skematron:relations */
SELECT n.nspname::text AS namespace,
       c.relname::text AS name,
       c.relkind::text AS kind,
       c.relpersistence::text AS persistence,
       c.relispartition AS is_partition,
       c.relrowsecurity AS row_security,
       EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.oid) AS inherits,
       obj_description(c.oid, 'pg_class')::text AS comment
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f', 'c')
  AND ${userNamespace("n")}
  AND ${notExtensionMember("pg_class", "c.oid")}`;

export const COLUMNS_QUERY = `/* skematron:columns */
SELECT n.nspname::text AS namespace,
       c.relname::text AS table_name,
       a.attname::text AS name,
       a.attnum::int4 AS position,
       format_type(a.atttypid, a.atttypmod)::text AS type,
       a.attnotnull AS not_null,
       a.attidentity::text AS identity,
       a.attgenerated::text AS generated,
       pg_get_expr(ad.adbin, ad.adrelid)::text AS default_expression,
       CASE WHEN a.attcollation <> 0 AND a.attcollation <> t.typcollation
            THEN quote_ident(cn.nspname) || '.' || quote_ident(co.collname)
       END::text AS collation,
       col_description(c.oid, a.attnum::int4)::text AS comment
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_type t ON t.oid = a.atttypid
LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
LEFT JOIN pg_collation co ON co.oid = a.attcollation
LEFT JOIN pg_namespace cn ON cn.oid = co.collnamespace
WHERE c.relkind = 'r'
  AND a.attnum > 0
  AND NOT a.attisdropped
  AND ${userNamespace("n")}
  AND ${notExtensionMember("pg_class", "c.oid")}`;

export function constraintsQuery(serverVersionNum: number): string {
  const pg15 = serverVersionNum >= 150000;
  return `/* skematron:constraints */
SELECT n.nspname::text AS namespace,
       c.relname::text AS table_name,
       con.conname::text AS name,
       con.contype::text AS type,
       (SELECT json_agg(a.attname::text ORDER BY k.ord)
          FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum)::text AS columns,
       rn.nspname::text AS ref_namespace,
       rc.relname::text AS ref_table,
       (SELECT json_agg(a.attname::text ORDER BY k.ord)
          FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum)::text AS ref_columns,
       con.confupdtype::text AS on_update,
       con.confdeltype::text AS on_delete,
       con.confmatchtype::text AS match_type,
       con.condeferrable AS deferrable,
       con.condeferred AS deferred,
       CASE WHEN con.contype = 'c' THEN pg_get_expr(con.conbin, con.conrelid) END::text AS check_expression,
       con.connoinherit AS no_inherit,
       ${pg15 ? "COALESCE(ix.indnullsnotdistinct, false)" : "false"} AS nulls_not_distinct,
       ${pg15 ? "con.confdelsetcols IS NOT NULL" : "false"} AS has_delete_set_columns
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_class rc ON rc.oid = con.confrelid
LEFT JOIN pg_namespace rn ON rn.oid = rc.relnamespace
LEFT JOIN pg_index ix ON ix.indexrelid = con.conindid
WHERE c.relkind = 'r'
  AND ${userNamespace("n")}
  AND ${notExtensionMember("pg_class", "c.oid")}`;
}

/** Indexes that do not back a primary key, unique or exclusion constraint. */
export const INDEXES_QUERY = `/* skematron:indexes */
SELECT n.nspname::text AS namespace,
       c.relname::text AS table_name,
       ic.relname::text AS name,
       i.indisunique AS is_unique,
       i.indisvalid AS is_valid,
       pg_get_indexdef(i.indexrelid)::text AS definition
FROM pg_index i
JOIN pg_class ic ON ic.oid = i.indexrelid
JOIN pg_class c ON c.oid = i.indrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND ${userNamespace("n")}
  AND ${notExtensionMember("pg_class", "c.oid")}
  AND NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    WHERE con.conindid = i.indexrelid AND con.contype IN ('p', 'u', 'x')
  )`;

export const ENUMS_QUERY = `/* skematron:enums */
SELECT n.nspname::text AS namespace,
       t.typname::text AS name,
       (SELECT json_agg(e.enumlabel::text ORDER BY e.enumsortorder)
          FROM pg_enum e WHERE e.enumtypid = t.oid)::text AS labels
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE t.typtype = 'e'
  AND ${userNamespace("n")}
  AND ${notExtensionMember("pg_type", "t.oid")}`;

/** Includes the owning column: deptype 'a' is OWNED BY (serial), 'i' is an identity column's sequence. */
export const SEQUENCES_QUERY = `/* skematron:sequences */
SELECT n.nspname::text AS namespace,
       c.relname::text AS name,
       format_type(s.seqtypid, NULL)::text AS data_type,
       s.seqstart::text AS start,
       s.seqincrement::text AS increment,
       s.seqmin::text AS min_value,
       s.seqmax::text AS max_value,
       s.seqcache::text AS cache,
       s.seqcycle AS cycle,
       d.deptype::text AS owner_dependency,
       oc.relname::text AS owner_table,
       oa.attname::text AS owner_column
FROM pg_sequence s
JOIN pg_class c ON c.oid = s.seqrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_depend d ON d.classid = 'pg_class'::regclass AND d.objid = c.oid
  AND d.refclassid = 'pg_class'::regclass AND d.refobjsubid > 0 AND d.deptype IN ('a', 'i')
LEFT JOIN pg_class oc ON oc.oid = d.refobjid
LEFT JOIN pg_attribute oa ON oa.attrelid = d.refobjid AND oa.attnum = d.refobjsubid
WHERE ${userNamespace("n")}
  AND ${notExtensionMember("pg_class", "c.oid")}`;

/** Objects Skematron does not capture, listed so they can be reported instead of silently dropped. */
export const OTHER_OBJECTS_QUERY = `/* skematron:other-objects */
SELECT CASE p.prokind WHEN 'p' THEN 'procedure' WHEN 'a' THEN 'aggregate' WHEN 'w' THEN 'window-function' ELSE 'function' END AS kind,
       n.nspname::text AS namespace,
       NULL::text AS table_name,
       (p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')')::text AS name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE ${userNamespace("n")} AND ${notExtensionMember("pg_proc", "p.oid")}
UNION ALL
SELECT 'trigger', n.nspname::text, c.relname::text, t.tgname::text
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal AND ${userNamespace("n")} AND ${notExtensionMember("pg_class", "c.oid")}
UNION ALL
SELECT 'rule', n.nspname::text, c.relname::text, r.rulename::text
FROM pg_rewrite r
JOIN pg_class c ON c.oid = r.ev_class
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE r.rulename <> '_RETURN' AND ${userNamespace("n")} AND ${notExtensionMember("pg_class", "c.oid")}
UNION ALL
SELECT 'policy', n.nspname::text, c.relname::text, p.polname::text
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE ${userNamespace("n")} AND ${notExtensionMember("pg_class", "c.oid")}
UNION ALL
SELECT CASE t.typtype WHEN 'd' THEN 'domain' WHEN 'r' THEN 'range-type' ELSE 'base-type' END,
       n.nspname::text, NULL::text, t.typname::text
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE (t.typtype IN ('d', 'r') OR (t.typtype = 'b' AND t.typcategory <> 'A'))
  AND ${userNamespace("n")} AND ${notExtensionMember("pg_type", "t.oid")}
UNION ALL
SELECT 'collation', n.nspname::text, NULL::text, co.collname::text
FROM pg_collation co
JOIN pg_namespace n ON n.oid = co.collnamespace
WHERE ${userNamespace("n")} AND ${notExtensionMember("pg_collation", "co.oid")}
UNION ALL
SELECT 'extension', n.nspname::text, NULL::text, e.extname::text
FROM pg_extension e
JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE ${userNamespace("n")}`;
