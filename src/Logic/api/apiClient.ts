// Octopai Extraction API client
// All requests go through the same-origin nginx proxy at /conpar/octopai-proxy/
// with the tenant host in X-Octopai-Host, avoiding CORS entirely.
// In Vite dev mode the proxy router in vite.config.ts performs the same forwarding.

export type LoginResponse = {
  accessToken: string
  expiration: string
  refreshToken: { token: string; expiration: string }
  userName: string
  displayName: string
  error: string | null
}

export type AssetItem = {
  _key: string
  databaseName?: string
  schemaName?: string
  objectName?: string
  objectType?: string
  connectionName?: string
  connectionId?: string
  layerName?: string
}

export type AssetsQueryResponse = {
  items: AssetItem[]
  hasMore: boolean
  cursorId?: string
}

export type LineageNode = {
  _key: string
  databaseName?: string
  schemaName?: string
  objectName?: string
  objectType?: string
  connectionName?: string
}

export type LineageResponse = {
  nodes: LineageNode[]
  links: Array<{ from: string; to: string; type?: string }>
  mainNode: string
  depth: number
  direction: number
}

// Routes through the nginx (or Vite dev) proxy to avoid CORS.
// The proxy is at /conpar/octopai-proxy/; tenant is identified by X-Octopai-Host.
function proxyUrl(path: string): string {
  return `/conpar/octopai-proxy${path}`
}

async function apiPost<T>(company: string, path: string, body: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Octopai-Host': `${company}.octopai.com`,
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(proxyUrl(path), { method: 'POST', headers, body: JSON.stringify(body) })
  } catch (err) {
    throw new Error(err instanceof TypeError ? 'Network error — could not reach the proxy.' : String(err))
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
  }

  return res.json() as Promise<T>
}

export async function login(company: string, username: string, password: string): Promise<LoginResponse> {
  const data = await apiPost<LoginResponse>(company, '/api/UserAccount/Login', { Username: username, Password: password })
  if (data.error) throw new Error(data.error)
  return data
}

export async function queryAssets(
  company: string,
  token: string,
  limit = 10000,
): Promise<AssetsQueryResponse> {
  // ConnectionIds in the API expects numeric Octopai connection IDs, not the
  // string keys from templates. Query without that filter; matching engine
  // handles relevance scoring against the returned asset list.
  return apiPost<AssetsQueryResponse>(company, '/api/v2.0/assets/query', { limit, assetType: 2 }, token)
}

export async function queryAllAssets(
  company: string,
  token: string,
  onProgress?: (fetched: number) => void,
): Promise<AssetItem[]> {
  const all: AssetItem[] = []
  const first = await queryAssets(company, token)
  all.push(...first.items)
  onProgress?.(all.length)

  if (first.hasMore && first.cursorId) {
    let cursor = first.cursorId
    while (cursor) {
      let res: Response
      try {
        res = await fetch(proxyUrl(`/api/v2.0/assets/query/scroll/${cursor}`), {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Octopai-Host': `${company}.octopai.com` },
        })
      } catch {
        break
      }
      if (!res.ok) break
      const page: AssetsQueryResponse = await res.json()
      all.push(...page.items)
      onProgress?.(all.length)
      cursor = page.hasMore ? (page.cursorId ?? '') : ''
    }
  }

  return all
}

export async function queryLineage(
  company: string,
  token: string,
  assetKey: string,
  depth = 2,
): Promise<LineageResponse> {
  return apiPost<LineageResponse>(company, '/api/v2.0/lineage', { assetKey, depth, limit: 500, assetType: 2, direction: 2 }, token)
}
