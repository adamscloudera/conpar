import type { AssetItem, LineageNode } from '@adamscloudera/octopai-api'

export type ConnectionInsight = {
  name: string
  assetCount: number
  objectTypes: Record<string, number>
}

export type CrossSystemPair = {
  from: string
  to: string
  linkCount: number
}

export type TopNodeDegree = {
  objectName: string
  connectionName: string
  degree: number
}

export type InsightMetrics = {
  tenantName: string
  fetchedAt: string
  fetchDurationSeconds: number
  totalAssets: number
  uniqueConnections: number
  connections: ConnectionInsight[]
  objectTypeBreakdown: Record<string, number>
  distinctDatabases: number
  distinctSchemas: number
  lineageLinkCount: number
  crossSystemLinkCount: number
  crossSystemPairs: CrossSystemPair[]
  topNodesByDegree: TopNodeDegree[]
  maxLineageDepth: number
  sampledKeyCount: number
}

export function computeInsightMetrics(
  tenantName: string,
  assets: AssetItem[],
  lineageLinks: { from: string; to: string }[],
  lineageNodes: LineageNode[],
  sampledKeyCount: number,
  fetchedAt: string,
  lineageDepths: number[] = [],
  fetchDurationSeconds = 0,
): InsightMetrics {
  // By-connection breakdown — group raw assets before any adapter deduplication
  const connMap = new Map<string, ConnectionInsight>()
  for (const asset of assets) {
    const name = asset.connectionName?.trim() || '(unlabeled)'
    let conn = connMap.get(name)
    if (!conn) {
      conn = { name, assetCount: 0, objectTypes: {} }
      connMap.set(name, conn)
    }
    conn.assetCount++
    const type = asset.objectType?.trim()
    if (type) conn.objectTypes[type] = (conn.objectTypes[type] ?? 0) + 1
  }
  const connections = [...connMap.values()].sort((a, b) => b.assetCount - a.assetCount)

  // Full object type distribution
  const objectTypeBreakdown: Record<string, number> = {}
  for (const asset of assets) {
    const type = asset.objectType?.trim() || '(unknown)'
    objectTypeBreakdown[type] = (objectTypeBreakdown[type] ?? 0) + 1
  }

  // Distinct databases and schemas (-1 sentinels treated as unresolved)
  const dbs = new Set<string>()
  const schemas = new Set<string>()
  for (const asset of assets) {
    if (asset.databaseName && asset.databaseName !== '-1') dbs.add(asset.databaseName)
    if (asset.schemaName && asset.schemaName !== '-1') schemas.add(asset.schemaName)
  }

  // Cross-system lineage: build _key→connectionName from assets + lineage nodes
  // Assets are the primary source; lineage nodes fill gaps for schema-level nodes
  const keyToConn = new Map<string, string>()
  for (const asset of assets) {
    if (asset._key && asset.connectionName) keyToConn.set(asset._key, asset.connectionName)
  }
  for (const node of lineageNodes) {
    if (node._key && node.connectionName && !keyToConn.has(node._key)) {
      keyToConn.set(node._key, node.connectionName)
    }
  }

  const pairMap = new Map<string, CrossSystemPair>()
  let crossSystemLinkCount = 0
  for (const link of lineageLinks) {
    const fromConn = keyToConn.get(link.from)
    const toConn = keyToConn.get(link.to)
    // Skip if either side is unresolvable or same-system
    if (!fromConn || !toConn || fromConn === toConn) continue
    crossSystemLinkCount++
    const pairKey = `${fromConn}\x00${toConn}`
    const existing = pairMap.get(pairKey)
    if (existing) {
      existing.linkCount++
    } else {
      pairMap.set(pairKey, { from: fromConn, to: toConn, linkCount: 1 })
    }
  }
  const crossSystemPairs = [...pairMap.values()].sort((a, b) => b.linkCount - a.linkCount)

  // Total link count (all links, including same-system)
  const lineageLinkCount = lineageLinks.length

  // Max lineage depth from the fulfilled lineage responses
  const maxLineageDepth = lineageDepths.length > 0 ? Math.max(...lineageDepths) : 0

  // Top 3 nodes by total degree (in + out appearances in lineageLinks)
  const degreeMap = new Map<string, number>()
  for (const link of lineageLinks) {
    if (link.from) degreeMap.set(link.from, (degreeMap.get(link.from) ?? 0) + 1)
    if (link.to) degreeMap.set(link.to, (degreeMap.get(link.to) ?? 0) + 1)
  }

  // Resolve _key → { objectName, connectionName } — lineage nodes first, assets as fallback
  const keyToMeta = new Map<string, { objectName: string; connectionName: string }>()
  for (const node of lineageNodes) {
    if (node._key) {
      keyToMeta.set(node._key, {
        objectName: node.objectName ?? '',
        connectionName: node.connectionName ?? '',
      })
    }
  }
  for (const asset of assets) {
    if (asset._key && !keyToMeta.has(asset._key)) {
      keyToMeta.set(asset._key, {
        objectName: asset.objectName ?? '',
        connectionName: asset.connectionName ?? '',
      })
    }
  }

  const topNodesByDegree: TopNodeDegree[] = [...degreeMap.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([key, degree]) => {
      const meta = keyToMeta.get(key)
      return {
        objectName: meta?.objectName || key,
        connectionName: meta?.connectionName ?? '',
        degree,
      }
    })

  return {
    tenantName,
    fetchedAt,
    fetchDurationSeconds,
    totalAssets: assets.length,
    uniqueConnections: connMap.size,
    connections,
    objectTypeBreakdown,
    distinctDatabases: dbs.size,
    distinctSchemas: schemas.size,
    lineageLinkCount,
    crossSystemLinkCount,
    crossSystemPairs,
    topNodesByDegree,
    maxLineageDepth,
    sampledKeyCount,
  }
}
