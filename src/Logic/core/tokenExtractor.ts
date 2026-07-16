const STOP_WORDS = new Set([
  'PUBLIC', 'OBJECTS', 'REPORTS', 'REPORT', 'COPIA', 'DE', 'DEL',
  'OLD', 'NEW', 'COPY', 'PRUEBA', 'BULK', 'INFORME', 'INF',
  'CONSULTA', 'AND', 'OR', 'FOR', 'WITH', 'FROM', 'THE',
  'VIEW', 'TABLE', 'SCHEMA', 'DATABASE', 'DATA',
])

const VERSION_RE = /^V\d+$/
const PURE_NUMBER_RE = /^\d+$/
const MIN_TOKEN_LEN = 3

export function canonicalToken(v: string): string {
  return v.trim().replace(/^["'`]+|["'`]+$/g, '').replace(/\s+/g, ' ').toUpperCase()
}

export function extractPathTokens(path: string): string[] {
  const segments = path.split(/[\\\/]/)
  const seen = new Set<string>()
  const tokens: string[] = []
  for (const seg of segments) {
    const parts = seg.split(/[_\s\-]+/)
    for (const p of parts) {
      const t = canonicalToken(p)
      if (t.length < MIN_TOKEN_LEN) continue
      if (STOP_WORDS.has(t)) continue
      if (PURE_NUMBER_RE.test(t)) continue
      if (VERSION_RE.test(t)) continue
      if (!seen.has(t)) {
        seen.add(t)
        tokens.push(t)
      }
    }
  }
  return tokens
}

/**
 * Extract the meaningful database identifier from a connection key.
 *   "Project.ConnectionManagers[ISPWarehouse]" → ["ISPWAREHOUSE"]
 *   "LIBS_CE"                                  → ["LIBS", "CE"]
 *   "ODS_WH"                                   → ["ODS", "WH"]
 *   "{GUID}"                                   → []
 */
export function extractKeyIdentifier(key: string): string[] {
  if (/^\{[0-9a-f-]+\}$/i.test(key)) return []

  const bracketMatch = key.match(/\[([^\]]+)\]/)
  const identifier = bracketMatch ? bracketMatch[1] : key

  const seen = new Set<string>()
  const tokens: string[] = []
  for (const part of identifier.split(/[_\s\-.]+/)) {
    const t = part.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
    if (t.length < 2) continue
    if (!seen.has(t)) { seen.add(t); tokens.push(t) }
  }
  return tokens
}

export type ScoredToken = {
  token: string;
  frequency: number;
  distinctiveness: number;
  score: number;
};

export function scoreTokens(allPathTokens: string[][]): ScoredToken[] {
  const totalRows = allPathTokens.length
  if (totalRows === 0) return []

  const tokenRowCount = new Map<string, number>()
  for (const rowTokens of allPathTokens) {
    const unique = new Set(rowTokens)
    for (const t of unique) {
      tokenRowCount.set(t, (tokenRowCount.get(t) ?? 0) + 1)
    }
  }

  const scored: ScoredToken[] = []
  for (const [token, freq] of tokenRowCount) {
    // Distinctiveness: tokens appearing in only a few rows are more targeted search terms
    const distinctiveness = 1 - freq / totalRows
    // Length bonus: longer tokens are more specific
    const lengthBonus = Math.min(token.length / 10, 1)
    const score = freq * (0.4 + 0.6 * distinctiveness) * (0.5 + 0.5 * lengthBonus)
    scored.push({ token, frequency: freq, distinctiveness, score })
  }

  return scored.sort((a, b) => b.score - a.score)
}
