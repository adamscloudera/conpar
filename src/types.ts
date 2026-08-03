export type TemplateType = 'REPORT' | 'ETL';

export type TemplateRow = {
  connectionLogicName: string;
  toolName: string;
  key: string;       // Octopai connection identifier (e.g. "Impala Cloudera Kerberos Cuali DELEGATION")
  path: string;      // Report Path or Folder Path
  serverName: string;
  databaseName: string;
  schemaName: string;
};

export type LineageRow = {
  sourceConnectionKey: string;   // col "Database Name" in lineage CSV = Key in template
  sourceSchemaName: string;      // physical schema name
  sourceObjectName: string;      // physical table name
  sourceConnectionName: string;  // col "Connection Name" = Connection Logic Name in template
  targetReportPath: string;      // col "Report Path"
};

export type ImpalaColumnsRow = {
  databaseName: string;
  schemaName: string;
  objectName: string;
  objectType: string;
  columnName: string;
  dataType: string;
  connectionLogicName: string;
  connectionId: string;
};

export type DiscoveryFileType = 'lineage_map' | 'impala_columns' | 'api_lookup' | 'unknown';

export type DiscoveryFile = {
  id: string;
  filename: string;
  type: DiscoveryFileType;
  rowCount: number;
  lineageRows: LineageRow[];
  impalaRows: ImpalaColumnsRow[];
};

export type CandidateSignals = {
  pathTokenOverlap: number;
  tableNameOverlap: number;
  sourceFrequency: number;
  keyDbOverlap: number;
};

export type CandidateSchema = {
  databaseName: string;
  schemaName: string;
  score: number;
  signals: CandidateSignals;
  sourceFile: string;
};

export type MappingStatus =
  | 'pre_filled'       // row already had values in source template
  | 'auto_filled'      // single candidate, filled automatically
  | 'needs_selection'  // multiple candidates, awaiting engineer choice
  | 'confirmed'        // engineer confirmed or selected a candidate
  | 'no_match'         // no discovery data matched this row
  | 'manual'           // engineer typed values directly
  | 'not_applicable';  // connection type has no DB/schema concept (Salesforce, Redshift, file path)

export type MappingResult = {
  rowIndex: number;
  templateRow: TemplateRow;
  candidates: CandidateSchema[];
  selectedCandidate: CandidateSchema | null;
  manualDatabase: string;
  manualSchema: string;
  status: MappingStatus;
};

export type SearchSuggestion = {
  terms: string[];
  coverage: number;
};

export type ConnectionScopeConfig = {
  // Maps each template connection key to an explicit Octopai connectionLogicName.
  // When set, DB/schema candidates for that key are sourced only from that connection's
  // API assets. Keys not in the map use all loaded data (existing behavior).
  keyConnectionMap: Record<string, string>;
};
