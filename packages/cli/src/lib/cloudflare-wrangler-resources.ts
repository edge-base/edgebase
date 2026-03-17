export interface WranglerR2Bucket {
  binding: string;
  bucketName: string;
  jurisdiction?: string;
}

export interface WranglerD1Database {
  binding: string;
  databaseName: string;
  databaseId?: string;
}

export interface WranglerKvNamespace {
  binding: string;
  id?: string;
}

export interface WranglerVectorize {
  binding: string;
  indexName: string;
}

export interface WranglerHyperdrive {
  binding: string;
  id: string;
}

export interface WranglerResourceConfig {
  workerName: string;
  r2Buckets: WranglerR2Bucket[];
  d1Databases: WranglerD1Database[];
  kvNamespaces: WranglerKvNamespace[];
  vectorizeIndexes: WranglerVectorize[];
  hyperdriveConfigs: WranglerHyperdrive[];
}

function getTomlBlockValues(content: string, blockName: string): string[] {
  const pattern = new RegExp(`\\[\\[${blockName}\\]\\]([\\s\\S]*?)(?=\\n\\[\\[|\\n\\[|$)`, 'g');
  return [...content.matchAll(pattern)].map((match) => match[1] ?? '');
}

function readTomlString(block: string, key: string): string | undefined {
  const match = block.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, 'm'));
  return match?.[1];
}

export function parseWranglerResourceConfig(content: string): WranglerResourceConfig {
  const workerName = content.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? '';
  const r2Buckets: WranglerR2Bucket[] = [];
  for (const block of getTomlBlockValues(content, 'r2_buckets')) {
    const binding = readTomlString(block, 'binding');
    const bucketName = readTomlString(block, 'bucket_name');
    if (!binding || !bucketName) continue;

    const bucket: WranglerR2Bucket = { binding, bucketName };
    const jurisdiction = readTomlString(block, 'jurisdiction');
    if (jurisdiction) {
      bucket.jurisdiction = jurisdiction;
    }
    r2Buckets.push(bucket);
  }

  const d1Databases: WranglerD1Database[] = [];
  for (const block of getTomlBlockValues(content, 'd1_databases')) {
    const binding = readTomlString(block, 'binding');
    const databaseName = readTomlString(block, 'database_name');
    if (!binding || !databaseName) continue;

    const databaseId = readTomlString(block, 'database_id');
    d1Databases.push({ binding, databaseName, databaseId });
  }

  const kvNamespaces: WranglerKvNamespace[] = [];
  for (const block of getTomlBlockValues(content, 'kv_namespaces')) {
    const binding = readTomlString(block, 'binding');
    if (!binding) continue;

    const id = readTomlString(block, 'id');
    kvNamespaces.push({ binding, id });
  }

  const vectorizeIndexes: WranglerVectorize[] = [];
  for (const block of getTomlBlockValues(content, 'vectorize')) {
    const binding = readTomlString(block, 'binding');
    const indexName = readTomlString(block, 'index_name');
    if (!binding || !indexName) continue;
    vectorizeIndexes.push({ binding, indexName });
  }

  const hyperdriveConfigs: WranglerHyperdrive[] = [];
  for (const block of getTomlBlockValues(content, 'hyperdrive')) {
    const binding = readTomlString(block, 'binding');
    const id = readTomlString(block, 'id');
    if (!binding || !id) continue;
    hyperdriveConfigs.push({ binding, id });
  }

  return { workerName, r2Buckets, d1Databases, kvNamespaces, vectorizeIndexes, hyperdriveConfigs };
}
