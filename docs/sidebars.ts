const authOAuthCategory = {
  type: 'category',
  label: 'OAuth',
  link: {type: 'doc', id: 'authentication/oauth/index'},
  items: [
    {
      type: 'category',
      label: 'Common Providers',
      items: [
        'authentication/oauth/google',
        'authentication/oauth/github',
        'authentication/oauth/apple',
        'authentication/oauth/microsoft',
      ],
    },
    {
      type: 'category',
      label: 'Additional Providers',
      items: [
        'authentication/oauth/discord',
        'authentication/oauth/facebook',
        'authentication/oauth/x',
        'authentication/oauth/reddit',
        'authentication/oauth/slack',
        'authentication/oauth/spotify',
        'authentication/oauth/twitch',
      ],
    },
    {
      type: 'category',
      label: 'Regional Providers',
      items: [
        'authentication/oauth/kakao',
        'authentication/oauth/naver',
        'authentication/oauth/line',
      ],
    },
  ],
};

const sidebars = {
  docsSidebar: [
    {
      type: 'category',
      label: 'Start Building',
      collapsible: true,
      collapsed: false,
      items: [
        {
          type: 'category',
          label: 'Getting Started',
          link: {type: 'doc', id: 'getting-started/introduction'},
          items: [
            'getting-started/quickstart',
            'getting-started/configuration',
            'getting-started/deployment',
            'getting-started/self-hosting',
          ],
        },
        {
          type: 'category',
          label: 'Database',
          link: {type: 'doc', id: 'database/overview'},
          items: [
            {
              type: 'category',
              label: 'Model and Evolve Data',
              items: [
                'database/create-database',
                'database/defining-tables',
                'database/migrations',
              ],
            },
            {
              type: 'category',
              label: 'Read and Write Data',
              items: [
                'database/client-sdk',
                'database/admin-sdk',
                'database/subscriptions',
                'database/server-side-filters',
              ],
            },
            {
              type: 'category',
              label: 'Access Rules, Triggers, and Hooks',
              items: [
                'database/access-rules',
                'database/triggers',
                'database/hooks',
              ],
            },
            'database/advanced',
            'database/sdk-support',
            {
              type: 'category',
              label: 'Limits & Pricing',
              items: [
                'database/limits',
                'database/pricing',
              ],
            },
          ],
        },
        {
          type: 'category',
          label: 'Authentication',
          link: {type: 'doc', id: 'authentication/overview'},
          items: [
            {
              type: 'category',
              label: 'Choose a Sign-In Method',
              items: [
                'authentication/email-password',
                'authentication/magic-link',
                'authentication/email-otp',
                'authentication/phone-auth',
                'authentication/passkeys',
                'authentication/anonymous',
                authOAuthCategory,
                'authentication/oidc-federation',
              ],
            },
            {
              type: 'category',
              label: 'Account and Session Management',
              items: [
                'authentication/sessions',
                'authentication/session-management',
                'authentication/email-change',
                'authentication/account-linking',
                'authentication/mfa',
                'authentication/password-policy',
                'authentication/ban-disable',
              ],
            },
            {
              type: 'category',
              label: 'Access Rules and Hooks',
              items: [
                'authentication/access-rules',
                'authentication/hooks',
                'functions/mail-hooks',
              ],
            },
            {
              type: 'category',
              label: 'Backend Operations',
              items: [
                'authentication/admin-users',
                'authentication/user-import',
                'authentication/captcha',
              ],
            },
            'authentication/oauth-callback',
            'authentication/error-codes',
            'authentication/sdk-support',
            {
              type: 'category',
              label: 'Limits & Pricing',
              items: [
                'authentication/limits',
                'authentication/pricing',
              ],
            },
          ],
        },
        {
          type: 'category',
          label: 'Storage',
          link: {type: 'doc', id: 'storage/overview'},
          items: [
            {
              type: 'category',
              label: 'Core File Workflows',
              items: [
                'storage/upload-download',
                'storage/signed-urls',
                'storage/multipart',
                'storage/metadata',
              ],
            },
            {
              type: 'category',
              label: 'Access Rules and Hooks',
              items: [
                'storage/access-rules',
                'storage/hooks',
              ],
            },
            'storage/sdk-support',
            {
              type: 'category',
              label: 'Limits & Pricing',
              items: [
                'storage/limits',
                'storage/pricing',
              ],
            },
          ],
        },
        {
          type: 'category',
          label: 'App Functions',
          link: {type: 'doc', id: 'functions/overview'},
          items: [
            {
              type: 'category',
              label: 'Trigger Types',
              items: [
                'functions/triggers',
              ],
            },
            {
              type: 'category',
              label: 'Runtime APIs',
              items: [
                'functions/context-api',
                'functions/client-sdk',
                'functions/middleware',
                'functions/error-handling',
              ],
            },
            'functions/sdk-support',
            {
              type: 'category',
              label: 'Limits & Pricing',
              items: [
                'functions/limits',
                'functions/pricing',
              ],
            },
          ],
        },
        {
          type: 'category',
          label: 'Room',
          link: {type: 'doc', id: 'room/overview'},
          items: [
            {
              type: 'category',
              label: 'Core Capabilities',
              items: [
                'room/state',
                'room/meta',
                'room/members',
                'room/signals',
                'room/media',
              ],
            },
            {
              type: 'category',
              label: 'Runtime and Configuration',
              items: [
                'room/client-sdk',
                'room/server',
                'room/access-rules',
                'room/sdk-support',
                'room/advanced',
                'room/advanced-patterns',
              ],
            },
            {
              type: 'category',
              label: 'Limits & Pricing',
              items: [
                'room/limits',
                'room/pricing',
              ],
            },
          ],
        },
        {
          type: 'category',
          label: 'Push Notifications',
          link: {type: 'doc', id: 'push/overview'},
          items: [
            {
              type: 'category',
              label: 'Configuration and Sending',
              items: [
                'push/configuration',
                'push/client-sdk',
                'push/admin-sdk',
              ],
            },
            {
              type: 'category',
              label: 'Access Rules and Hooks',
              items: [
                'push/access-rules',
                'push/hooks',
              ],
            },
            'push/sdk-support',
            {
              type: 'category',
              label: 'Limits & Pricing',
              items: [
                'push/limits',
                'push/pricing',
              ],
            },
          ],
        },
        {
          type: 'category',
          label: 'Analytics',
          link: {type: 'doc', id: 'analytics/overview'},
          items: [
            'analytics/client-sdk',
            'analytics/admin-sdk',
            'analytics/sdk-support',
            {
              type: 'category',
              label: 'Limits & Pricing',
              items: [
                'analytics/limits',
                'analytics/pricing',
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Developer Tools',
      items: [
        {
          type: 'category',
          label: 'SDKs',
          link: {type: 'doc', id: 'sdks/overview'},
          items: [
            {
              type: 'category',
              label: 'Choose the Right SDK',
              items: [
                'sdks/client-vs-server',
                'sdks/layer-matrix',
                'sdks/architecture',
              ],
            },
            {
              type: 'category',
              label: 'Stack Guides',
              items: [
                'sdks/nextjs',
                'sdks/flutter',
              ],
            },
            'sdks/verification-matrix',
          ],
        },
        {
          type: 'category',
          label: 'Admin SDK Reference',
          items: [
            'admin-sdk/reference',
          ],
        },
        {
          type: 'category',
          label: 'CLI',
          link: {type: 'doc', id: 'cli/overview'},
          items: [
            'cli/workflows',
            'cli/reference',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Operate and Extend',
      items: [
        {
          type: 'category',
          label: 'Admin Dashboard',
          link: {type: 'doc', id: 'admin-dashboard/overview'},
          items: [
            'admin-dashboard/schema-editor',
            'admin-dashboard/analytics',
            'admin-dashboard/navigation-map',
          ],
        },
        {
          type: 'category',
          label: 'Server',
          link: {type: 'doc', id: 'server/overview'},
          items: [
            {
              type: 'category',
              label: 'Core Configuration',
              items: [
                'server/config-reference',
                'server/service-keys',
                'server/access-rules',
                'server/email',
                'server/rate-limiting',
              ],
            },
            {
              type: 'category',
              label: 'Extension Points',
              items: [
                'server/enrich-auth',
                'server/native-resources',
                'server/raw-sql',
              ],
            },
          ],
        },
        {
          type: 'category',
          label: 'Plugins',
          link: {type: 'doc', id: 'plugins/overview'},
          items: [
            'plugins/using-plugins',
            'plugins/creating-plugins',
            'plugins/api-reference',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Guides and Concepts',
      items: [
        {
          type: 'category',
          label: 'Guides',
          link: {type: 'doc', id: 'guides/overview'},
          items: [
            'guides/choosing-live-features',
            'guides/data-modeling',
            'guides/real-world-patterns',
            'guides/migration',
            'guides/backup-restore',
            'guides/cost-optimization',
            'guides/i18n-localization',
            'guides/example-todo-app',
            'guides/troubleshooting',
          ],
        },
        {
          type: 'category',
          label: 'Why EdgeBase',
          link: {type: 'doc', id: 'why-edgebase/overview'},
          items: [
            'why-edgebase/cost-analysis',
            'why-edgebase/data-isolation',
          ],
        },
        {
          type: 'category',
          label: 'Architecture',
          link: {type: 'doc', id: 'architecture/overview'},
          items: [
            'architecture/security-model',
            'architecture/auth-architecture',
            'architecture/database-internals',
            'architecture/database-live-internals',
            'architecture/deployment',
            'architecture/rate-limiting',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        {
          type: 'category',
          label: 'API Reference',
          link: {type: 'doc', id: 'api/overview'},
          items: [
            'api/authentication',
            'api/database',
            'api/storage',
            'api/database-subscriptions',
            'api/room',
            'api/push',
            'api/analytics',
            'api/functions',
            'api/admin',
            'api/native-resources',
            'api/system',
          ],
        },
        'faq',
      ],
    },
  ],
};

export default sidebars;
