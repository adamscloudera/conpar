import { useState, useRef, useEffect } from 'react'
import { Plug, LogOut, RefreshCw, AlertCircle, CheckCircle2, ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'
import type { LineageResponse } from '@adamscloudera/octopai-api'
import { octopai } from '../Logic/api/octopaiApi.ts'
import { assetsToDiscoveryFile } from '../Logic/api/apiAdapter.ts'
import { computeInsightMetrics } from '../Logic/core/insightMetrics.ts'
import { useApiStore } from '../stores/useApiStore.ts'
import { useDiscoveryStore } from '../stores/useDiscoveryStore.ts'
import { useInsightsStore } from '../stores/useInsightsStore.ts'
import { useTemplateStore } from '../stores/useTemplateStore.ts'

function TokenExpiry({ expiry }: { expiry: string }) {
  if (!expiry) return null
  const ms = new Date(expiry).getTime() - Date.now()
  if (ms <= 0) return <span className="text-xs text-red-500">Token expired</span>
  const mins = Math.round(ms / 60000)
  if (mins < 60) return <span className="text-xs text-amber-600">Token expires in {mins}m</span>
  const hrs = Math.round(ms / 3600000)
  return <span className="text-xs text-muted">Token expires in {hrs}h</span>
}

export function ApiConfigPanel() {
  const { templateType, connectionKeys } = useTemplateStore()
  const { addFile, files, removeFile } = useDiscoveryStore()
  const { setMetrics, clearMetrics } = useInsightsStore()
  const {
    company, accessToken, accessExpiry, displayName, status, error,
    queryLog, fetchProgress,
    setConfig, setTokens, setStatus, clearSession,
    addQueryLog, setFetchProgress, clearFetchState,
  } = useApiStore()

  const [companyInput, setCompanyInput] = useState(company)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showLog, setShowLog] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const logEndRef = useRef<HTMLDivElement>(null)
  // Controls the in-flight fetch so Disconnect (or a refetch) can cancel it.
  const fetchAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (showLog && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [queryLog.length, showLog])

  // Live elapsed-time ticker — resets when phase transitions, clears when fetch ends.
  useEffect(() => {
    if (!fetchProgress) { setElapsed(0); return }
    const startedAt = fetchProgress.phase === 'assets'
      ? fetchProgress.assetsStartedAt
      : fetchProgress.lineageStartedAt
    setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    )
    return () => clearInterval(id)
  }, [fetchProgress?.phase, fetchProgress?.assetsStartedAt, fetchProgress?.lineageStartedAt])

  if (!templateType) return null

  const isConnected = !!accessToken
  const isBusy = status === 'connecting' || status === 'fetching'

  function logEntry(level: 'info' | 'ok' | 'error', message: string) {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false })
    addQueryLog({ ts, level, message })
  }

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault()
    if (!companyInput.trim() || !email.trim() || !password.trim()) return
    setConfig(companyInput.trim())
    setStatus('connecting', null)
    try {
      const resp = await octopai.login(companyInput.trim(), email, password)
      setTokens({
        accessToken: resp.accessToken,
        accessExpiry: resp.expiration,
        refreshToken: resp.refreshToken.token,
        refreshExpiry: resp.refreshToken.expiration,
        displayName: resp.displayName || resp.userName,
      })
      setPassword('')
    } catch (err) {
      setStatus('error', err instanceof Error ? err.message : String(err))
    }
  }

  async function handleFetch() {
    if (!accessToken || !connectionKeys.length) return
    clearFetchState()
    setStatus('fetching', null)
    setShowLog(true)

    // Fresh controller per fetch; abort supersedes any prior in-flight fetch.
    fetchAbortRef.current?.abort()
    const controller = new AbortController()
    fetchAbortRef.current = controller

    const existing = files.find((f) => f.type === 'api_lookup')
    if (existing) removeFile(existing.id)

    try {
      logEntry('info', `Querying ${company}.octopai.com — assetType=2, limit=1000/page`)
      const assetsStart = Date.now()
      setFetchProgress({ phase: 'assets', assetsStartedAt: assetsStart, assetsTotal: 0, lineageDone: 0, lineageTotal: 0, lineageStartedAt: 0 })

      const assets = await octopai.queryAllAssets(company, accessToken, (fetched) => {
        setFetchProgress({ phase: 'assets', assetsStartedAt: assetsStart, assetsTotal: fetched, lineageDone: 0, lineageTotal: 0, lineageStartedAt: 0 })
      }, controller.signal)

      logEntry('ok', `Assets API: ${assets.length.toLocaleString()} assets retrieved`)

      // Deduplicate keys, cap at 20 to avoid rate limits in Phase 2
      const keysSeen = new Set<string>()
      const assetKeys = assets
        .filter((a) => { const k = a._key; if (!k || keysSeen.has(k)) return false; keysSeen.add(k); return true })
        .slice(0, 20)
        .map((a) => a._key)

      logEntry('info', `Lineage API: enriching ${assetKeys.length} unique keys (depth=2)`)

      const lineageStart = Date.now()
      setFetchProgress({ phase: 'lineage', assetsStartedAt: assetsStart, assetsTotal: assets.length, lineageDone: 0, lineageTotal: assetKeys.length, lineageStartedAt: lineageStart })

      let lineageDone = 0
      const lineageResults = await Promise.allSettled(
        assetKeys.map(async (key) => {
          const result = await octopai.queryLineage(company, accessToken, key, 2, controller.signal)
          lineageDone++
          setFetchProgress({ phase: 'lineage', assetsStartedAt: assetsStart, assetsTotal: assets.length, lineageDone, lineageTotal: assetKeys.length, lineageStartedAt: lineageStart })
          return result
        })
      )

      const lineageNodes = lineageResults
        .flatMap((r) => (r.status === 'fulfilled' ? r.value.nodes : []))
      const lineageLinks = lineageResults
        .flatMap((r) => (r.status === 'fulfilled' ? r.value.links : []))
      const lineageFailed = lineageResults.filter((r) => r.status === 'rejected').length

      if (lineageFailed > 0) {
        logEntry('error', `Lineage: ${lineageFailed}/${assetKeys.length} keys failed`)
      }
      logEntry('ok', `Lineage complete: ${assetKeys.length - lineageFailed}/${assetKeys.length} keys, ${lineageNodes.length} nodes`)

      // Bail before touching the store if this fetch was cancelled or superseded
      // by a newer one — otherwise a mid-fetch Disconnect leaves stale metrics
      // and an api_lookup file behind after the session was cleared.
      if (controller.signal.aborted || fetchAbortRef.current !== controller) {
        setFetchProgress(null)
        return
      }

      const file = assetsToDiscoveryFile(assets, lineageNodes, `API — ${company}`)
      logEntry('ok', `Injected ${file.rowCount.toLocaleString()} rows as discovery source`)
      addFile(file)
      setFetchProgress(null)
      setStatus('done', null)
      const lineageDepths = lineageResults
        .filter((r): r is PromiseFulfilledResult<LineageResponse> => r.status === 'fulfilled')
        .map((r) => r.value.depth)
      const fetchDurationSeconds = Math.round((Date.now() - assetsStart) / 1000)
      const insights = computeInsightMetrics(
        company, assets, lineageLinks, lineageNodes, assetKeys.length, new Date().toISOString(),
        lineageDepths, fetchDurationSeconds,
      )
      setMetrics(insights)
    } catch (err) {
      // A deliberate cancel (Disconnect / refetch) is not an error state.
      if (controller.signal.aborted) {
        setFetchProgress(null)
        return
      }
      const msg = err instanceof Error ? err.message : String(err)
      logEntry('error', msg)
      setFetchProgress(null)
      setStatus('error', msg)
    }
  }

  if (!isConnected) {
    return (
      <div className="surface-card p-5 space-y-4">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Plug className="w-4 h-4 text-primary" />
          Step 2b — Fetch from Octopai API
          <span className="text-xs font-normal text-muted">(optional)</span>
        </h2>

        <form onSubmit={handleConnect} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted">Company name</label>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={companyInput}
                  onChange={(e) => setCompanyInput(e.target.value)}
                  placeholder="acme"
                  className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 min-w-0"
                  autoComplete="off"
                  spellCheck={false}
                />
                <span className="text-xs text-muted whitespace-nowrap">.octopai.com</span>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@company.com"
                className="px-3 py-1.5 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/30"
                autoComplete="email"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="px-3 py-1.5 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/30"
                autoComplete="current-password"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={isBusy || !companyInput.trim() || !email.trim() || !password.trim()}
              className="btn-primary"
            >
              {status === 'connecting' ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Plug className="w-4 h-4" />
              )}
              {status === 'connecting' ? 'Connecting…' : 'Connect'}
            </button>
            {connectionKeys.length > 0 && (
              <p className="text-xs text-muted">
                Will query {connectionKeys.length} connection {connectionKeys.length === 1 ? 'key' : 'keys'} from template
              </p>
            )}
          </div>

          {status === 'error' && error && (
            <p className="flex items-start gap-2 text-xs text-red-600">
              <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
              {error}
            </p>
          )}
        </form>
      </div>
    )
  }

  // Connected state
  const apiFile = files.find((f) => f.type === 'api_lookup')

  return (
    <div className="surface-card p-5 space-y-4">
      <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
        <Plug className="w-4 h-4 text-primary" />
        Step 2b — Fetch from Octopai API
      </h2>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-50 border border-green-200">
          <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">{displayName}</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">{company}.octopai.com</span>
              <TokenExpiry expiry={accessExpiry} />
            </div>
          </div>
        </div>

        <button
          onClick={handleFetch}
          disabled={isBusy || !connectionKeys.length}
          className={clsx('btn-primary', status === 'done' && 'opacity-80')}
        >
          {status === 'fetching' ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          {status === 'fetching' ? 'Fetching…' : status === 'done' ? 'Refetch' : 'Fetch from API'}
        </button>

        <button onClick={() => { fetchAbortRef.current?.abort(); clearSession(); clearMetrics() }} className="btn-ghost">
          <LogOut className="w-4 h-4" />
          Disconnect
        </button>
      </div>

      {/* Progress indicator — shown while fetching */}
      {fetchProgress && (
        <div className="space-y-1.5 p-3 rounded-lg bg-muted/20 border border-border/60">
          {fetchProgress.phase === 'assets' ? (
            <>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">Phase 1: Fetching assets</span>
                <span className="font-mono text-foreground flex items-center gap-2">
                  {fetchProgress.assetsTotal > 0
                    ? `${fetchProgress.assetsTotal.toLocaleString()} objects retrieved`
                    : <span className="text-muted italic">connecting…</span>
                  }
                  <span className="text-muted tabular-nums">{elapsed}s</span>
                </span>
              </div>
              {fetchProgress.assetsTotal === 0 && elapsed > 5 && (
                <p className="text-xs text-amber-600 italic">Waiting for server response…</p>
              )}
              <div className="h-1.5 rounded-full bg-border overflow-hidden">
                <div className="h-full rounded-full bg-primary/60 animate-pulse w-full" />
              </div>
            </>
          ) : (() => {
            const done = fetchProgress.lineageDone
            const total = fetchProgress.lineageTotal
            const pct = total > 0 ? (done / total) * 100 : 0
            // elapsed is seconds since lineage phase started (from the live ticker)
            const etr = done >= 2 && done < total
              ? Math.max(1, Math.round((total - done) * elapsed / done))
              : null
            return (
              <>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted">Phase 2: Enriching lineage</span>
                  <span className="font-mono text-foreground flex items-center gap-2">
                    {done}/{total}
                    <span className="text-muted tabular-nums">{elapsed}s elapsed</span>
                    {etr !== null && (
                      <span className="text-muted">~{etr}s left</span>
                    )}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-border overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </>
            )
          })()}
        </div>
      )}

      {/* Summary after done */}
      {status === 'done' && apiFile && !fetchProgress && (
        <p className="text-xs text-muted">
          {apiFile.rowCount.toLocaleString()} assets fetched from {company}.octopai.com — injected as discovery source
        </p>
      )}

      {status === 'error' && error && (
        <p className="flex items-start gap-2 text-xs text-red-600">
          <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
          {error}
        </p>
      )}

      {!connectionKeys.length && (
        <p className="text-xs text-amber-600 flex items-center gap-1.5">
          <AlertCircle className="w-4 h-4 shrink-0" />
          No connection keys found in template — load a template first
        </p>
      )}

      {/* Query log */}
      {queryLog.length > 0 && (
        <div className="space-y-1.5">
          <button
            onClick={() => setShowLog((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors"
          >
            <ChevronDown className={clsx('w-3.5 h-3.5 transition-transform duration-150', showLog && 'rotate-180')} />
            Query log ({queryLog.length} {queryLog.length === 1 ? 'entry' : 'entries'})
          </button>
          {showLog && (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-border bg-card p-2 space-y-0.5 font-mono text-[11px]">
              {queryLog.map((entry, i) => (
                <div
                  key={i}
                  className={clsx(
                    'flex gap-2',
                    entry.level === 'error' && 'text-red-600',
                    entry.level === 'ok' && 'text-green-700 dark:text-green-500',
                    entry.level === 'info' && 'text-muted',
                  )}
                >
                  <span className="shrink-0 opacity-60">{entry.ts}</span>
                  <span>{entry.message}</span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
