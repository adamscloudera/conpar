export type ConnectionClass = 'snowflake' | 'salesforce' | 'redshift' | 'file_path' | 'standard'

const SNOW_SUFFIX_RE = /[_-]snow(flake)?$/i
const SNF_SUFFIX_RE = /[_-]snf$/i
const SNOW_PREFIX_RE = /^snow(flake)?[_-]/i

// Salesforce: bare "SF", "_SF_" segments, "_SFDC_"
const SF_STANDALONE_RE = /^sf(_ds)?$/i
const SF_SEGMENT_RE = /(?:^|[_-])sf(?:dc)?(?:[_-]|$)/i

const REDSHIFT_RE = /[_-]redshift(?:[_-]|$)/i

// File system paths: starts with / or contains drive letter C:\ etc.
const FILE_PATH_RE = /^[/\\]|^[a-zA-Z]:\\/

export function classifyConnectionKey(key: string): ConnectionClass {
  if (!key || key === '_') return 'file_path'
  if (FILE_PATH_RE.test(key)) return 'file_path'
  if (SNOW_SUFFIX_RE.test(key) || SNF_SUFFIX_RE.test(key) || SNOW_PREFIX_RE.test(key)) return 'snowflake'
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
// Pattern: <short-prefix>_<SCHEMA>_snow  e.g. BI_STG_snow → STG
// When no short prefix is detected, returns the key with the snow suffix stripped.
export function snowflakeSchemaHint(key: string): string {
  // Strip trailing _snow / _Snow / _SNOW / _snf suffix
  const stripped = key.replace(SNOW_SUFFIX_RE, '').replace(SNF_SUFFIX_RE, '')
  if (!stripped) return ''

  const parts = stripped.split(/[_-]/)
  // If leading segment is a short prefix (≤3 chars) and more segments follow, strip it.
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
export function uniqueScopeValues(
  impalaRows: Array<{ connectionLogicName: string; databaseName: string }>,
): { values: string[]; mode: 'connection' | 'database' } {
  const connNames = new Set<string>()
  const dbNames = new Set<string>()
  for (const row of impalaRows) {
    if (row.connectionLogicName?.trim()) connNames.add(row.connectionLogicName.trim())
    if (row.databaseName?.trim()) dbNames.add(row.databaseName.trim())
  }
  if (connNames.size > 0) {
    return { values: [...connNames].sort((a, b) => a.localeCompare(b)), mode: 'connection' }
  }
  return { values: [...dbNames].sort((a, b) => a.localeCompare(b)), mode: 'database' }
}
