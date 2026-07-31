import { clsx } from 'clsx'
import { useMappingStore } from '../stores/useMappingStore.ts'
import { useDiscoveryStore } from '../stores/useDiscoveryStore.ts'
import type { MappingStatus } from '../types.ts'

type StatItem = { label: string; count: number; cls: string }

function resolvedDb(status: MappingStatus, templateDb: string, candidateDb?: string): string {
  if (status === 'pre_filled') return templateDb
  return candidateDb ?? ''
}

function resolvedSchema(status: MappingStatus, templateSchema: string, candidateSchema?: string): string {
  if (status === 'pre_filled') return templateSchema
  return candidateSchema ?? ''
}

export function StatsPanel() {
  const { results } = useMappingStore()
  const { files } = useDiscoveryStore()

  if (!results.length) return null

  const total = results.length
  const counts = {
    pre_filled: results.filter((r) => r.status === 'pre_filled').length,
    auto_filled: results.filter((r) => r.status === 'auto_filled').length,
    confirmed: results.filter((r) => r.status === 'confirmed').length,
    manual: results.filter((r) => r.status === 'manual').length,
    needs_selection: results.filter((r) => r.status === 'needs_selection').length,
    no_match: results.filter((r) => r.status === 'no_match').length,
  }

  const filled = counts.pre_filled + counts.auto_filled + counts.confirmed + counts.manual
  const coverage = total ? Math.round((filled / total) * 100) : 0

  const dbs = new Set<string>()
  const schemas = new Set<string>()
  for (const r of results) {
    const db = resolvedDb(r.status, r.templateRow.databaseName, r.selectedCandidate?.databaseName)
    const schema = resolvedSchema(r.status, r.templateRow.schemaName, r.selectedCandidate?.schemaName)
    if (db && db !== '-1') dbs.add(db)
    if (schema && schema !== '-1') schemas.add(schema)
  }

  const discoveryInfo = files.map((f) => {
    if (f.type === 'impala_columns') {
      const distinctDbs = new Set(f.impalaRows.map((r) => r.databaseName).filter(Boolean))
      return `${f.filename}: ${f.rowCount} objects across ${distinctDbs.size} database${distinctDbs.size !== 1 ? 's' : ''}`
    }
    if (f.type === 'lineage_map') {
      return `${f.filename}: ${f.rowCount} lineage rows`
    }
    if (f.type === 'api_lookup') {
      const distinctDbs = new Set(f.impalaRows.map((r) => r.databaseName).filter(Boolean))
      return `${f.filename}: ${f.rowCount} API assets across ${distinctDbs.size} database${distinctDbs.size !== 1 ? 's' : ''}`
    }
    return `${f.filename}: unrecognized format`
  })

  const stats: StatItem[] = [
    { label: 'Pre-filled', count: counts.pre_filled, cls: 'badge-gray' },
    { label: 'Auto-filled', count: counts.auto_filled, cls: 'badge-blue' },
    { label: 'Confirmed', count: counts.confirmed + counts.manual, cls: 'badge-green' },
    { label: 'Needs review', count: counts.needs_selection, cls: 'badge-amber' },
    { label: 'No match', count: counts.no_match, cls: 'badge-red' },
  ]

  return (
    <div className="surface-card p-5 space-y-4">
      <h2 className="text-base font-semibold text-foreground">Mapping Summary</h2>

      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-muted">
          <span>Coverage</span>
          <span className="font-medium text-foreground">{coverage}% — {filled} of {total} rows filled</span>
        </div>
        <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
          <div
            className={clsx('h-full rounded-full transition-all', coverage === 100 ? 'bg-green-500' : coverage >= 80 ? 'bg-blue-500' : 'bg-amber-500')}
            style={{ width: `${coverage}%` }}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {stats.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5 text-xs">
            <span className={clsx('badge', s.cls)}>{s.count}</span>
            <span className="text-muted">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="bg-gray-50 rounded-lg px-3 py-2">
          <p className="text-muted">Distinct databases</p>
          <p className="font-semibold text-foreground text-sm mt-0.5">{dbs.size}</p>
          {dbs.size <= 6 && (
            <p className="text-muted mt-1 font-mono">{[...dbs].join(', ')}</p>
          )}
        </div>
        <div className="bg-gray-50 rounded-lg px-3 py-2">
          <p className="text-muted">Distinct schemas mapped</p>
          <p className="font-semibold text-foreground text-sm mt-0.5">{schemas.size}</p>
          {schemas.size <= 8 && (
            <p className="text-muted mt-1 font-mono">{[...schemas].join(', ')}</p>
          )}
        </div>
      </div>

      {discoveryInfo.length > 0 && (
        <div className="text-xs text-muted border-t border-border pt-3 space-y-0.5">
          {discoveryInfo.map((info, i) => (
            <p key={i}>{info}</p>
          ))}
        </div>
      )}
    </div>
  )
}
