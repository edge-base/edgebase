/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const docsRoot = path.join(__dirname, '..');
const workspaceRoot = path.join(docsRoot, '..');
const docsDir = path.join(docsRoot, 'docs');
const configPath = path.join(docsRoot, 'docusaurus.config.ts');
const readmePath = path.join(workspaceRoot, 'README.md');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

function walkMarkdownFiles(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkMarkdownFiles(fullPath, files);
      continue;
    }
    if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) {
      files.push(fullPath);
    }
  }
  return files;
}

function verifyLocales() {
  const config = read(configPath);
  assert(config.includes("defaultLocale: 'en'"), 'defaultLocale must be en');
  assert(config.includes("locales: ['en']"), "locales must match the current Docusaurus config");
}

function verifySdkTabs() {
  const files = walkMarkdownFiles(docsDir);
  let tabBlockCount = 0;
  for (const file of files) {
    const content = read(file);
    const blocks = content.match(/<Tabs groupId="sdk-language">([\s\S]*?)<\/Tabs>/g) || [];
    for (const block of blocks) {
      tabBlockCount += 1;
      const labels = [...block.matchAll(/<TabItem[^>]*label="([^"]+)"/g)].map((match) => match[1]);
      assert(labels.length >= 1, `${path.relative(docsRoot, file)} sdk-language tab block must include at least one tab`);
      assert(block.includes(' default'), `${path.relative(docsRoot, file)} sdk-language tab block must declare a default tab`);
      assert(new Set(labels).size === labels.length, `${path.relative(docsRoot, file)} sdk-language tab block must not duplicate labels`);
    }
  }

  assert(tabBlockCount > 0, 'No sdk-language tab blocks found');
}

function verifyApiReference(filePath) {
  const content = read(filePath);
  const rel = path.relative(workspaceRoot, filePath);

  assert(content.includes('/api/db'), `${rel} must reference /api/db`);
  assert(!content.includes('/ws'), `${rel} must not reference /ws`);

  assert(content.includes('/api/collections/:name?upsert=true'), `${rel} must include upsert query-mode endpoint`);
  assert(content.includes('/api/collections/:name/batch-by-filter'), `${rel} must include batch-by-filter endpoint`);
  assert(content.includes('?filter=[["status","==","published"]]'), `${rel} must document tuple filter format`);
  assert(content.includes('?sort=createdAt:desc'), `${rel} must document sort query parameter`);

  assert(content.includes('/api/storage/:bucket/upload'), `${rel} must include storage upload endpoint`);
  assert(content.includes('/api/storage/:bucket/signed-url'), `${rel} must include signed-url endpoint`);
  assert(content.includes('/api/storage/:bucket/signed-upload-url'), `${rel} must include signed-upload-url endpoint`);

  assert(content.includes('"code": 400'), `${rel} must use numeric error code example`);
  assert(!content.includes('"error": {'), `${rel} must not use nested error wrapper format`);
  assert(!content.includes('VALIDATION_ERROR'), `${rel} must not use string error code enums`);
  assert(content.includes('"type": "batch_changes", "channel": "realtime:shared:posts"'), `${rel} must use canonical channel field in batch_changes example`);
  assert(!content.includes('"type": "batch_changes", "collection": "posts"'), `${rel} must not use collection field in batch_changes example`);
}

function verifyStorageDocs(baseDir) {
  const signedUrlPath = path.join(baseDir, 'storage', 'signed-urls.md');
  const multipartPath = path.join(baseDir, 'storage', 'multipart.md');

  const signed = read(signedUrlPath);
  const multipart = read(multipartPath);
  const relSigned = path.relative(workspaceRoot, signedUrlPath);
  const relMultipart = path.relative(workspaceRoot, multipartPath);

  assert(signed.includes('/api/storage/:bucket/signed-url'), `${relSigned} must include /:bucket/signed-url`);
  assert(signed.includes('/api/storage/:bucket/signed-upload-url'), `${relSigned} must include /:bucket/signed-upload-url`);
  assert(!signed.includes('/api/storage/:bucket/:key/signed-url'), `${relSigned} must not use key-scoped signed-url endpoint`);
  assert(!signed.includes('/api/storage/:bucket/:key/signed-upload-url'), `${relSigned} must not use key-scoped signed-upload-url endpoint`);

  assert(multipart.includes('/api/storage/:bucket/uploads/:uploadId/parts?key='), `${relMultipart} must document resume parts endpoint`);
  assert(!multipart.includes('Upload resume is not currently supported'), `${relMultipart} must not claim resume is unsupported`);
}

function verifyCliReference(filePath) {
  const content = read(filePath);
  const rel = path.relative(workspaceRoot, filePath);

  assert(content.includes('/api/db'), `${rel} must reference /api/db WebSocket endpoint`);
  assert(!content.includes('/ws'), `${rel} must not reference /ws`);

  assert(content.includes('npx edgebase typegen'), `${rel} must include typegen command`);
  assert(content.includes('npx edgebase logs'), `${rel} must include logs command`);
  assert(content.includes('npx edgebase backup create'), `${rel} must include backup command`);
  assert(!content.includes('npx edgebase generate'), `${rel} must not reference deprecated generate command`);
}

function verifyFunctionDocs(baseDir) {
  const overviewMdPath = path.join(baseDir, 'functions', 'overview.md');
  const overviewMdxPath = path.join(baseDir, 'functions', 'overview.mdx');
  const overviewPath = fs.existsSync(overviewMdxPath) ? overviewMdxPath : overviewMdPath;
  const triggersPath = path.join(baseDir, 'functions', 'triggers.md');

  const overview = read(overviewPath);
  const triggers = read(triggersPath);
  const relOverview = path.relative(workspaceRoot, overviewPath);
  const relTriggers = path.relative(workspaceRoot, triggersPath);

  const legacyPatterns = [
    "trigger: 'db'",
    "trigger: 'http'",
    "trigger: 'schedule'",
    "trigger: 'auth'",
  ];

  for (const p of legacyPatterns) {
    assert(!overview.includes(p), `${relOverview} must use object trigger format, found legacy ${p}`);
    assert(!triggers.includes(p), `${relTriggers} must use object trigger format, found legacy ${p}`);
  }

  assert(overview.includes("trigger: { type: 'db'"), `${relOverview} must include object-form db trigger`);
  assert(overview.includes("trigger: { type: 'http'"), `${relOverview} must include object-form http trigger`);
  assert(overview.includes("trigger: { type: 'schedule'"), `${relOverview} must include object-form schedule trigger`);
  assert(overview.includes("trigger: { type: 'auth'"), `${relOverview} must include object-form auth trigger`);
}

function resolveFirstExistingPath(...relativePaths) {
  for (const relativePath of relativePaths) {
    const fullPath = path.join(...relativePath);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }

  throw new Error(`Expected one of these docs to exist: ${relativePaths.map((parts) => parts.join('/')).join(', ')}`);
}

function verifyRealtimeDocs(baseDir) {
  const subscriptionsPath = resolveFirstExistingPath(
    [baseDir, 'database', 'subscriptions.md'],
    [baseDir, 'realtime', 'subscriptions.md']
  );
  const filtersPath = resolveFirstExistingPath(
    [baseDir, 'database', 'server-side-filters.md'],
    [baseDir, 'realtime', 'server-side-filters.md']
  );
  const content = read(subscriptionsPath);
  const rel = path.relative(workspaceRoot, subscriptionsPath);

  assert(!content.includes('share a single WebSocket connection'), `${rel} must not claim tabs share one WebSocket connection`);

  const filtersContent = read(filtersPath);
  const relFilters = path.relative(workspaceRoot, filtersPath);
  assert(filtersContent.includes('{ serverFilter: true }'), `${relFilters} must include serverFilter usage`);
}

function verifyNoLegacyTriggerSyntax(baseDir) {
  const legacyPatterns = [
    "trigger: 'db'",
    "trigger: 'http'",
    "trigger: 'schedule'",
    "trigger: 'auth'",
  ];

  const files = walkMarkdownFiles(baseDir);
  for (const filePath of files) {
    const content = read(filePath);
    const rel = path.relative(workspaceRoot, filePath);
    for (const pattern of legacyPatterns) {
      assert(!content.includes(pattern), `${rel} must not include legacy trigger syntax: ${pattern}`);
    }
  }
}

function verifyReadmeDocsLink() {
  const readme = read(readmePath);
  assert(readme.includes('https://edgebase.fun/docs'), 'README must include docs site link');
}

function verifyContractSync() {
  const currentApi = path.join(docsDir, 'api-reference.md');
  const currentCli = path.join(docsDir, 'cli', 'reference.md');

  if (fs.existsSync(currentApi)) {
    verifyApiReference(currentApi);
  }
  if (fs.existsSync(currentCli)) {
    verifyCliReference(currentCli);
  }
  verifyStorageDocs(docsDir);
  verifyFunctionDocs(docsDir);
  verifyRealtimeDocs(docsDir);
  verifyNoLegacyTriggerSyntax(docsDir);
}

function main() {
  verifyLocales();
  verifySdkTabs();
  verifyContractSync();
  verifyReadmeDocsLink();
  console.log('✅ M25 verification passed');
}

main();
