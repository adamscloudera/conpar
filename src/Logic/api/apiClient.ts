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

const REQUEST_TIMEOUT_MS = 60_000
// Docs ceiling is 10,000; documented example uses 1,000 — use that as the default.
const DEFAULT_PAGE_SIZE = 1000

// Link an external AbortSignal into a local AbortController so a single
// controller can merge both a timeout and caller-initiated cancellation.
function linkSignal(controller: AbortController, external?: AbortSignal): void {
  if (!external) return
  if (external.aborted) {
    controller.abort(external.reason)
    return
  }
  external.addEventListener('abort', () => controller.abort(external.reason), { once: true })
}

async function apiPost<T>(
  company: string,
  path: string,
  body: unknown,
  token?: string,
  signal?: AbortSignal,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Octopai-Host': `${company}.octopai.com`,
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const controller = new AbortController()
  linkSignal(controller, signal)
  // Timer stays armed through both header receipt and body streaming.
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const res = await fetch(proxyUrl(path), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
    }

    // await so that JSON parse errors are caught here and so the finally
    // block does not fire until the body is fully streamed.
    return await res.json() as T
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      if (signal?.aborted) throw new Error('Request cancelled.')
      throw new Error(
        `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s — Octopai did not respond. ` +
        `The tenant may be unavailable or the query returned too many assets.`,
      )
    }
    if (err instanceof TypeError) throw new Error('Network error — could not reach the proxy.')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

async function scrollFetch(
  company: string,
  token: string,
  cursor: string,
  signal?: AbortSignal,
): Promise<AssetsQueryResponse> {
  const controller = new AbortController()
  linkSignal(controller, signal)
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const res = await fetch(proxyUrl(`/api/v2.0/assets/query/scroll/${cursor}`), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Octopai-Host': `${company}.octopai.com`,
      },
      signal: controller.signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Scroll HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
    }

    return await res.json() as AssetsQueryResponse
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      if (signal?.aborted) throw new Error('Asset fetch cancelled.')
      throw new Error(`Scroll request timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`)
    }
    if (err instanceof TypeError) throw new Error('Network error during scroll — could not reach the proxy.')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export async function login(company: string, username: string, password: string): Promise<LoginResponse> {
  const data = await apiPost<LoginResponse>(company, '/api/UserAccount/Login', { Username: username, Password: password })
  if (data.error) throw new Error(data.error)
  return data
}

export async function queryAssets(
  company: string,
  token: string,
  limit = DEFAULT_PAGE_SIZE,
  signal?: AbortSignal,
): Promise<AssetsQueryResponse> {
  // ConnectionIds in the API expects numeric Octopai connection IDs, not the
  // string keys from templates. Query without that filter; matching engine
  // handles relevance scoring against the returned asset list.
  return apiPost<AssetsQueryResponse>(company, '/api/v2.0/assets/query', { limit, assetType: 2 }, token, signal)
}

export async function queryAllAssets(
  company: string,
  token: string,
  onProgress?: (fetched: number) => void,
  signal?: AbortSignal,
): Promise<AssetItem[]> {
  const all: AssetItem[] = []

  const first = await queryAssets(company, token, DEFAULT_PAGE_SIZE, signal)
  all.push(...first.items)
  onProgress?.(all.length)

  if (first.hasMore && first.cursorId) {
    let cursor: string | undefined = first.cursorId
    while (cursor) {
      if (signal?.aborted) throw new Error('Asset fetch cancelled.')
      const page = await scrollFetch(company, token, cursor, signal)
      all.push(...page.items)
      onProgress?.(all.length)
      cursor = page.hasMore ? page.cursorId : undefined
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
