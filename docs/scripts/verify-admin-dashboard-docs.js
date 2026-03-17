/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const docsRoot = path.join(__dirname, '..');
const repoRoot = path.join(docsRoot, '..');

const navDocPath = path.join(docsRoot, 'docs', 'admin-dashboard', 'navigation-map.md');
const sidebarPath = path.join(repoRoot, 'packages', 'admin', 'src', 'lib', 'components', 'layout', 'Sidebar.svelte');
const routesDir = path.join(repoRoot, 'packages', 'admin', 'src', 'routes');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function walk(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

function normalizeAdminRoute(suffix) {
  if (!suffix || suffix === '/') return '/admin';
  return `/admin${suffix}`;
}

function extractSidebarItems() {
  const source = read(sidebarPath);
  const items = [{ label: 'Overview', route: '/admin' }];
  const itemRegex = /\{ label: '([^']+)', href: `\$\{base\}([^`]+)`, icon: '[^']+' \}/g;

  for (const match of source.matchAll(itemRegex)) {
    items.push({
      label: match[1],
      route: normalizeAdminRoute(match[2]),
    });
  }

  return items;
}

function extractPageRoutes() {
  const files = walk(routesDir);
  const routes = [];

  files.forEach((filePath) => {
    if (!filePath.endsWith('+page.svelte')) {
      return;
    }

    const relPath = path.relative(routesDir, filePath).replace(/\\/g, '/');
    const routeSuffix = relPath === '+page.svelte'
      ? ''
      : relPath.replace(/\/\+page\.svelte$/, '');

    routes.push(normalizeAdminRoute(routeSuffix ? `/${routeSuffix}` : ''));
  });

  return Array.from(new Set(routes)).sort();
}

function verifyAdminDashboardDocs() {
  const navDoc = read(navDocPath);
  const sidebarItems = extractSidebarItems();
  const pageRoutes = extractPageRoutes();

  pageRoutes.forEach((route) => {
    assert(
      navDoc.includes(`\`${route}\``),
      `Admin dashboard navigation map is missing route \`${route}\``
    );
  });

  sidebarItems.forEach(({ label, route }) => {
    assert(navDoc.includes(label), `Admin dashboard navigation map is missing label "${label}"`);
    assert(
      navDoc.includes(`\`${route}\``),
      `Admin dashboard navigation map is missing sidebar route \`${route}\``
    );
  });
}

try {
  verifyAdminDashboardDocs();
  console.log('verify-admin-dashboard-docs: OK');
} catch (error) {
  console.error(`verify-admin-dashboard-docs: ${error.message}`);
  process.exit(1);
}
