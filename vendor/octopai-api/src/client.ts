import type {
  LoginResponse,
  AssetsQueryResponse,
  AssetItem,
  LineageNode,
  LineageResponse,
} from './types.ts'

export type OctopaiClient = {
  login(company: string, username: string, password: string): Promise<LoginResponse>
  queryAssets(company: string, token: string, limit?: number, signal?: AbortSignal): Promise<AssetsQueryResponse>
  queryAllAssets(
    company: string,
    token: string,
    onProgress?: (fetched: number) => void,
    signal?: AbortSignal,
  ): Promise<AssetItem[]>
  queryLineage(
    company: string,
    token: string,
    assetKey: string,
    depth?: number,
    signal?: AbortSignal,
  ): Promise<LineageResponse>
}

const REQUEST_TIMEOUT_MS = 60_000
const DEFAULT_PAGE_SIZE = 10_000

// Merge an external AbortSignal into a locally-owned controller so a single
// controller can gate both timeout and caller-initiated cancellation.
function linkSignal(controller: AbortController, external?: AbortSignal): void {
  if (!external) return
  if (external.aborted) { controller.abort(external.reason); return }
  external.addEventListener('abort', () => controller.abort(external.reason), { once: true })
}

export function createOctopaiClient(proxyBase: string): OctopaiClient {
  // All requests route through the caller-supplied proxy base.
  // Production: nginx proxy_pass; development: Vite proxy config.
  function proxyUrl(path: string): string {
    return `${proxyBase}${path}`
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
      const data = await res.json() as T
      return data
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

  async function login(company: string, username: string, password: string): Promise<LoginResponse> {
    const data = await apiPost<LoginResponse>(company, '/api/UserAccount/Login', {
      Username: username,
      Password: password,
    })
    if (data.error) throw new Error(data.error)
    return data
  }

  // The API returns connLogicName/tableName; normalize to the AssetItem contract.
  // Different Octopai tenants/versions use different casings — try all known variants.
  function normalizeItem(raw: Record<string, unknown>): AssetItem {
    return {
      ...(raw as AssetItem),
      connectionName: String(
        raw.connLogicName ??
        raw.ConnLogicName ??
        raw.connectionLogicName ??
        raw.ConnectionLogicName ??
        raw.connectionName ??
        raw.ConnectionName ??
        '',
      ),
      objectName: String(raw.tableName ?? raw.TableName ?? raw.objectName ?? raw.ObjectName ?? ''),
    }
  }

  function normalizeResponse(resp: AssetsQueryResponse): AssetsQueryResponse {
    return { ...resp, items: resp.items.map(normalizeItem) }
  }

  async function queryAssets(
    company: string,
    token: string,
    limit = DEFAULT_PAGE_SIZE,
    signal?: AbortSignal,
  ): Promise<AssetsQueryResponse> {
    const resp = await apiPost<AssetsQueryResponse>(
      company,
      '/api/v2.0/assets/query',
      { limit, assetType: 1, IsMap: false },
      token,
      signal,
    )
    return normalizeResponse(resp)
  }

  async function queryAllAssets(
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
        const raw = await scrollFetch(company, token, cursor, signal)
        const page = normalizeResponse(raw)
        all.push(...page.items)
        onProgress?.(all.length)
        cursor = page.hasMore ? page.cursorId : undefined
      }
    }

    return all
  }

  async function queryLineage(
    company: string,
    token: string,
    assetKey: string,
    depth = 2,
    signal?: AbortSignal,
  ): Promise<LineageResponse> {
    const resp = await apiPost<LineageResponse>(
      company,
      '/api/v2.0/lineage',
      { assetKey, depth, limit: 500, assetType: 2, direction: 2 },
      token,
      signal,
    )
    return {
      ...resp,
      nodes: (resp.nodes ?? []).map((n) => normalizeItem(n as Record<string, unknown>) as LineageNode),
    }
  }

  return { login, queryAssets, queryAllAssets, queryLineage }
}
