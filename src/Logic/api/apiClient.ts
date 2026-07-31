// Octopai Extraction API client
// Auth: POST /api/UserAccount/Login → accessToken (2hr) + refreshToken (30d)
// Assets: POST /api/v2.0/assets/query → asset metadata by ConnectionIds
// Lineage: POST /api/v2.0/lineage → relationship graph from an asset key
//
// CORS note: Octopai is a SaaS product; direct browser requests may be blocked
// if the tenant does not send Access-Control-Allow-Origin headers. If you see
// "Failed to fetch" with no response body, set up a local proxy:
//   Vite dev: enable server.proxy in vite.config.ts and set VITE_OCTOPAI_BASE_URL
//   Production nginx: add proxy_pass for /octopai-proxy/ to the tenant URL

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

function tenantUrl(company: string): string {
  return `https://${company}.octopai.com`
}

async function apiPost<T>(url: string, body: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  } catch (err) {
    const msg = err instanceof TypeError ? 'Network error — CORS may be blocking this request. See apiClient.ts for proxy setup.' : String(err)
    throw new Error(msg)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
  }

  return res.json() as Promise<T>
}

export async function login(company: string, username: string, password: string): Promise<LoginResponse> {
  const url = `${tenantUrl(company)}/api/UserAccount/Login`
  const data = await apiPost<LoginResponse>(url, { Username: username, Password: password })
  if (data.error) throw new Error(data.error)
  return data
}

export async function queryAssets(
  company: string,
  token: string,
  connectionIds: string[],
  limit = 10000,
): Promise<AssetsQueryResponse> {
  const url = `${tenantUrl(company)}/api/v2.0/assets/query`
  return apiPost<AssetsQueryResponse>(url, { ConnectionIds: connectionIds, limit, assetType: 2 }, token)
}

export async function queryAllAssets(
  company: string,
  token: string,
  connectionIds: string[],
): Promise<AssetItem[]> {
  const all: AssetItem[] = []
  const first = await queryAssets(company, token, connectionIds)
  all.push(...first.items)

  if (first.hasMore && first.cursorId) {
    let cursor = first.cursorId
    while (cursor) {
      const url = `https://${company}.octopai.com/api/v2.0/assets/query/scroll/${cursor}`
      let res: Response
      try {
        res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        })
      } catch (err) {
        break
      }
      if (!res.ok) break
      const page: AssetsQueryResponse = await res.json()
      all.push(...page.items)
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
  const url = `${tenantUrl(company)}/api/v2.0/lineage`
  return apiPost<LineageResponse>(url, { assetKey, depth, limit: 500, assetType: 2, direction: 2 }, token)
}
