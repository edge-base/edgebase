---
sidebar_position: 20
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Captcha (Bot Protection)

:::caution Alpha
This feature is in **alpha**. APIs and behavior may change without notice. Not recommended for production use.
:::

EdgeBase uses Cloudflare Turnstile to automatically protect authentication endpoints from bots. With zero configuration required for most setups.

## Quick Start

Add one line to your config:

```typescript
// edgebase.config.ts
export default defineConfig({
  captcha: true,
});
```

That's it. When you run `npx edgebase deploy`, Turnstile keys are automatically provisioned, stored, and distributed to your SDKs.

## How It Works

```
Client SDK                    Server                      Cloudflare
    │                           │                            │
    ├─ GET /api/config ────────►│                            │
    │◄─── { captcha: { siteKey } }                           │
    │                           │                            │
    ├─ Turnstile widget ───────────────────────────────────►│
    │◄── token (invisible, ~200ms) ◄────────────────────────│
    │                           │                            │
    ├─ POST /auth/signup ──────►│                            │
    │  { captchaToken: "..." }  ├─ siteverify(token) ──────►│
    │                           │◄── { success: true } ◄────│
    │◄── 201 Created ◄─────────│                            │
```

### Phase 1: Invisible (99% of users)

Turnstile runs invisibly in the background. Users see nothing — the token is acquired automatically in ~200ms.

### Phase 2: Interactive Challenge (1% of users)

If Cloudflare detects suspicious behavior, an interactive challenge (checkbox or puzzle) is shown as an overlay. The SDK handles this automatically.

## Configuration

### Zero-Config (Cloudflare Deploy)

```typescript
captcha: true
```

- `npx edgebase deploy` auto-provisions Turnstile widget via Cloudflare Management API
- `siteKey` is exposed to clients via `CAPTCHA_SITE_KEY` and `GET /api/config`
- `secretKey` is stored as Workers Secret `TURNSTILE_SECRET`

### Manual Keys (Self-Hosting / Docker)

```typescript
captcha: {
  siteKey: '0x4AAAAAAA...',     // From Turnstile dashboard
  secretKey: '0x4AAAAAAA...',
  failMode: 'open',             // 'open' (default) | 'closed'
  siteverifyTimeout: 3000,      // ms (default: 3000)
}
```

### Disable Captcha

```typescript
captcha: false  // or omit entirely
```

## SDK Usage

### Zero-Config (Recommended)

Client SDKs handle captcha automatically once the runtime host is in place. No per-request code changes are needed:

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const client = createClient('https://your-project.edgebase.fun');
await client.auth.signUp({ email: 'user@test.com', password: 'pass123' });
// SDK automatically: fetches siteKey → runs Turnstile → attaches token
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final client = ClientEdgeBase('...');
await client.auth.signUp(SignUpOptions(email: 'user@test.com', password: 'pass123'));
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let client = EdgeBaseClient("...")
try await client.auth.signUp(email: "user@test.com", password: "pass123")
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val client = ClientEdgeBase("...")
client.auth.signUp(email = "user@test.com", password = "pass123")
```

</TabItem>
<TabItem value="java" label="Java">

```java
ClientEdgeBase client = EdgeBase.client("...");
client.auth().signUp("user@test.com", "pass123");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var client = new EdgeBase("...");
await client.Auth.SignUpAsync("user@test.com", "pass123");
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
eb::EdgeBase client("...");
client.auth().signUp("user@test.com", "pass123");
```

</TabItem>
</Tabs>

### Client Runtime Support Matrix

If you are comparing package/module layout instead of runtime support, see [SDK Layer Matrix](/docs/sdks/layer-matrix).

Legend:
- `✅`: supported and validated in a current example/runtime flow
- `◐`: supported by the SDK or target host, but still depends on a specific host/plugin or has not been fully re-validated in every runtime
- `—`: no client-side captcha path

<div className="runtime-support-table" role="region" aria-label="Client runtime support matrix">
  <table>
    <thead>
      <tr>
        <th>SDK</th>
        <th>Android</th>
        <th>iOS</th>
        <th>macOS</th>
        <th>Windows</th>
        <th>Linux</th>
        <th>Web</th>
      </tr>
    </thead>
    <tbody>
      <tr><td><code>@edge-base/web</code></td><td>—</td><td>—</td><td>✅</td><td>◐</td><td>◐</td><td>✅</td></tr>
      <tr><td><code>@edge-base/react-native</code></td><td>✅</td><td>✅</td><td>—</td><td>—</td><td>—</td><td>✅</td></tr>
      <tr><td><code>edgebase_flutter</code></td><td>✅</td><td>✅</td><td>✅</td><td>◐</td><td>◐</td><td>✅</td></tr>
      <tr><td><code>EdgeBase Swift</code></td><td>—</td><td>✅</td><td>✅</td><td>—</td><td>—</td><td>—</td></tr>
      <tr><td><code>Kotlin KMP client</code></td><td>✅</td><td>✅</td><td>✅</td><td>—</td><td>—</td><td>✅</td></tr>
      <tr><td><code>Android Java</code></td><td>✅</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>
      <tr><td><code>Unity C#</code></td><td>✅</td><td>✅</td><td>✅</td><td>◐</td><td>◐</td><td>✅</td></tr>
      <tr><td><code>Unreal / C++</code></td><td>✅</td><td>✅</td><td>✅</td><td>◐</td><td>◐</td><td>—</td></tr>
    </tbody>
  </table>
</div>

Notes:
- `@edge-base/web` desktop columns mean browser-hosted runtimes such as Electron renderer processes, not a native desktop-only SDK.
- `Kotlin KMP client` uses a no-op JVM captcha provider, so Windows/Linux desktop JVM targets are intentionally not marked supported here.
- `Unity C#` desktop support depends on a supported WebView host. The current macOS path is validated through an embedded `gree/unity-webview` window. Other desktop targets still require a supported host integration or a custom `TurnstileProvider.SetWebViewFactory(...)`.
- `Unreal / C++` uses the built-in browser runtime on supported targets; macOS, Android, and iOS are validated in the current example app flow.

### Manual Token Override

If you need custom captcha UI or use a different captcha provider:

```typescript
await client.auth.signUp({
  email: 'user@test.com',
  password: 'pass123',
  captchaToken: myCustomToken,  // Skips built-in Turnstile
});
```

## Protected Endpoints

| Endpoint | Action | Captcha |
|----------|--------|---------|
| `POST /auth/signup` | `signup` | ✅ |
| `POST /auth/signin` | `signin` | ✅ |
| `POST /auth/signin/anonymous` | `anonymous` | ✅ |
| `POST /auth/request-password-reset` | `password-reset` | ✅ |
| `POST /auth/signin/magic-link` | `magic-link` | ✅ |
| `POST /auth/signin/phone` | `phone` | ✅ |
| `GET /auth/oauth/:provider` | `oauth` | ✅ |
| `POST /auth/refresh` | — | ❌ (session renewal) |
| `POST /auth/signout` | — | ❌ (logout) |
| `POST /auth/change-password` | — | ❌ (authenticated) |

### Functions with Captcha

You can enable captcha on individual HTTP functions:

```typescript
// functions/submit-form.ts
export default defineFunction({
  trigger: { type: 'http' },
  captcha: true,  // Requires captcha token
  handler: async (context) => { ... },
});
```

## Platform-Specific Details

### Web (JS/TS, Flutter Web, Kotlin JS)

Turnstile JS SDK is loaded directly into the browser DOM. No WebView needed.

### Android (Kotlin, Java)

- Uses `android.webkit.WebView` (system built-in, zero dependencies)
- **Zero-config**: Automatically detects `Application` context via `ActivityThread.currentApplication()` reflection
- Automatically tracks current foreground `Activity` via `ActivityLifecycleCallbacks`
- Interactive challenges shown as dimmed overlay on current Activity

### iOS/macOS (Swift, Kotlin Apple)

- Uses `WKWebView` (system built-in, zero dependencies)
- Interactive challenges shown as overlay on key window
- iOS: `UIWindowScene` → `keyWindow` overlay
- macOS: `NSApplication.keyWindow` overlay

### Unity (C#)

Built-in adapters for popular WebView plugins (auto-detected at startup):

| Plugin | Define Symbol | License |
|--------|--------------|---------|
| [UniWebView](https://uniwebview.com) | `UNIWEBVIEW` | Paid |
| [Vuplex 3D WebView](https://vuplex.com) | `VUPLEX_WEBVIEW` | Paid |
| [gree/unity-webview](https://github.com/nicfu/unity-webview) | `UNITY_WEBVIEW_GREE` | Free (MIT) |

Add the define symbol in **Player Settings → Scripting Define Symbols**. The adapter auto-registers at startup.

If no supported plugin is detected, a warning is logged. You can provide a custom factory:

```csharp
TurnstileProvider.SetWebViewFactory(async (siteKey, action) => {
    var html = TurnstileProvider.GetTurnstileHtml(siteKey, action);
    // Load html in your WebView, capture token from JS bridge
    return token;
});
```

### Unreal Engine (C++)

Uses the built-in `SWebBrowser` widget (CEF-based). Zero third-party dependencies.

**Setup**: Add to your `.Build.cs`:
```csharp
PublicDependencyModuleNames.AddRange(new string[] {
    "WebBrowserWidget", "Slate", "SlateCore"
});
```

Then include the header in any `.cpp` file:
```cpp
#include "edgebase/turnstile_adapter_ue.h"
```

The adapter auto-registers via `FCoreDelegates::OnPostEngineInit`. No manual calls needed.

### Flutter (Dart)

Uses `flutter_inappwebview` for all native platforms (Android, iOS, macOS, Windows, Linux). Already included as a dependency in the SDK.

```yaml
# Already in edgebase SDK's pubspec.yaml
dependencies:
  flutter_inappwebview: ^6.0.0
```

No additional setup needed. Platform detection is automatic via conditional imports.

## Security

| Aspect | Detail |
|--------|--------|
| **siteKey** | Public — safely distributed via `GET /api/config` |
| **secretKey** | Private — stored as Workers Secret `TURNSTILE_SECRET`, never exposed |
| **Token one-use** | Cloudflare auto-invalidates tokens after `siteverify` |
| **Action verification** | Prevents token reuse across endpoints (signup token can't be used for signin) |
| **Service Key bypass** | Server SDKs (Go, PHP, Rust, Python) bypass captcha when using Service Keys |
| **CDN caching** | `/api/config` cached for 60s at edge (reduces Worker invocations) |

## Fail Modes

| Mode | Behavior on Turnstile API Failure | Use Case |
|------|----------------------------------|----------|
| `open` (default) | Allow request through, log warning | General apps (availability first) |
| `closed` | Reject with 503 | Finance, healthcare (security first) |

## Rate Limiting + Captcha

Captcha and rate limiting work together as complementary layers:

```
Request → CORS → Rate Limit → Captcha → Auth Handler
```

- **Rate limiting** runs first — blocks brute-force regardless of captcha status
- **Captcha** runs second — verifies human origin for requests that pass rate limit
- Both layers are independent — disabling one doesn't affect the other
- Service Keys bypass captcha and EdgeBase app-level rate limits

## Testing

### Disable in Tests (Recommended)

```toml
# wrangler.test.toml — omit captcha config / CAPTCHA_SITE_KEY
```

### Cloudflare Test Keys

| Purpose | siteKey | secretKey |
|---------|---------|-----------|
| Always passes | `1x00000000000000000000AA` | `1x0000000000000000000000000000000AA` |
| Always fails | `2x00000000000000000000AB` | `2x0000000000000000000000000000000AB` |
| Forces interactive | `3x00000000000000000000FF` | `3x0000000000000000000000000000000FF` |

```typescript
// Use in test config for E2E captcha testing
captcha: {
  siteKey: '1x00000000000000000000AA',
  secretKey: '1x0000000000000000000000000000000AA',
}
```

## Troubleshooting

### Captcha not working in development

`captcha: true` requires Cloudflare deploy for auto-provisioning. For local development, either:
- Use manual keys: `captcha: { siteKey: '...', secretKey: '...' }`
- Disable captcha: `captcha: false`

### Interactive challenge keeps appearing

This usually means Cloudflare's bot detection is triggered. Common causes:
- Running from a datacenter IP
- Automated testing without test keys
- VPN or proxy usage

### SDK not automatically acquiring tokens

Verify `GET /api/config` returns `{ captcha: { siteKey: "..." } }`. If `captcha` is `null`, captcha is not configured on the server.
