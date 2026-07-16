import type { TemplateRow, SearchSuggestion } from '../../types.ts'
import { extractPathTokens, scoreTokens } from './tokenExtractor.ts'

const MAX_SUGGESTIONS = 3

function isNearDuplicate(a: string, b: string): boolean {
  return a.includes(b) || b.includes(a)
}

export function generateSuggestions(rows: TemplateRow[]): SearchSuggestion[] {
  const unfilled = rows.filter((r) => !r.databaseName && !r.schemaName)
  if (!unfilled.length) return []

  // Score tokens from report/folder paths
  const pathTokenSets = unfilled.map((r) => extractPathTokens(r.path))
  const pathScored = scoreTokens(pathTokenSets)

  // Also extract tokens from Key and Connection Logic Name for supplementary terms
  const keyTokenSets = unfilled.map((r) => [
    ...extractPathTokens(r.key),
    ...extractPathTokens(r.connectionLogicName),
  ])
  const keyScored = scoreTokens(keyTokenSets)

  // Combine: path tokens first (more specific), then key tokens
  const allCandidates = [...pathScored, ...keyScored.filter((k) => !pathScored.find((p) => p.token === k.token))]

  // Select up to MAX_SUGGESTIONS non-overlapping terms
  const selected: string[] = []
  for (const { token } of allCandidates) {
    if (selected.length >= MAX_SUGGESTIONS) break
    if (!selected.some((s) => isNearDuplicate(s, token))) {
      selected.push(token)
    }
  }

  if (!selected.length) return []

  // Calculate how many unfilled rows at least one term would match
  const coverage = unfilled.filter((r) => {
    const upper = r.path.toUpperCase() + ' ' + r.key.toUpperCase()
    return selected.some((term) => upper.includes(term))
  }).length

  return [{ terms: selected, coverage }]
}
