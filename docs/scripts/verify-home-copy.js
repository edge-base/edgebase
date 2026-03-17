/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const docsRoot = path.join(__dirname, '..');
const metadata = require(path.join(docsRoot, 'site-metadata.json'));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function main() {
  const sdkLanguageCount = metadata.sdkLanguages.length;
  const oauthProviderCount = metadata.oauthProviderCount;
  const deployModeCount = metadata.deployModes.length;

  const checks = [
    {
      file: path.join(docsRoot, 'src', 'pages', 'index.tsx'),
      snippets: [
        "import siteMetadata from '../../site-metadata.json';",
        'const sdkLanguageCount = siteMetadata.sdkLanguages.length;',
        'const deployModeCount = siteMetadata.deployModes.length;',
        'const oauthProviderCount = siteMetadata.oauthProviderCount;',
        'const docsEntryPoints = siteMetadata.docsEntryPoints;',
        '<h2>Choose Your Path</h2>',
        '{docsEntryPoints.map((entry) => (',
        `<h2>One Codebase, {deployModeCount} Deploy Modes</h2>`,
        `{siteMetadata.sdkPackageHeadline} SDK packages across {sdkLanguageCount} languages`,
      ],
    },
    {
      file: path.join(docsRoot, 'docs', 'index.mdx'),
      snippets: [
        `${metadata.sdkPackageHeadline} SDK Packages`,
        `Across ${sdkLanguageCount} languages:`,
        `OAuth (${oauthProviderCount} providers)`,
        `Official SDKs for ${sdkLanguageCount} languages`,
      ],
    },
    {
      file: path.join(docsRoot, 'docs', 'getting-started', 'introduction.md'),
      snippets: [
        `SDKs for **${sdkLanguageCount} languages**`,
        `OAuth (${oauthProviderCount} providers:`,
        `all three modes`,
      ],
    },
    {
      file: path.join(docsRoot, 'docs', 'authentication', 'overview.mdx'),
      snippets: [
        `${oauthProviderCount} OAuth providers`,
        `and ${oauthProviderCount - 4} more providers`,
        `Social login with ${oauthProviderCount} providers`,
      ],
    },
    {
      file: path.join(docsRoot, 'docs', 'sdks', 'overview.md'),
      snippets: [
        `official SDKs for **${sdkLanguageCount} languages**`,
      ],
    },
  ];

  for (const { file, snippets } of checks) {
    const content = read(file);
    for (const snippet of snippets) {
      assert(content.includes(snippet), `${path.relative(docsRoot, file)} must include: ${snippet}`);
    }
  }

  console.log(
    `✅ Home copy verification passed (${sdkLanguageCount} languages, ${oauthProviderCount} OAuth providers, ${deployModeCount} deploy modes)`
  );
}

main();
