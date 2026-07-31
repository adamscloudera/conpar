import { useState } from 'react'
import { Plug, LogOut, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react'
import { clsx } from 'clsx'
import { login, queryAllAssets, queryLineage } from '../Logic/api/apiClient.ts'
import { assetsToDiscoveryFile } from '../Logic/api/apiAdapter.ts'
import { useApiStore } from '../stores/useApiStore.ts'
import { useDiscoveryStore } from '../stores/useDiscoveryStore.ts'
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
  const { company, accessToken, accessExpiry, displayName, status, error, setConfig, setTokens, setStatus, clearSession } = useApiStore()

  const [companyInput, setCompanyInput] = useState(company)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  if (!templateType) return null

  const isConnected = !!accessToken
  const isBusy = status === 'connecting' || status === 'fetching'

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault()
    if (!companyInput.trim() || !email.trim() || !password.trim()) return
    setConfig(companyInput.trim())
    setStatus('connecting', null)
    try {
      const resp = await login(companyInput.trim(), email, password)
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
    setStatus('fetching', null)

    // Remove any existing api_lookup file to avoid stacking stale results
    const existing = files.find((f) => f.type === 'api_lookup')
    if (existing) removeFile(existing.id)

    try {
      const assets = await queryAllAssets(company, accessToken)

      // Phase 2: collect lineage nodes for the first asset key from each
      // unique connection — gives the matching engine richer schema/table context
      const keysSeen = new Set<string>()
      const assetKeys = assets
        .filter((a) => { const k = a._key; if (!k || keysSeen.has(k)) return false; keysSeen.add(k); return true })
        .slice(0, 20) // cap to avoid hitting rate limits in Phase 2
        .map((a) => a._key)

      const lineageResults = await Promise.allSettled(
        assetKeys.map((key) => queryLineage(company, accessToken, key))
      )
      const lineageNodes = lineageResults
        .flatMap((r) => (r.status === 'fulfilled' ? r.value.nodes : []))

      const file = assetsToDiscoveryFile(assets, lineageNodes, `API — ${company}`)
      addFile(file)
      setStatus('done', null)
    } catch (err) {
      setStatus('error', err instanceof Error ? err.message : String(err))
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

        <button onClick={clearSession} className="btn-ghost">
          <LogOut className="w-4 h-4" />
          Disconnect
        </button>
      </div>

      {apiFile && (
        <p className="text-xs text-muted">
          Fetched {apiFile.rowCount} assets from {company}.octopai.com — injected as discovery source
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
    </div>
  )
}
