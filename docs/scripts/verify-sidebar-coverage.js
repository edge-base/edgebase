/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const docsRoot = path.join(__dirname, '..');
const docsDir = path.join(docsRoot, 'docs');
const sidebarsPath = path.join(docsRoot, 'sidebars.ts');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function walkMarkdownFiles(dir, files = []) {
  const entries = fs.readdirSync(dir, {withFileTypes: true});
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

function getFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : '';
}

function getFrontmatterValue(frontmatter, field) {
  const match = frontmatter.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim() : null;
}

function collectCategoryDirs(rootDir) {
  const dirs = [];

  function hasDocDescendants(dir) {
    const entries = fs.readdirSync(dir, {withFileTypes: true});
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && hasDocDescendants(fullPath)) {
        return true;
      }
      if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.mdx'))) {
        return true;
      }
    }
    return false;
  }

  function visit(dir) {
    const entries = fs.readdirSync(dir, {withFileTypes: true});
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (!hasDocDescendants(fullPath)) {
        continue;
      }
      dirs.push(fullPath);
      visit(fullPath);
    }
  }

  visit(rootDir);
  return dirs;
}

function loadSidebars() {
  const source = read(sidebarsPath)
    .replace(/^\s*import[^\n]*\n/gm, '')
    .replace(/^\s*export default sidebars;\s*$/m, 'module.exports = sidebars;');

  const sandbox = {
    module: {exports: {}},
    exports: {},
  };

  vm.runInNewContext(source, sandbox, {filename: sidebarsPath});
  return sandbox.module.exports;
}

function collectSidebarDocIds(sidebars) {
  const docIds = [];
  const seen = new Set();
  const duplicates = new Set();

  function addDocId(docId) {
    if (seen.has(docId)) {
      duplicates.add(docId);
      return;
    }
    seen.add(docId);
    docIds.push(docId);
  }

  function visit(item) {
    if (!item) {
      return;
    }

    if (typeof item === 'string') {
      addDocId(item);
      return;
    }

    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }

    if (typeof item !== 'object') {
      return;
    }

    if (item.type === 'doc') {
      assert(typeof item.id === 'string' && item.id.length > 0, 'doc sidebar items must define id');
      addDocId(item.id);
      return;
    }

    if (item.type === 'category') {
      if (item.link && item.link.type === 'doc') {
        assert(
          typeof item.link.id === 'string' && item.link.id.length > 0,
          'category doc links must define id'
        );
        addDocId(item.link.id);
      }

      assert(Array.isArray(item.items), `category "${item.label}" must define items`);
      item.items.forEach(visit);
      return;
    }

    throw new Error(`Unsupported sidebar item type "${item.type}" in ${sidebarsPath}`);
  }

  for (const sidebarItems of Object.values(sidebars)) {
    visit(sidebarItems);
  }

  return {docIds, duplicates: Array.from(duplicates).sort()};
}

function getVisibleDocIds() {
  const files = walkMarkdownFiles(docsDir);
  const docIds = [];

  for (const filePath of files) {
    const relPath = path.relative(docsDir, filePath).replace(/\\/g, '/');
    const docId = relPath.replace(/\.(md|mdx)$/, '');
    const frontmatter = getFrontmatter(read(filePath));
    const isUnlisted = getFrontmatterValue(frontmatter, 'unlisted') === 'true';

    if (docId === 'index' || isUnlisted) {
      continue;
    }

    docIds.push(docId);
  }

  return docIds.sort();
}

function verifySidebarCoverage() {
  const sidebars = loadSidebars();
  assert(sidebars && typeof sidebars === 'object', 'sidebars.ts must export a sidebar object');
  assert(Array.isArray(sidebars.docsSidebar), 'sidebars.ts must define docsSidebar');

  const {docIds: sidebarDocIds, duplicates} = collectSidebarDocIds(sidebars);
  const visibleDocIds = getVisibleDocIds();

  assert(duplicates.length === 0, `sidebars.ts duplicates doc ids: ${duplicates.join(', ')}`);

  const sidebarSet = new Set(sidebarDocIds);
  const visibleSet = new Set(visibleDocIds);

  const missingFromSidebar = visibleDocIds.filter((docId) => !sidebarSet.has(docId));
  const missingFromDocs = sidebarDocIds.filter((docId) => !visibleSet.has(docId));

  assert(
    missingFromSidebar.length === 0,
    `Visible docs missing from sidebars.ts: ${missingFromSidebar.join(', ')}`
  );
  assert(
    missingFromDocs.length === 0,
    `sidebars.ts references docs that do not exist or are unlisted: ${missingFromDocs.join(', ')}`
  );
}

function verifyLandingDoc() {
  const landingPath = path.join(docsDir, 'index.mdx');
  const landingFrontmatter = getFrontmatter(read(landingPath));
  assert(
    getFrontmatterValue(landingFrontmatter, 'unlisted') === 'true',
    'docs/index.mdx must remain unlisted so the landing page does not appear in the sidebar'
  );
}

function verifyDocsHavePositions() {
  const files = walkMarkdownFiles(docsDir);
  const positionsByDir = new Map();

  for (const filePath of files) {
    const relPath = path.relative(docsDir, filePath).replace(/\\/g, '/');
    const docId = relPath.replace(/\.(md|mdx)$/, '');
    const dir = path.posix.dirname(docId);
    const frontmatter = getFrontmatter(read(filePath));
    const isUnlisted = getFrontmatterValue(frontmatter, 'unlisted') === 'true';

    if (docId === 'index' || isUnlisted) {
      continue;
    }

    const sidebarPosition = getFrontmatterValue(frontmatter, 'sidebar_position');
    assert(sidebarPosition !== null, `${relPath} must define sidebar_position`);

    if (!positionsByDir.has(dir)) {
      positionsByDir.set(dir, new Map());
    }

    const seen = positionsByDir.get(dir);
    assert(
      !seen.has(sidebarPosition),
      `${relPath} reuses sidebar_position ${sidebarPosition} already used by ${seen.get(sidebarPosition)}`
    );
    seen.set(sidebarPosition, relPath);
  }
}

function verifyCategoryMetadata() {
  const categoryDirs = collectCategoryDirs(docsDir);
  const positionsByParent = new Map();

  for (const dir of categoryDirs) {
    const relDir = path.relative(docsDir, dir).replace(/\\/g, '/');
    const categoryPath = path.join(dir, '_category_.json');

    assert(fs.existsSync(categoryPath), `${relDir} must define _category_.json`);

    const metadata = JSON.parse(read(categoryPath));
    assert(
      typeof metadata.label === 'string' && metadata.label.length > 0,
      `${relDir} _category_.json must define label`
    );
    assert(
      typeof metadata.position === 'number',
      `${relDir} _category_.json must define numeric position`
    );
    assert(
      metadata.link && metadata.link.type === 'doc',
      `${relDir} _category_.json must use a doc link`
    );
    assert(
      typeof metadata.link.id === 'string' && metadata.link.id.length > 0,
      `${relDir} _category_.json must define link.id`
    );

    const parentDir = path.posix.dirname(relDir);
    if (!positionsByParent.has(parentDir)) {
      positionsByParent.set(parentDir, new Map());
    }

    const seen = positionsByParent.get(parentDir);
    assert(
      !seen.has(metadata.position),
      `${relDir} reuses category position ${metadata.position} already used by ${seen.get(metadata.position)}`
    );
    seen.set(metadata.position, relDir);
  }
}

function verifyLegacyPathsAreGone() {
  assert(
    !fs.existsSync(path.join(docsDir, 'architecture', 'cost-analysis.md')),
    'architecture/cost-analysis.md should not exist after the Why EdgeBase split'
  );
  assert(
    !fs.existsSync(path.join(docsDir, 'architecture', 'data-isolation.md')),
    'architecture/data-isolation.md should not exist after the Why EdgeBase split'
  );
}

function main() {
  verifySidebarCoverage();
  verifyLandingDoc();
  verifyDocsHavePositions();
  verifyCategoryMetadata();
  verifyLegacyPathsAreGone();
  console.log('✅ Sidebar structure verification passed (manual IA + full doc coverage + ordered docs)');
}

main();
