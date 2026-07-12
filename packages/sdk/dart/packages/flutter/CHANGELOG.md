## 0.4.2

- Synchronized the Flutter package with the EdgeBase 0.4.2 security patch release
- No public Dart API compatibility break is introduced

## 0.4.1

- Persist access and refresh tokens as one SharedPreferences value, expose
  `tryRestoreSession()`, migrate legacy refresh-only state, and reject incomplete
  pairs before exposure.
- Require `DurableTokenStorage` before anonymous email/phone upgrades; failed
  replacement writes keep the initiating session and can safely replay the
  server checkpoint.
- Surface token persistence failures through authenticated HTTP instead of
  retrying without authority.
- Added typed CAPTCHA failures, bounded/retryable web script loading, unique DOM
  cleanup, a five-minute positive site-key cache, and one fresh-key retry only
  for direct `challenge_error` failures.
- CAPTCHA config fetch and malformed-response failures now fail closed instead
  of being interpreted as disabled protection.
- Raised the Dart SDK floor to 3.4 for modern JS interop.

## 0.4.0

- Synchronized package metadata, `edgebase_core`, and realtime SDK version
  reporting with EdgeBase 0.3.9
- No public Flutter API compatibility break is introduced

## 0.3.8

- Synchronized package metadata, `edgebase_core`, and realtime SDK version
  reporting with EdgeBase 0.3.8
- No public Flutter API compatibility break is introduced

## 0.3.7

- Synchronized package metadata, `edgebase_core`, and realtime SDK version
  reporting with EdgeBase 0.3.7
- No public Flutter API compatibility break is introduced

## 0.3.6

- Synchronized package metadata, `edgebase_core`, and realtime SDK version
  reporting with EdgeBase 0.3.6
- No public Flutter API compatibility break is introduced

## 0.1.4

- Synced package metadata and install guidance for the 0.1.4 release
- Refreshed public release references across the Flutter package docs

## 0.1.3

- Updated package docs to explain the EdgeBase project more clearly and link back to the main repository
- Synced package metadata for the 0.1.3 release

## 0.1.2

- Added public package README and `llms.txt`
- Added MIT license file
- Switched the canonical package entrypoint to `edgebase_flutter.dart`
- Fixed web captcha interop imports for Flutter web analysis
- Prepared package metadata for pub.dev publishing
