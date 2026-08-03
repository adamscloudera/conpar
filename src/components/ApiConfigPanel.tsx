import { useState, useRef, useEffect } from 'react'
import { Plug, LogOut, RefreshCw, AlertCircle, CheckCircle2, ChevronDown, Plus, X } from 'lucide-react'
import { clsx } from 'clsx'
import { octopai } from '../Logic/api/octopaiApi.ts'
import { assetsToDiscoveryFile } from '../Logic/api/apiAdapter.ts'
import { intakeTemplate, sweepConnections, sweepToItems } from '../Logic/api/connectionSweep.ts'
import { computeInsightMetrics } from '../Logic/core/insightMetrics.ts'
import { classifyConnectionKey, uniqueScopeValues } from '../Logic/core/connectionClassifier.ts'
import { useApiStore } from '../stores/useApiStore.ts'
import { useDiscoveryStore } from '../stores/useDiscoveryStore.ts'
import { useInsightsStore } from '../stores/useInsightsStore.ts'
import { useMappingStore } from '../stores/useMappingStore.ts'
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
  const { templateType, connectionKeys, rows: templateRows } = useTemplateStore()
  const { addFile, files, removeFile } = useDiscoveryStore()
  const { setMetrics, clearMetrics } = useInsightsStore()
  const { scopeConfig, setScopeConfig } = useMappingStore()
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

  type QuickRule = { id: string; pattern: string; connectionName: string }
  const [quickRules, setQuickRules] = useState<QuickRule[]>([])
  const ruleCounter = useRef(0)
  const logEndRef = useRef<HTMLDivElement>(null)
  // Controls the in-flight fetch so Disconnect (or a refetch) can cancel it.
  const fetchAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (showLog && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [queryLog.length, showLog])

  // Live elapsed-time ticker — resets when fetch starts, clears when done.
  useEffect(() => {
    if (!fetchProgress) { setElapsed(0); return }
    const startedAt = fetchProgress.startedAt
    setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    )
    return () => clearInterval(id)
  }, [fetchProgress?.startedAt])

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
    if (!accessToken || !templateRows.length) return
    clearFetchState()
    setStatus('fetching', null)
    setShowLog(true)

    fetchAbortRef.current?.abort()
    const controller = new AbortController()
    fetchAbortRef.current = controller

    const existing = files.find((f) => f.type === 'api_lookup')
    if (existing) removeFile(existing.id)
    setScopeConfig({ keyConnectionMap: {} })
    setQuickRules([])

    const fetchStart = Date.now()

    try {
      // Stage 1: Intake — understand what needs sweeping
      const inventory = intakeTemplate(templateRows)
      const connectionNames = inventory.needsSweep.map((c) => c.connectionLogicName)
      logEntry('info', `Sweep: ${connectionNames.length} connections to query (${inventory.preFilled} pre-filled, ${inventory.notApplicable} N/A)`)

      // Stage 2: Index fetch + per-connection sweep
      setFetchProgress({ phase: 'indexing', done: 0, total: connectionNames.length, current: '', startedAt: fetchStart })

      const sweepResults = await sweepConnections(
        octopai,
        company,
        accessToken,
        connectionNames,
        (done, total, current) => {
          setFetchProgress({ phase: 'sweeping', done, total, current, startedAt: fetchStart })
        },
        controller.signal,
      )

      if (controller.signal.aborted || fetchAbortRef.current !== controller) {
        setFetchProgress(null)
        return
      }

      // Stage 3: Filter to DB objects and inject as discovery source
      const dbCount = Array.from(sweepResults.values()).filter(
        (r) => r.toolType === 'DB' || r.rawItems.some((i) => i.toolType === 'DB' || i.isObjectData === true)
      ).length
      const etlCount = sweepResults.size - dbCount
      logEntry('ok', `Swept ${connectionNames.length} connections — ${dbCount} DB, ${etlCount} ETL/other`)

      const items = sweepToItems(sweepResults)
      const file = assetsToDiscoveryFile(items, [], `API — ${company}`)
      logEntry('ok', `Injected ${file.rowCount.toLocaleString()} rows as discovery source`)
      addFile(file)

      setFetchProgress(null)
      setStatus('done', null)

      const fetchDurationSeconds = Math.round((Date.now() - fetchStart) / 1000)
      const insights = computeInsightMetrics(
        company, items, [], [], 0, new Date().toISOString(), [], fetchDurationSeconds,
      )
      setMetrics(insights)
    } catch (err) {
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

        <button onClick={() => { fetchAbortRef.current?.abort(); clearSession(); clearMetrics(); setScopeConfig({ keyConnectionMap: {} }); setQuickRules([]) }} className="btn-ghost">
          <LogOut className="w-4 h-4" />
          Disconnect
        </button>
      </div>

      {/* Progress indicator — shown while fetching */}
      {fetchProgress && (
        <div className="space-y-1.5 p-3 rounded-lg bg-muted/20 border border-border/60">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted">
              {fetchProgress.phase === 'indexing' ? 'Building connection index…' : (
                fetchProgress.done < fetchProgress.total
                  ? `Sweeping ${fetchProgress.current || '…'}`
                  : 'Sweep complete'
              )}
            </span>
            <span className="font-mono text-foreground flex items-center gap-2">
              {fetchProgress.phase === 'sweeping' && fetchProgress.total > 0 && (
                <span>{fetchProgress.done}/{fetchProgress.total}</span>
              )}
              <span className="text-muted tabular-nums">{elapsed}s</span>
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-border overflow-hidden">
            {fetchProgress.phase === 'indexing' ? (
              <div className="h-full rounded-full bg-primary/60 animate-pulse w-full" />
            ) : (
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: fetchProgress.total > 0 ? `${(fetchProgress.done / fetchProgress.total) * 100}%` : '0%' }}
              />
            )}
          </div>
        </div>
      )}

      {/* Summary after done */}
      {status === 'done' && apiFile && !fetchProgress && (
        <p className="text-xs text-muted">
          {apiFile.rowCount.toLocaleString()} assets fetched from {company}.octopai.com — injected as discovery source
        </p>
      )}

      {/* Connection scoping — quick-assign rules + per-key review table */}
      {(() => {
        if (!apiFile || fetchProgress) return null
        const NA_CLASSES = new Set(['file_path', 'salesforce', 'redshift'])
        const scopableKeys = connectionKeys.filter((k) => !NA_CLASSES.has(classifyConnectionKey(k)))
        if (!scopableKeys.length) return null
        const { values: connNames, mode: scopeMode, toolLabels } = uniqueScopeValues(apiFile.impalaRows)
        const scopeLabel = scopeMode === 'connection' ? 'connection' : 'database'
        const scopePlaceholder = scopeMode === 'connection' ? 'Select connection…' : 'Select database…'

        const keyRowCounts: Record<string, number> = {}
        for (const row of templateRows) {
          if (row.key) keyRowCounts[row.key] = (keyRowCounts[row.key] ?? 0) + 1
        }

        const scopedCount = scopableKeys.filter((k) => !!scopeConfig.keyConnectionMap[k]).length

        function applyRule(pattern: string, connectionName: string) {
          if (!pattern || !connectionName) return
          const lower = pattern.toLowerCase()
          const next = { ...scopeConfig.keyConnectionMap }
          for (const k of scopableKeys) {
            if (k.toLowerCase().includes(lower)) next[k] = connectionName
          }
          setScopeConfig({ keyConnectionMap: next })
        }

        function setKeyConnection(key: string, connectionName: string) {
          const next = { ...scopeConfig.keyConnectionMap }
          if (connectionName) { next[key] = connectionName } else { delete next[key] }
          setScopeConfig({ keyConnectionMap: next })
        }

        return (
          <div className="space-y-4">

            {/* Quick assign rules */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted">Quick assign</p>
              <p className="text-xs text-muted">
                Match keys by pattern and assign them to a {scopeLabel} in one click.
                Add one rule per tool in the stack.
              </p>
              <div className="space-y-2">
                {quickRules.map((rule) => {
                  const matchCount = rule.pattern
                    ? scopableKeys.filter((k) => k.toLowerCase().includes(rule.pattern.toLowerCase())).length
                    : 0
                  const canApply = !!rule.pattern && !!rule.connectionName && matchCount > 0
                  return (
                    <div key={rule.id} className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted w-20 shrink-0">key contains</span>
                      <input
                        type="text"
                        value={rule.pattern}
                        onChange={(e) => setQuickRules((rs) => rs.map((r) => r.id === rule.id ? { ...r, pattern: e.target.value } : r))}
                        placeholder="_snow"
                        className="w-28 px-2 py-1 text-xs rounded border border-border bg-card text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/30"
                        spellCheck={false}
                      />
                      <span className="text-xs text-muted">→</span>
                      <select
                        value={rule.connectionName}
                        onChange={(e) => setQuickRules((rs) => rs.map((r) => r.id === rule.id ? { ...r, connectionName: e.target.value } : r))}
                        disabled={!connNames.length}
                        className="flex-1 min-w-[160px] px-2 py-1 text-xs rounded border border-border bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-50"
                      >
                        <option value="">{connNames.length ? scopePlaceholder : `No ${scopeLabel}s in API data`}</option>
                        {connNames.map((name) => (
                          <option key={name} value={name}>
                            {toolLabels[name] ? `${name} · ${toolLabels[name]}` : name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!canApply}
                        onClick={() => applyRule(rule.pattern, rule.connectionName)}
                        className="px-2.5 py-1 text-xs rounded border border-border bg-card hover:bg-muted/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                      >
                        Apply{rule.pattern && matchCount > 0 ? ` (${matchCount})` : ''}
                      </button>
                      <button
                        type="button"
                        onClick={() => setQuickRules((rs) => rs.filter((r) => r.id !== rule.id))}
                        className="text-muted hover:text-foreground transition-colors"
                        aria-label="Remove rule"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
              <button
                type="button"
                onClick={() => {
                  ruleCounter.current += 1
                  setQuickRules((rs) => [...rs, { id: String(ruleCounter.current), pattern: '', connectionName: '' }])
                }}
                className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add rule
              </button>
            </div>

            {/* Per-key review table — only useful when connection names are available */}
            {!connNames.length ? (
              <p className="text-xs text-amber-600">
                No connection or database names found in API data — cannot assign keys to a scope.
              </p>
            ) : null}
            <div className={clsx('space-y-2', !connNames.length && 'hidden')}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted">
                  Connection assignments
                  {scopedCount > 0 && (
                    <span className="ml-2 px-1.5 py-0.5 rounded-full text-[10px] bg-primary/10 text-primary font-medium">
                      {scopedCount} / {scopableKeys.length} assigned
                    </span>
                  )}
                </p>
                {scopedCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setScopeConfig({ keyConnectionMap: {} })}
                    className="text-xs text-muted hover:text-foreground transition-colors"
                  >
                    Clear all
                  </button>
                )}
              </div>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/20 border-b border-border">
                      <th className="text-left px-3 py-2 font-medium text-muted">Key</th>
                      <th className="text-left px-3 py-2 font-medium text-muted">Class</th>
                      <th className="text-left px-3 py-2 font-medium text-muted">Search in {scopeLabel}</th>
                      <th className="text-right px-3 py-2 font-medium text-muted">Rows</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scopableKeys.map((key, i) => {
                      const cls = classifyConnectionKey(key)
                      const assigned = scopeConfig.keyConnectionMap[key] ?? ''
                      return (
                        <tr key={key} className={clsx('border-b last:border-0 border-border', i % 2 === 0 ? 'bg-card' : 'bg-muted/10')}>
                          <td className="px-3 py-1.5 font-mono max-w-[180px] truncate" title={key}>{key}</td>
                          <td className="px-3 py-1.5">
                            {cls === 'snowflake' && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-sky-100 text-sky-700">Snowflake</span>
                            )}
                            {cls === 'standard' && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-500">Standard</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5">
                            <select
                              value={assigned}
                              onChange={(e) => setKeyConnection(key, e.target.value)}
                              className="w-full min-w-[160px] px-2 py-0.5 text-xs rounded border border-border bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
                            >
                              <option value="">All data (auto)</option>
                              {connNames.map((name) => (
                                <option key={name} value={name}>
                                  {toolLabels[name] ? `${name} · ${toolLabels[name]}` : name}
                                </option>
                              ))}

                            </select>
                          </td>
                          <td className="px-3 py-1.5 text-right text-muted">{keyRowCounts[key] ?? 0}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )
      })()}

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
