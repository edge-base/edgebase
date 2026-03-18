import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const siteMetadata = require('./site-metadata.json') as {
  searchContexts: Array<{ label: string; path: string }>;
};

const config: Config = {
  title: 'EdgeBase',
  tagline: 'The Open-Source Backend That Runs Everywhere',
  favicon: 'img/logo-icon.svg',

  future: {
    v4: true,
  },

  headTags: [
    {
      tagName: 'link',
      attributes: {
        rel: 'preconnect',
        href: 'https://fonts.googleapis.com',
      },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossorigin: 'anonymous',
      },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
      },
    },
  ],

  url: 'https://edgebase.fun',
  baseUrl: '/',

  organizationName: 'edge-base',
  projectName: 'edgebase',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
    localeConfigs: {
      en: { label: 'English' },
    },
  },

  plugins: [
    [
      'docusaurus-plugin-llms',
      {
        generateLLMsTxt: true,
        generateLLMsFullTxt: true,
        excludeImports: true,
        removeDuplicateHeadings: true,
      },
    ],
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/edge-base/edgebase/tree/main/docs/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themes: [
    [
      require.resolve('@easyops-cn/docusaurus-search-local'),
      {
        indexDocs: true,
        indexPages: true,
        indexBlog: false,
        language: ['en'],
        docsRouteBasePath: ['docs'],
        hashed: true,
        highlightSearchTermsOnTargetPage: true,
        explicitSearchResultPath: true,
        searchResultLimits: 10,
        searchResultContextMaxLength: 80,
        searchBarShortcut: true,
        searchBarShortcutHint: true,
        useAllContextsWithNoSearchContext: true,
        searchContextByPaths: siteMetadata.searchContexts,
      },
    ],
  ],

  themeConfig: {
    image: 'img/docusaurus-social-card.jpg',
    docs: {
      sidebar: {
        hideable: true,
        autoCollapseCategories: true,
      },
    },
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'EdgeBase',
      logo: {
        alt: 'EdgeBase Logo',
        src: 'img/logo-icon.svg',
      },
      items: [
        {
          label: 'Build',
          position: 'left',
          items: [
            {label: 'Getting Started', to: '/docs/getting-started'},
            {label: 'Quickstart', to: '/docs/getting-started/quickstart'},
            {label: 'Database', to: '/docs/database'},
            {label: 'Authentication', to: '/docs/authentication'},
            {label: 'Room', to: '/docs/room'},
            {label: 'Storage', to: '/docs/storage'},
            {label: 'App Functions', to: '/docs/functions'},
            {label: 'Push Notifications', to: '/docs/push'},
            {label: 'Analytics', to: '/docs/analytics'},
          ],
        },
        {
          label: 'Tooling',
          position: 'left',
          items: [
            {label: 'SDKs', to: '/docs/sdks'},
            {label: 'CLI', to: '/docs/cli'},
            {label: 'Admin Dashboard', to: '/docs/admin-dashboard'},
            {label: 'Server', to: '/docs/server'},
            {label: 'Plugins', to: '/docs/plugins'},
          ],
        },
        {
          label: 'Learn',
          position: 'left',
          items: [
            {label: 'Guides', to: '/docs/guides'},
            {label: 'Why EdgeBase', to: '/docs/why-edgebase'},
            {label: 'Architecture', to: '/docs/architecture'},
            {label: 'FAQ', to: '/docs/faq'},
          ],
        },
        {
          type: 'doc',
          docId: 'api/overview',
          label: 'API',
          position: 'right',
        },
        {
          type: 'search',
          position: 'right',
        },
        {
          href: 'https://github.com/edge-base/edgebase',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            { label: 'Getting Started', to: '/docs/getting-started' },
            { label: 'SDKs', to: '/docs/sdks' },
            { label: 'CLI', to: '/docs/cli' },
          ],
        },
        {
          title: 'Platform',
          items: [
            { label: 'Database', to: '/docs/database' },
            { label: 'Authentication', to: '/docs/authentication' },
            { label: 'App Functions', to: '/docs/functions' },
          ],
        },
        {
          title: 'Learn',
          items: [
            { label: 'Guides', to: '/docs/guides' },
            { label: 'Why EdgeBase', to: '/docs/why-edgebase' },
            { label: 'Architecture', to: '/docs/architecture' },
          ],
        },
        {
          title: 'Community',
          items: [
            { label: 'GitHub', href: 'https://github.com/edge-base/edgebase' },
            { label: 'Discord', href: 'https://discord.gg/edgebase' },
            { label: 'Issues', href: 'https://github.com/edge-base/edgebase/issues' },
          ],
        },
        {
          title: 'More',
          items: [
            { label: 'API Reference', to: '/docs/api' },
            { label: 'FAQ', to: '/docs/faq' },
            {
              label: 'Contributing',
              href: 'https://github.com/edge-base/edgebase/blob/main/CONTRIBUTING.md',
            },
            { label: 'Self-Hosting', to: '/docs/getting-started/self-hosting' },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} EdgeBase. MIT License.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: [
        'bash',
        'dart',
        'swift',
        'kotlin',
        'java',
        'groovy',
        'python',
        'json',
        'sql',
        'yaml',
        'docker',
        'csharp',
        'php',
        'rust',
        'go',
        'cpp',
        'toml',
        'ruby',
        'scala',
        'elixir',
      ],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
