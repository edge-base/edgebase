/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const docsRoot = path.join(__dirname, '..');
const oauthDir = path.join(docsRoot, 'docs', 'authentication', 'oauth');
const metadata = require(path.join(docsRoot, 'site-metadata.json'));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

function getFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : '';
}

function getFrontmatterValue(frontmatter, field) {
  const match = frontmatter.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim() : null;
}

function getProviderSlugs() {
  return fs
    .readdirSync(oauthDir, {withFileTypes: true})
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'index.md')
    .map((entry) => entry.name.replace(/\.md$/, ''))
    .sort();
}

function verifyOAuthStructure(expectedCount) {
  const overviewPath = path.join(oauthDir, 'index.md');
  const overviewFrontmatter = getFrontmatter(read(overviewPath));
  const categoryMetadata = JSON.parse(read(path.join(oauthDir, '_category_.json')));

  assert(getFrontmatterValue(overviewFrontmatter, 'sidebar_position') === '0', 'authentication/oauth/index.md must define sidebar_position: 0');
  assert(
    getFrontmatterValue(overviewFrontmatter, 'sidebar_label') === 'Overview',
    'authentication/oauth/index.md must define sidebar_label: Overview'
  );
  assert(categoryMetadata.label === 'OAuth', 'authentication/oauth/_category_.json must use the OAuth label');
  assert(categoryMetadata.position === 8, 'authentication/oauth/_category_.json must keep the OAuth slot in Authentication');
  assert(
    categoryMetadata.link && categoryMetadata.link.type === 'doc' && categoryMetadata.link.id === 'authentication/oauth/index',
    'authentication/oauth/_category_.json must link to authentication/oauth/index'
  );

  const seenPositions = new Map();
  const providers = fs
    .readdirSync(oauthDir, {withFileTypes: true})
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'index.md');

  for (const provider of providers) {
    const providerPath = path.join(oauthDir, provider.name);
    const frontmatter = getFrontmatter(read(providerPath));
    const position = getFrontmatterValue(frontmatter, 'sidebar_position');

    assert(position !== null, `authentication/oauth/${provider.name} must define sidebar_position`);
    assert(!seenPositions.has(position), `${provider.name} reuses sidebar_position ${position}`);
    seenPositions.set(position, provider.name);
  }

  for (let i = 1; i <= expectedCount; i += 1) {
    assert(seenPositions.has(String(i)), `OAuth provider sidebar_position ${i} is missing`);
  }
}

function verifyCountCopy(providerCount) {
  const overviewNamedProviders = 4;
  const checks = [
    {
      file: path.join(docsRoot, 'docs', 'authentication', 'oauth', 'index.md'),
      snippets: [
        `supports ${providerCount} OAuth providers out of the box`,
        `Beyond the ${providerCount} built-in providers`,
      ],
    },
    {
      file: path.join(docsRoot, 'docs', 'authentication', 'overview.mdx'),
      snippets: [
        `${providerCount} OAuth providers`,
        `and ${providerCount - overviewNamedProviders} more providers`,
        `Social login with ${providerCount} providers`,
      ],
    },
    {
      file: path.join(docsRoot, 'docs', 'getting-started', 'configuration.md'),
      snippets: [`${providerCount} providers total`],
    },
    {
      file: path.join(docsRoot, 'docs', 'getting-started', 'introduction.md'),
      snippets: [`OAuth (${providerCount} providers:`],
    },
    {
      file: path.join(docsRoot, 'docs', 'index.mdx'),
      snippets: [`OAuth (${providerCount} providers)`],
    },
    {
      file: path.join(docsRoot, 'docs', 'faq.md'),
      snippets: [`${providerCount} OAuth providers`],
    },
    {
      file: path.join(docsRoot, 'src', 'pages', 'index.tsx'),
      snippets: [
        'const oauthProviderCount = siteMetadata.oauthProviderCount;',
        "label: 'OAuth Providers'",
        'value: String(oauthProviderCount)',
        `siteMetadata.oauthProviderExamples.join(', ')} & more`,
      ],
    },
  ];

  for (const {file, snippets} of checks) {
    const content = read(file);
    for (const snippet of snippets) {
      assert(content.includes(snippet), `${path.relative(docsRoot, file)} must include: ${snippet}`);
    }
  }
}

function main() {
  const providerSlugs = getProviderSlugs();
  assert(
    providerSlugs.length === metadata.oauthProviderCount,
    `site-metadata.json oauthProviderCount must be ${providerSlugs.length}, got ${metadata.oauthProviderCount}`
  );
  verifyOAuthStructure(providerSlugs.length);
  verifyCountCopy(providerSlugs.length);
  console.log(`✅ OAuth docs verification passed (${providerSlugs.length} providers)`);
}

main();
