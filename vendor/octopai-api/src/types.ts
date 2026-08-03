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
  assetName?: string      // column name at column-level granularity
  isObjectData?: boolean  // true = actual DB object; false = ETL/mapping node
  toolName?: string       // Octopai tool identifier (e.g. 'SNOWFLAKE', 'ORACLE', 'UNK')
  toolType?: string       // asset category ('DB', 'ETL', 'REPORT')
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
