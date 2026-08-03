export type ConnectionClass = 'snowflake' | 'salesforce' | 'redshift' | 'file_path' | 'standard'
export type TargetTech = 'snowflake' | 'oracle' | 'mysql' | 'standard' | 'na'

const SNOW_SUFFIX_RE = /[_-]snow(flake)?$/i
const SNF_SUFFIX_RE = /[_-]snf$/i
const SNOW_PREFIX_RE = /^snow(flake)?[_-]/i

// Salesforce: bare "SF", "_SF_" segments, "_SFDC_"
const SF_STANDALONE_RE = /^sf(_ds)?$/i
const SF_SEGMENT_RE = /(?:^|[_-])sf(?:dc)?(?:[_-]|$)/i

const REDSHIFT_RE = /[_-]redshift(?:[_-]|$)/i

// File system paths: starts with / or contains drive letter C:\ etc.
const FILE_PATH_RE = /^[/\\]|^[a-zA-Z]:\\/

export function classifyConnectionKey(key: string, knownSnowflakeDb?: string): ConnectionClass {
  if (!key || key === '_') return 'file_path'
  if (FILE_PATH_RE.test(key)) return 'file_path'
  if (SNOW_SUFFIX_RE.test(key) || SNF_SUFFIX_RE.test(key) || SNOW_PREFIX_RE.test(key)) return 'snowflake'
  // DB-prefix pattern: e.g. key=BI_PROD_DBT when knownSnowflakeDb=BI_PROD → snowflake.
  // Minimum DB name length of 5 prevents broad false positives from short names like "PROD".
  if (knownSnowflakeDb && knownSnowflakeDb.length >= 5) {
    if (key.toLowerCase().startsWith(knownSnowflakeDb.toLowerCase() + '_')) return 'snowflake'
  }
  if (REDSHIFT_RE.test(key)) return 'redshift'
  if (SF_STANDALONE_RE.test(key) || SF_SEGMENT_RE.test(key)) return 'salesforce'
  return 'standard'
}

export const CONNECTION_CLASS_LABEL: Record<ConnectionClass, string> = {
  snowflake:   'Snowflake',
  salesforce:  'Salesforce',
  redshift:    'Redshift',
  file_path:   'File path',
  standard:    '',
}

// Derive a Snowflake schema hint from a connection key.
// DB-prefix pattern: key=BI_PROD_DBT + knownSnowflakeDb=BI_PROD → schema=DBT
// Snow-suffix pattern: BI_STG_snow → STG (strips short leading prefix ≤3 chars)
export function snowflakeSchemaHint(key: string, knownSnowflakeDb?: string): string {
  // DB-prefix: strip {DB}_ and return remainder when key starts with the known Snowflake DB.
  if (knownSnowflakeDb && knownSnowflakeDb.length >= 5) {
    const prefix = knownSnowflakeDb + '_'
    if (key.toLowerCase().startsWith(prefix.toLowerCase())) {
      return key.slice(prefix.length).toUpperCase()
    }
  }

  // Snow-suffix: strip trailing _snow / _snf, then strip short leading prefix.
  const stripped = key.replace(SNOW_SUFFIX_RE, '').replace(SNF_SUFFIX_RE, '')
  if (!stripped) return ''

  const parts = stripped.split(/[_-]/)
  if (parts.length >= 2 && parts[0].length <= 3) {
    return parts.slice(1).join('_').toUpperCase()
  }
  return stripped.toUpperCase()
}

// Scan api_lookup discovery rows for the most common databaseName tied to a
// Snowflake connection. When explicitConnectionName is provided, matches that
// exact name (case-insensitive). Otherwise auto-detects by /snow/i on the name.
export function snowflakeDbFromApiRows(
  impalaRows: Array<{ databaseName: string; connectionLogicName: string }>,
  explicitConnectionName?: string | null,
): string {
  const matchFn = explicitConnectionName
    ? (name: string) => name.toLowerCase() === explicitConnectionName.toLowerCase()
    : (name: string) => /snow/i.test(name)
  const counts = new Map<string, number>()
  for (const row of impalaRows) {
    if (!matchFn(row.connectionLogicName)) continue
    const db = row.databaseName?.trim()
    if (!db || db === '-1') continue
    counts.set(db, (counts.get(db) ?? 0) + 1)
  }
  if (!counts.size) return ''
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

// Human-readable labels for Octopai toolName identifiers.
const TOOL_NAME_LABEL: Record<string, string> = {
  SNOWFLAKE:           'Snowflake',
  ORACLE:              'Oracle',
  INFORMATICA_CLOUD:   'Informatica Cloud',
  INFORMATICA:         'Informatica',
  EEOBIEE:             'OBI EE',
  MSSQL:               'SQL Server',
  MYSQL:               'MySQL',
  POSTGRESQL:          'PostgreSQL',
  REDSHIFT:            'Redshift',
  BIGQUERY:            'BigQuery',
  TABLEAU:             'Tableau',
  POWERBI:             'Power BI',
  EXCELFILE:           'Excel',
  DBT:                 'dbt',
  SAP:                 'SAP',
  SAPHANA:             'SAP HANA',
}

// When toolName === 'UNK' or empty, try to infer the tool from the connection name.
function inferToolFromConnLogicName(name: string): string {
  const n = name.toLowerCase()
  if (/snow(flake)?/.test(n)) return 'SNOWFLAKE'
  if (/oracle/.test(n)) return 'ORACLE'
  if (/iics|informatica/.test(n)) return 'INFORMATICA_CLOUD'
  if (/obiee|oracle.?bi/.test(n)) return 'EEOBIEE'
  if (/\bdbt\b/.test(n)) return 'DBT'
  if (/redshift/.test(n)) return 'REDSHIFT'
  if (/bigquery/.test(n)) return 'BIGQUERY'
  if (/tableau/.test(n)) return 'TABLEAU'
  if (/power.?bi|pbix/.test(n)) return 'POWERBI'
  if (/sql.?server|mssql/.test(n)) return 'MSSQL'
  if (/mysql/.test(n)) return 'MYSQL'
  if (/postgres/.test(n)) return 'POSTGRESQL'
  if (/sap.?hana/.test(n)) return 'SAPHANA'
  if (/\bsap\b/.test(n)) return 'SAP'
  return 'UNK'
}

// Resolve the display tool name: use toolName when known, infer from connLogicName otherwise.
export function resolveToolName(toolName: string, connLogicName: string): string {
  if (toolName && toolName !== 'UNK') return toolName
  return inferToolFromConnLogicName(connLogicName)
}

// Return the human-readable label for a resolved tool name, or '' if unknown.
export function toolLabel(toolName: string, connLogicName: string): string {
  return TOOL_NAME_LABEL[resolveToolName(toolName, connLogicName)] ?? ''
}

// Parse a dot-separated fully-qualified key of the form DB.schema.connectionName.
// Returns {database, schema} when the key has ≥3 dot-separated segments and the
// first two segments are non-empty identifiers. 2-part keys are not parsed because
// the second segment may be either a schema or a connection name — ambiguous.
export function parseFullyQualifiedKey(key: string): { database: string; schema: string } | null {
  if (!key || !key.includes('.')) return null
  const parts = key.split('.')
  if (parts.length < 3) return null
  const database = parts[0].trim()
  const schema = parts[1].trim()
  if (!database || !schema) return null
  return { database, schema }
}

// Classify a connection key by the target technology it addresses.
// Used to group rows into technology tabs in the review grid.
export function classifyTargetTech(key: string, knownSnowflakeDb?: string): TargetTech {
  const cls = classifyConnectionKey(key, knownSnowflakeDb)
  if (cls === 'salesforce' || cls === 'redshift' || cls === 'file_path') return 'na'
  if (cls === 'snowflake') return 'snowflake'
  if (/oracle/i.test(key)) return 'oracle'
  if (/mysql/i.test(key)) return 'mysql'
  // 3-part fully-qualified keys without explicit tool suffix default to oracle
  // (only pattern seen in practice for IICS → relational DB templates)
  if (parseFullyQualifiedKey(key) !== null) return 'oracle'
  return 'standard'
}

// Return all unique connectionLogicName values from api_lookup rows, sorted.
export function uniqueConnectionNames(
  impalaRows: Array<{ connectionLogicName: string }>,
): string[] {
  const names = new Set<string>()
  for (const row of impalaRows) {
    if (row.connectionLogicName?.trim()) names.add(row.connectionLogicName.trim())
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

// Return unique scope values for the Quick Assign / per-key dropdowns.
// Prefers connectionLogicName; falls back to databaseName when no connection
// names are present (e.g. tenants whose API omits connLogicName on assets).
// toolLabels maps each connection/database name to a human-readable tool label.
export function uniqueScopeValues(
  impalaRows: Array<{ connectionLogicName: string; databaseName: string; toolName: string }>,
): { values: string[]; mode: 'connection' | 'database'; toolLabels: Record<string, string> } {
  // Track first toolName seen per connection (first row wins; all rows for a
  // given connection share the same tool so any representative row is fine).
  const connMap = new Map<string, string>() // connName → toolName
  const dbNames = new Set<string>()
  for (const row of impalaRows) {
    if (row.connectionLogicName?.trim()) {
      const name = row.connectionLogicName.trim()
      if (!connMap.has(name)) connMap.set(name, row.toolName ?? '')
    }
    if (row.databaseName?.trim()) dbNames.add(row.databaseName.trim())
  }
  if (connMap.size > 0) {
    const values = [...connMap.keys()].sort((a, b) => a.localeCompare(b))
    const labels: Record<string, string> = {}
    for (const [name, tName] of connMap) {
      const label = toolLabel(tName, name)
      if (label) labels[name] = label
    }
    return { values, mode: 'connection', toolLabels: labels }
  }
  return { values: [...dbNames].sort((a, b) => a.localeCompare(b)), mode: 'database', toolLabels: {} }
}
