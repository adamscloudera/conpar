import { useState } from 'react'
import { BarChart3, Copy, CheckCheck, ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'
import { useInsightsStore } from '../stores/useInsightsStore.ts'
import type { InsightMetrics } from '../Logic/core/insightMetrics.ts'

// Abbreviate large counts for the headline display; exact number in copy text
function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1_000)}K`
  return n.toLocaleString()
}

// Pluralize a type label: 1 Package, 2 Packages. Parenthetical types (like "(unknown)")
// are left as-is since appending "s" produces garbage.
function typeLabel(type: string, count: number): string {
  if (type.startsWith('(')) return `${count.toLocaleString()} ${type}`
  return count === 1 ? `1 ${type}` : `${count.toLocaleString()} ${type}s`
}

// Canonical object types shown as inline badges and included first in copy text
const KEY_TYPES = ['Package', 'Procedure', 'Function', 'Table', 'View', 'Materialized View']

// Types treated as transformation objects for the rollup and amber highlights
const TRANSFORM_SET = new Set(['Package', 'Procedure', 'Function', 'Stored Procedure', 'StoredProcedure'])

// Build the pipe-separated object-type summary used in per-connector copy text.
// Canonical types come first; any remaining non-zero types follow.
function buildTypeSummary(types: Record<string, number>): string {
  const parts: string[] = []
  for (const t of KEY_TYPES) {
    const n = types[t] ?? 0
    if (n > 0) parts.push(typeLabel(t, n))
  }
  for (const [t, n] of Object.entries(types)) {
    if (n > 0 && !KEY_TYPES.includes(t)) parts.push(typeLabel(t, n))
  }
  return parts.join(' | ')
}

// POV headline: "{N} assets harvested across {K} connected systems — {top-5 names}."
// Uses an em-dash as specified by the chairman spec — this is clipboard presentation copy.
function buildHeadlineSentence(m: InsightMetrics): string {
  const top5 = m.connections
    .filter((c) => c.name !== '(unlabeled)')
    .slice(0, 5)
    .map((c) => c.name)
  const systemWord = m.uniqueConnections === 1 ? 'system' : 'systems'
  const suffix = top5.length > 0 ? ` — ${top5.join(', ')}.` : '.'
  return `${m.totalAssets.toLocaleString()} assets harvested across ${m.uniqueConnections} connected ${systemWord}${suffix}`
}

// Transformation objects bullet. Returns empty string if no transformation objects exist.
function buildTransformBullet(m: InsightMetrics): string {
  const pkg = m.objectTypeBreakdown['Package'] ?? 0
  const proc = m.objectTypeBreakdown['Procedure'] ?? 0
  const fn = m.objectTypeBreakdown['Function'] ?? 0
  const total = pkg + proc + fn
  if (total === 0) return ''
  const parts = [
    pkg > 0 ? typeLabel('Package', pkg) : '',
    proc > 0 ? typeLabel('Procedure', proc) : '',
    fn > 0 ? typeLabel('Function', fn) : '',
  ].filter(Boolean)
  return (
    `${total.toLocaleString()} transformation objects cataloged automatically (${parts.join(' | ')}) — ` +
    `every data pipeline process is now visible and auditable.`
  )
}

// Cross-system lineage bullet. Returns empty string if no cross-system pairs exist.
function buildCrossSystemBullet(m: InsightMetrics): string {
  if (m.crossSystemPairs.length === 0) return ''
  const pairCount = m.crossSystemPairs.length
  const pairList = m.crossSystemPairs
    .slice(0, 5)
    .map((p) => `${p.from} -> ${p.to} (${p.linkCount} link${p.linkCount !== 1 ? 's' : ''})`)
    .join(', ')
  const pairWord = pairCount === 1 ? 'pair' : 'pairs'
  return (
    `Cross-system data flows detected across ${pairCount} system ${pairWord}: ${pairList}. ` +
    `(Based on sampled lineage from ${m.sampledKeyCount} assets — full coverage available in Octopai UI.)`
  )
}

// Clipboard copy button with 1.5s "Copied" feedback state
function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard write blocked in sandboxed iframes
    }
  }

  return (
    <button
      onClick={handleCopy}
      disabled={!text}
      title="Copy to clipboard"
      className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-gray-100 hover:bg-gray-200 text-muted hover:text-foreground transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {copied ? (
        <>
          <CheckCheck className="w-3 h-3 text-green-600" />
          <span className="text-green-600">Copied</span>
        </>
      ) : (
        <>
          <Copy className="w-3 h-3" />
          <span>{label}</span>
        </>
      )}
    </button>
  )
}

export function InsightsPanel() {
  const { metrics: m } = useInsightsStore()
  const [showTypes, setShowTypes] = useState(false)

  if (!m) return null

  const headlineSentence = buildHeadlineSentence(m)
  const transformBullet = buildTransformBullet(m)
  const crossSystemBullet = buildCrossSystemBullet(m)
  const metadataBullet =
    'Metadata-only extraction: no business data, no patient records, no sensitive content ever leaves the environment. ' +
    'Every audit question answered with a complete field-level lineage trail.'

  const povBullets = [headlineSentence, transformBullet, crossSystemBullet, metadataBullet].filter(Boolean)

  const dateLabel = m.fetchedAt
    ? new Date(m.fetchedAt).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : ''

  const pkg = m.objectTypeBreakdown['Package'] ?? 0
  const proc = m.objectTypeBreakdown['Procedure'] ?? 0
  const fn = m.objectTypeBreakdown['Function'] ?? 0
  const transformTotal = pkg + proc + fn

  const sortedTypes = Object.entries(m.objectTypeBreakdown)
    .filter(([, n]) => n > 0)
    .sort(([, a], [, b]) => b - a)

  return (
    <div className="surface-card p-5 space-y-5">

      {/* ── Card header ── */}
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          POV Insights
        </h2>
        <span className="text-xs text-muted text-right">
          {m.tenantName}.octopai.com
          {dateLabel ? ` · ${dateLabel}` : ''}
          {m.fetchDurationSeconds > 0 ? ` · ${m.fetchDurationSeconds}s fetch` : ''}
        </span>
      </div>

      {/* ── Section 1: Headline ── */}
      <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-4xl font-bold text-foreground tabular-nums">{formatK(m.totalAssets)}</p>
            <p className="text-sm text-muted mt-0.5">
              assets harvested
              {m.uniqueConnections > 0
                ? ` · ${m.uniqueConnections} connected system${m.uniqueConnections !== 1 ? 's' : ''}`
                : ''}
            </p>
            <p className="text-xs text-foreground mt-2 leading-relaxed">{headlineSentence}</p>
          </div>
          <CopyBtn text={headlineSentence} />
        </div>
      </div>

      {/* ── Section 2: By connected system ── */}
      <div className="space-y-2">
        <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">By connected system</p>
        <div className="rounded-lg border border-border overflow-hidden divide-y divide-border">
          {m.connections.map((conn) => {
            const isUnlabeled = conn.name === '(unlabeled)'
            const typeSummary = buildTypeSummary(conn.objectTypes)
            const rowCopy = `${conn.name}: ${conn.assetCount.toLocaleString()} assets${typeSummary ? ` (${typeSummary})` : ''}.`
            // Visible badge types: only KEY_TYPES with count > 0 (not Materialized View — too verbose for badges)
            const badgeTypes = ['Package', 'Procedure', 'Function', 'Table', 'View'].filter(
              (t) => (conn.objectTypes[t] ?? 0) > 0,
            )

            return (
              <div
                key={conn.name}
                className="flex items-center justify-between px-3 py-2.5 bg-card hover:bg-gray-50 transition-colors gap-2"
              >
                <div className="flex flex-wrap items-center gap-2 min-w-0 flex-1">
                  {isUnlabeled ? (
                    <span className="badge badge-amber shrink-0">{conn.name}</span>
                  ) : (
                    <span className="text-sm font-medium text-foreground shrink-0 truncate max-w-[160px]">
                      {conn.name}
                    </span>
                  )}
                  <span className="text-xs font-mono text-muted shrink-0">
                    {conn.assetCount.toLocaleString()}
                  </span>
                  {badgeTypes.length > 0 && (
                    <span className="flex flex-wrap gap-1">
                      {badgeTypes.map((t) => (
                        <span
                          key={t}
                          className={clsx(
                            'badge',
                            TRANSFORM_SET.has(t) ? 'badge-amber' : 'badge-blue',
                          )}
                        >
                          {(conn.objectTypes[t]).toLocaleString()} {t}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
                <CopyBtn text={rowCopy} />
              </div>
            )
          })}
        </div>
        {(m.distinctDatabases > 0 || m.distinctSchemas > 0) && (
          <p className="text-xs text-muted px-1">
            {m.distinctDatabases} distinct database{m.distinctDatabases !== 1 ? 's' : ''}
            {' · '}
            {m.distinctSchemas} distinct schema{m.distinctSchemas !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      {/* ── Section 3: Cross-system lineage ── */}
      {m.sampledKeyCount > 0 && (
        <div className="space-y-2">
          <div className="flex items-center flex-wrap gap-2">
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">
              Cross-system lineage
            </p>
            <span className="badge badge-blue">{m.crossSystemLinkCount}</span>
            <span className="text-[11px] text-muted/70 font-normal normal-case">
              (sampled lineage — {m.sampledKeyCount} assets)
            </span>
            {crossSystemBullet && (
              <span className="ml-auto">
                <CopyBtn text={crossSystemBullet} />
              </span>
            )}
          </div>

          {m.crossSystemLinkCount === 0 ? (
            <p className="text-xs text-muted italic px-1">
              No cross-system links detected in sample — lineage enrichment may not be configured for all connections.
            </p>
          ) : (
            <div className="space-y-1">
              {m.crossSystemPairs.slice(0, 10).map((pair, i) => {
                const pairCopy =
                  `Cross-system lineage: ${pair.from} -> ${pair.to} ` +
                  `(${pair.linkCount} link${pair.linkCount !== 1 ? 's' : ''} in ${m.sampledKeyCount}-asset sample)`
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-blue-50 border border-blue-100 gap-2"
                  >
                    <span className="text-sm min-w-0">
                      <span className="font-medium text-blue-900">{pair.from}</span>
                      <span className="mx-2 text-blue-400 font-bold">→</span>
                      <span className="font-medium text-blue-900">{pair.to}</span>
                      <span className="ml-2 text-xs text-blue-500">
                        {pair.linkCount} link{pair.linkCount !== 1 ? 's' : ''}
                      </span>
                    </span>
                    <CopyBtn text={pairCopy} />
                  </div>
                )
              })}
            </div>
          )}

          {/* topNodesByDegree tiles */}
          {m.topNodesByDegree.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {m.topNodesByDegree.map((node, i) => (
                <div
                  key={i}
                  className="px-2.5 py-1.5 rounded-lg bg-gray-50 border border-border text-xs"
                >
                  <span className="font-medium text-foreground">{node.objectName || node.connectionName}</span>
                  {node.connectionName && node.objectName && (
                    <span className="text-muted ml-1">({node.connectionName})</span>
                  )}
                  <span className="text-muted ml-1">— degree {node.degree}</span>
                  <span className="text-[10px] text-muted/60 ml-1">(sample only)</span>
                </div>
              ))}
            </div>
          )}

          {m.maxLineageDepth > 0 && (
            <p className="text-xs text-muted px-1">
              Max lineage depth: {m.maxLineageDepth} hop{m.maxLineageDepth !== 1 ? 's' : ''} (sampled)
              {m.lineageLinkCount > 0 && ` · ${m.lineageLinkCount} total links in sample`}
            </p>
          )}
        </div>
      )}

      {/* ── Section 4: POV bullets ── */}
      <div className="space-y-3 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">POV bullets</p>
          <CopyBtn text={povBullets.join('\n\n')} label="Copy all" />
        </div>
        <div className="space-y-2">
          {povBullets.map((bullet, i) => (
            <div
              key={i}
              className="flex items-start gap-2 p-3 rounded-lg bg-gray-50 border border-border"
            >
              <p className="text-xs text-foreground leading-relaxed flex-1">{bullet}</p>
              <CopyBtn text={bullet} />
            </div>
          ))}
        </div>
      </div>

      {/* ── Section 5: Object type breakdown ── */}
      <div className="space-y-2">
        <button
          onClick={() => setShowTypes((v) => !v)}
          className="flex items-center gap-1.5 text-[11px] font-semibold text-muted uppercase tracking-wider hover:text-foreground transition-colors"
        >
          <ChevronDown className={clsx('w-3.5 h-3.5 transition-transform duration-150', showTypes && 'rotate-180')} />
          Object type breakdown
        </button>

        {/* Always-visible: transformation rollup */}
        {transformTotal > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 flex-wrap">
            <span className="badge badge-amber">{transformTotal.toLocaleString()}</span>
            <span className="text-xs text-amber-800 font-medium">Transformation Objects</span>
            <span className="text-xs text-muted/70">
              ({[
                pkg > 0 ? `${pkg.toLocaleString()} Packages` : '',
                proc > 0 ? `${proc.toLocaleString()} Procedures` : '',
                fn > 0 ? `${fn.toLocaleString()} Functions` : '',
              ].filter(Boolean).join(' | ')})
            </span>
            {transformBullet && (
              <span className="ml-auto">
                <CopyBtn text={transformBullet} />
              </span>
            )}
          </div>
        )}

        {/* Expanded: full per-type badge list */}
        {showTypes && (
          <div className="flex flex-wrap gap-1.5">
            {sortedTypes.map(([type, count]) => (
              <div
                key={type}
                className={clsx(
                  'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs',
                  TRANSFORM_SET.has(type)
                    ? 'bg-amber-50 border border-amber-200 text-amber-800'
                    : 'bg-gray-100 text-foreground',
                )}
              >
                <span className="font-semibold tabular-nums">{count.toLocaleString()}</span>
                <span className="text-muted">{type}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer note */}
      <p className="text-[10px] text-muted/60 italic border-t border-border pt-3">
        Lineage metrics based on {m.sampledKeyCount}-object sample at depth=2.
        Asset counts reflect full tenant catalog ({m.totalAssets.toLocaleString()} objects).
      </p>
    </div>
  )
}
