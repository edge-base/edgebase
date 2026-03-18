import React from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import { getPlatformToken } from '../lib/platformTokens';
import siteMetadata from '../../site-metadata.json';

const sdkLanguageCount = siteMetadata.sdkLanguages.length;
const deployModeCount = siteMetadata.deployModes.length;
const oauthProviderCount = siteMetadata.oauthProviderCount;
const docsEntryPoints = siteMetadata.docsEntryPoints;
const homeSdkItems = [
  { key: 'JavaScript', label: 'JavaScript / React Native' },
  { key: 'Python', label: 'Python' },
  { key: 'Dart', label: 'Dart / Flutter' },
  { key: 'Swift', label: 'Swift' },
  { key: 'Kotlin', label: 'Kotlin' },
  { key: 'Java', label: 'Java' },
  { key: 'Scala', label: 'Scala' },
  { key: 'Go', label: 'Go' },
  { key: 'PHP', label: 'PHP' },
  { key: 'Rust', label: 'Rust' },
  { key: 'C#', label: 'C# / Unity' },
  { key: 'C++', label: 'C++ / Unreal' },
  { key: 'Ruby', label: 'Ruby' },
  { key: 'Elixir', label: 'Elixir' },
];
const homeStats = [
  { value: '148×', label: 'Cheaper', sub: 'vs Firebase at 1M MAU' },
  { value: '~0ms', label: 'Cold Start', sub: '300+ edge locations' },
  { value: '$0', label: 'Auth & Egress', sub: 'No MAU charges, ever' },
  {
    value: String(sdkLanguageCount),
    label: 'SDK Languages',
    sub: 'JS · Dart · Swift · Kotlin · Scala · Elixir & more',
  },
  {
    value: String(oauthProviderCount),
    label: 'OAuth Providers',
    sub: `${siteMetadata.oauthFeaturedProviders.join(', ')} & more`,
  },
  {
    value: String(deployModeCount),
    label: 'Deploy Modes',
    sub: siteMetadata.deployModes.join(' · '),
  },
];

function HeroSection() {
  return (
    <section className="hero-section">
      <p className="hero-badge">Open Source · MIT License</p>
      <h1 className="hero-title">
        100× cheaper. 100× faster
        <br />
        than Firebase & Supabase.
      </h1>
      <p className="hero-tagline">
        Infinite scaling — without changing a line of code.
        <br />
        Database · Auth · Storage · Functions · Room · Admin UI — all built in.
      </p>
      <div className="hero-code">
        <code>npm create edgebase@latest my-app</code>
      </div>
      <div className="hero-buttons">
        <Link className="hero-btn hero-btn-primary" to="/docs/getting-started/quickstart">
          Get Started →
        </Link>
        <Link className="hero-btn hero-btn-secondary" to="/docs/why-edgebase">
          Why EdgeBase
        </Link>
      </div>
    </section>
  );
}

function StatsSection() {
  return (
    <section className="stats-section">
      <div className="stats-grid">
        {homeStats.map((s, i) => (
          <div key={i} className="stat-card">
            <div className="stat-value">{s.value}</div>
            <div className="stat-label">{s.label}</div>
            <div className="stat-sub">{s.sub}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function EntryPointsSection() {
  return (
    <section className="entrypoints-section">
      <h2>Choose Your Path</h2>
      <p className="section-subtitle">
        Start with the angle you care about most: why the architecture matters, how to ship fast,
        how to extend the platform, or where to find the exact API surface.
      </p>
      <div className="entrypoints-grid">
        {docsEntryPoints.map((entry) => (
          <Link key={entry.path} className="entry-card" to={entry.path}>
            <div className="entry-card-tag">{entry.tag}</div>
            <h3>{entry.title}</h3>
            <p>{entry.description}</p>
            <div className="entry-card-footer">
              <span>Open docs</span>
              <span aria-hidden="true">→</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function CostSection() {
  return (
    <section className="comparison-section">
      <h2>Why 100× Cheaper?</h2>
      <p className="section-subtitle">
        Auth MAU billing and egress are the two biggest cost drivers at scale. EdgeBase removes
        both, and database subscriptions stay inside DO compute instead of turning into a separate per-recipient
        bill.
      </p>
      <div className="comparison-table-wrap">
        <table>
          <thead>
            <tr>
              <th>1M MAU scenario</th>
              <th>Firebase</th>
              <th>Supabase</th>
              <th>Appwrite</th>
              <th>EdgeBase</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Auth</strong>
              </td>
              <td>$4,415</td>
              <td>$2,925</td>
              <td>$2,400</td>
              <td>
                <strong>$0</strong>
              </td>
            </tr>
            <tr>
              <td>
                <strong>Egress (100 TB)</strong>
              </td>
              <td>$12,000</td>
              <td>$8,978</td>
              <td>$14,700</td>
              <td>
                <strong>$0</strong>
              </td>
            </tr>
            <tr>
              <td>
                <strong>DB Subscriptions (900M msg)</strong>
              </td>
              <td>$5,400</td>
              <td>$2,263</td>
              <td>$630</td>
              <td>
                <strong>$0</strong>
              </td>
            </tr>
            <tr>
              <td>
                <strong>DB + Compute + Storage</strong>
              </td>
              <td>$233</td>
              <td>$131</td>
              <td>$136</td>
              <td>$149</td>
            </tr>
            <tr>
              <td>
                <strong>Total</strong>
              </td>
              <td>
                <strong>$22,048/mo</strong>
              </td>
              <td>
                <strong>$14,297/mo</strong>
              </td>
              <td>
                <strong>$17,866/mo</strong>
              </td>
              <td>
                <strong>~$149/mo</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="section-subtitle" style={{ marginTop: '1rem', fontSize: '0.8rem' }}>
        1M MAU social app scenario — ~$149/mo. $5/mo is account-level — one subscription covers
        unlimited projects. Self-hosted (Docker / Node.js): VPS cost only.
      </p>
    </section>
  );
}

function SpeedSection() {
  return (
    <section className="comparison-section">
      <h2>Why 100× Faster?</h2>
      <p className="section-subtitle">
        V8 isolates pre-warmed at 300+ edge locations worldwide. No container boot, no runtime init.
      </p>
      <div className="comparison-table-wrap">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Firebase</th>
              <th>Supabase</th>
              <th>Appwrite</th>
              <th>EdgeBase</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Cold start</strong>
              </td>
              <td>Seconds</td>
              <td>~1s</td>
              <td>~1s</td>
              <td>
                <strong>~0ms</strong>
              </td>
            </tr>
            <tr>
              <td>
                <strong>Edge locations</strong>
              </td>
              <td>❌ single region</td>
              <td>❌ single region</td>
              <td>❌ single region</td>
              <td>
                <strong>300+ cities</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ScalingSection() {
  return (
    <section className="features-section">
      <h2>Why Infinite Scaling?</h2>
      <p className="section-subtitle">
        Scale to millions of independent databases — per user, per workspace, per tenant, however
        you design it — without changing your code or schema.
      </p>
      <div className="features-grid">
        <div className="feature-card">
          <div className="feature-icon">🗄️</div>
          <h3>Isolated DB Blocks</h3>
          <p>
            Dynamic DB blocks can give each user, workspace, or tenant its own isolated
            SQLite-backed Durable Object. Heavy traffic in one workspace does not slow down another.
          </p>
        </div>
        <div className="feature-card">
          <div className="feature-icon">🔌</div>
          <h3>DB Blocks — Physical Isolation</h3>
          <p>
            <code>{"db('user', id)"}</code> — per-user, per-workspace, or per-company. Each gets an
            independent database. Zero config sharding.
          </p>
        </div>
        <div className="feature-card">
          <div className="feature-icon">🔗</div>
          <h3>Shared DB Block + JOIN</h3>
          <p>
            Tables in the same DB block share one SQLite backing database, enabling SQL JOINs.
            Single-instance blocks can default to D1, while isolated multi-tenant blocks stay on
            Durable Objects.
          </p>
        </div>
      </div>
    </section>
  );
}

const features = [
  {
    icon: '🗄️',
    title: 'Database',
    description:
      'SQLite across D1 and Durable Objects — full SQL, JOINs, transactions, FTS5 full-text search (CJK included), automatic schema migrations, and UUID v7 cursor pagination.',
  },
  {
    icon: '🔐',
    title: 'Authentication',
    description:
      `Email/password, magic link, phone/SMS, MFA, ${oauthProviderCount} OAuth providers (${siteMetadata.oauthProviderExamples.join(', ')} & more), anonymous auth — $0 forever, no MAU charges.`,
  },
  {
    icon: '⚡',
    title: 'Database Subscriptions',
    description:
      'WebSocket live queries via onSnapshot with server-side filters. Hibernation API keeps idle connections at $0.',
  },
  {
    icon: '📦',
    title: 'Storage',
    description:
      'R2-based file storage with $0 egress, signed URLs for upload & download, multipart uploads, and bucket-level access rules.',
  },
  {
    icon: '⚙️',
    title: 'App Functions',
    description:
      'DB triggers, HTTP endpoints, cron schedules, and auth hooks (beforeSignUp, afterSignIn, beforePasswordReset) — all server-side TypeScript.',
  },
  {
    icon: '🔒',
    title: 'Access Rules',
    description:
      'Deny-by-default TypeScript access rules with auth, resource, request, and context accessors. No eval(), bundled directly into the runtime.',
  },
];

function FeaturesSection() {
  return (
    <section className="features-section">
      <h2>Everything Built In</h2>
      <p className="section-subtitle">
        Database · Auth · Storage · Functions · Room · Admin UI — no third-party services
        needed.
      </p>
      <div className="features-grid">
        {features.map((f, i) => (
          <div key={i} className="feature-card">
            <div className="feature-icon">{f.icon}</div>
            <h3>{f.title}</h3>
            <p>{f.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function DeploySection() {
  return (
    <section className="deploy-section">
      <h2>One Codebase, {deployModeCount} Deploy Modes</h2>
      <p className="section-subtitle">
        The same code runs identically everywhere — no rewrites, no vendor lock-in.
      </p>
      <div className="deploy-grid">
        <div className="deploy-card">
          <div className="deploy-card-header">
            <span className="deploy-icon">☁️</span>
            <h3>Cloudflare Edge</h3>
          </div>
          <code className="deploy-cmd">npx edgebase deploy</code>
          <ul className="deploy-features">
            <li>~0ms cold start</li>
            <li>300+ global locations</li>
            <li>Auto-scaling</li>
            <li>From $5/month (all projects)</li>
          </ul>
        </div>
        <div className="deploy-card">
          <div className="deploy-card-header">
            <span className="deploy-icon">🐳</span>
            <h3>Docker</h3>
          </div>
          <code className="deploy-cmd">npx edgebase docker run</code>
          <ul className="deploy-features">
            <li>Full data ownership</li>
            <li>Single container</li>
            <li>Volume persistence</li>
            <li>VPS cost only</li>
          </ul>
        </div>
        <div className="deploy-card">
          <div className="deploy-card-header">
            <span className="deploy-icon">💻</span>
            <h3>Node.js</h3>
          </div>
          <code className="deploy-cmd">npx edgebase dev</code>
          <ul className="deploy-features">
            <li>Zero dependencies</li>
            <li>Dev & production</li>
            <li>Local filesystem</li>
            <li>Free</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function SDKSection() {
  return (
    <section className="sdk-section">
      <h2>{siteMetadata.sdkPackageHeadline} SDK packages across {sdkLanguageCount} languages</h2>
      <p className="section-subtitle">
        Client and admin SDKs generated from the same API contract.
      </p>
      <div className="sdk-icons">
        {homeSdkItems.map((sdk, i) => {
          const token = getPlatformToken(sdk.key);
          return (
            <div key={`${sdk.key}-${i}`} className="sdk-icon">
              {token.logoSrc ? (
                <img src={token.logoSrc} alt={sdk.label} className="sdk-logo" loading="lazy" />
              ) : (
                <span className="sdk-token" style={token.style} aria-hidden="true">
                  {token.short}
                </span>
              )}
              <span className="sdk-name">{sdk.label}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ComparisonSection() {
  return (
    <section className="comparison-section">
      <h2>At a Glance</h2>
      <div className="comparison-table-wrap">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Firebase</th>
              <th>Supabase</th>
              <th>PocketBase</th>
              <th>EdgeBase</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Deploy</strong>
              </td>
              <td>Managed</td>
              <td>Managed</td>
              <td>Self-host</td>
              <td>
                <strong>Edge / Docker / Node</strong>
              </td>
            </tr>
            <tr>
              <td>
                <strong>Cold Start</strong>
              </td>
              <td>Seconds</td>
              <td>~1s</td>
              <td>0ms</td>
              <td>
                <strong>~0ms</strong>
              </td>
            </tr>
            <tr>
              <td>
                <strong>Auth Cost</strong>
              </td>
              <td>$275/100K</td>
              <td>$25/mo</td>
              <td>Free</td>
              <td>
                <strong>Free</strong>
              </td>
            </tr>
            <tr>
              <td>
                <strong>Egress</strong>
              </td>
              <td>$0.12/GB</td>
              <td>$0.09/GB</td>
              <td>Server</td>
              <td>
                <strong>$0</strong>
              </td>
            </tr>
            <tr>
              <td>
                <strong>Self-Host</strong>
              </td>
              <td>❌</td>
              <td>⚠️ Complex</td>
              <td>✅</td>
              <td>
                <strong>✅ 3 ways</strong>
              </td>
            </tr>
            <tr>
              <td>
                <strong>Multi-Tenancy</strong>
              </td>
              <td>Manual</td>
              <td>RLS manual</td>
              <td>Manual</td>
              <td>
                <strong>DB blocks (1 line)</strong>
              </td>
            </tr>
            <tr>
              <td>
                <strong>FTS</strong>
              </td>
              <td>❌</td>
              <td>pg_trgm</td>
              <td>❌</td>
              <td>
                <strong>FTS5 (CJK)</strong>
              </td>
            </tr>
            <tr>
              <td>
                <strong>KV / D1 / Vector</strong>
              </td>
              <td>❌</td>
              <td>❌</td>
              <td>❌</td>
              <td>
                <strong>✅</strong>
              </td>
            </tr>
            <tr>
              <td>
                <strong>License</strong>
              </td>
              <td>Proprietary</td>
              <td>Apache-2.0</td>
              <td>MIT</td>
              <td>
                <strong>MIT</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CTASection() {
  return (
    <section className="cta-section">
      <h2>Ready to Build?</h2>
      <p>Your backend is 30 seconds away.</p>
      <div className="hero-buttons">
        <Link className="hero-btn hero-btn-primary" to="/docs/getting-started/quickstart">
          Get Started →
        </Link>
        <Link className="hero-btn hero-btn-secondary" to="/docs/getting-started/self-hosting">
          Self-Hosting Guide
        </Link>
      </div>
    </section>
  );
}

export default function Home(): React.JSX.Element {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout title="Home" description={siteConfig.tagline}>
      <main>
        <HeroSection />
        <StatsSection />
        <EntryPointsSection />
        <CostSection />
        <SpeedSection />
        <ScalingSection />
        <FeaturesSection />
        <DeploySection />
        <SDKSection />
        <ComparisonSection />
        <CTASection />
      </main>
    </Layout>
  );
}
