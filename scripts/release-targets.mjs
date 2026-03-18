export const RELEASE_VERSION_SOURCE = {
  path: 'package.json',
  field: 'version',
};

export const NPM_PUBLISH_TARGET_IDS = [
  'shared',
  'plugin-core',
  'server',
  'core-js',
  'web-js',
  'admin-js',
  'ssr-js',
  'auth-ui-react',
  'react-native',
  'cli',
  'create-edgebase',
];

export const DART_PUBLISH_TARGET_IDS = [
  'dart-core',
  'dart-admin',
  'dart-flutter',
];

export const DART_OPTIONAL_PUBLISH_TARGET_IDS = [
  'dart-sdk',
];

export const RELEASE_TARGETS = [
  // Public npm packages
  {
    id: 'create-edgebase',
    name: 'create-edgebase',
    ecosystem: 'npm',
    path: 'packages/create-edgebase/package.json',
    strategy: 'json-version',
  },
  {
    id: 'cli',
    name: '@edge-base/cli',
    ecosystem: 'npm',
    path: 'packages/cli/package.json',
    strategy: 'json-version',
  },
  {
    id: 'plugin-core',
    name: '@edge-base/plugin-core',
    ecosystem: 'npm',
    path: 'packages/plugins/core/package.json',
    strategy: 'json-version',
  },
  {
    id: 'shared',
    name: '@edge-base/shared',
    ecosystem: 'npm',
    path: 'packages/shared/package.json',
    strategy: 'json-version',
  },
  {
    id: 'server',
    name: '@edge-base/server',
    ecosystem: 'npm',
    path: 'packages/server/package.json',
    strategy: 'json-version',
  },
  {
    id: 'core-js',
    name: '@edge-base/core',
    ecosystem: 'npm',
    path: 'packages/sdk/js/packages/core/package.json',
    strategy: 'json-version',
  },
  {
    id: 'web-js',
    name: '@edge-base/web',
    ecosystem: 'npm',
    path: 'packages/sdk/js/packages/web/package.json',
    strategy: 'json-version',
  },
  {
    id: 'admin-js',
    name: '@edge-base/admin',
    ecosystem: 'npm',
    path: 'packages/sdk/js/packages/admin/package.json',
    strategy: 'json-version',
  },
  {
    id: 'ssr-js',
    name: '@edge-base/ssr',
    ecosystem: 'npm',
    path: 'packages/sdk/js/packages/ssr/package.json',
    strategy: 'json-version',
  },
  {
    id: 'auth-ui-react',
    name: '@edge-base/auth-ui-react',
    ecosystem: 'npm',
    path: 'packages/sdk/js/packages/auth-ui-react/package.json',
    strategy: 'json-version',
  },
  {
    id: 'react-native',
    name: '@edge-base/react-native',
    ecosystem: 'npm',
    path: 'packages/sdk/react-native/package.json',
    strategy: 'json-version',
  },

  // Python
  {
    id: 'python-sdk',
    name: 'edgebase',
    ecosystem: 'python',
    path: 'packages/sdk/python/pyproject.toml',
    strategy: 'toml-version',
  },
  {
    id: 'python-core',
    name: 'edgebase-core',
    ecosystem: 'python',
    path: 'packages/sdk/python/packages/core/pyproject.toml',
    strategy: 'toml-version',
  },
  {
    id: 'python-admin',
    name: 'edgebase-admin',
    ecosystem: 'python',
    path: 'packages/sdk/python/packages/admin/pyproject.toml',
    strategy: 'toml-version',
  },

  // Dart / Flutter
  {
    id: 'dart-sdk',
    name: 'edgebase',
    ecosystem: 'dart',
    path: 'packages/sdk/dart/pubspec.yaml',
    strategy: 'yaml-version',
    publishTool: 'flutter',
  },
  {
    id: 'dart-core',
    name: 'edgebase_core',
    ecosystem: 'dart',
    path: 'packages/sdk/dart/packages/core/pubspec.yaml',
    strategy: 'yaml-version',
    publishTool: 'dart',
  },
  {
    id: 'dart-admin',
    name: 'edgebase_admin',
    ecosystem: 'dart',
    path: 'packages/sdk/dart/packages/admin/pubspec.yaml',
    strategy: 'yaml-version',
    publishTool: 'dart',
  },
  {
    id: 'dart-flutter',
    name: 'edgebase_flutter',
    ecosystem: 'dart',
    path: 'packages/sdk/dart/packages/flutter/pubspec.yaml',
    strategy: 'yaml-version',
    publishTool: 'flutter',
  },

  // Rust
  {
    id: 'rust-sdk',
    name: 'edgebase-sdk',
    ecosystem: 'rust',
    path: 'packages/sdk/rust/Cargo.toml',
    strategy: 'toml-version',
  },
  {
    id: 'rust-core',
    name: 'edgebase-core',
    ecosystem: 'rust',
    path: 'packages/sdk/rust/packages/core/Cargo.toml',
    strategy: 'toml-version',
  },
  {
    id: 'rust-admin',
    name: 'edgebase-admin',
    ecosystem: 'rust',
    path: 'packages/sdk/rust/packages/admin/Cargo.toml',
    strategy: 'toml-version',
  },

  // PHP / Composer
  {
    id: 'php-sdk',
    name: 'edgebase/sdk',
    ecosystem: 'php',
    path: 'packages/sdk/php/composer.json',
    strategy: 'json-version',
  },
  {
    id: 'php-core',
    name: 'edgebase/core',
    ecosystem: 'php',
    path: 'packages/sdk/php/packages/core/composer.json',
    strategy: 'tag-only',
    note: 'Composer subpackage version is tag-driven; composer.json has no version field.',
  },
  {
    id: 'php-admin',
    name: 'edgebase/admin',
    ecosystem: 'php',
    path: 'packages/sdk/php/packages/admin/composer.json',
    strategy: 'tag-only',
    note: 'Composer subpackage version is tag-driven; composer.json has no version field.',
  },

  // JVM families
  {
    id: 'java-sdk',
    name: 'edgebase-sdk-java',
    ecosystem: 'java',
    path: 'packages/sdk/java/build.gradle',
    strategy: 'gradle-version',
  },
  {
    id: 'kotlin-sdk',
    name: 'edgebase-kotlin',
    ecosystem: 'kotlin',
    path: 'packages/sdk/kotlin/build.gradle.kts',
    strategy: 'gradle-version',
  },
  {
    id: 'scala-sdk',
    name: 'edgebase-scala',
    ecosystem: 'scala',
    path: 'packages/sdk/scala/build.gradle.kts',
    strategy: 'gradle-version',
  },

  // Tag-oriented ecosystems
  {
    id: 'go-sdk',
    name: 'github.com/edge-base/sdk-go',
    ecosystem: 'go',
    path: 'packages/sdk/go/go.mod',
    strategy: 'tag-only',
    note: 'Go module versions are derived from git tags, not go.mod.',
  },
  {
    id: 'swift-core',
    name: 'EdgeBaseCore',
    ecosystem: 'swift',
    path: 'packages/sdk/swift/packages/core/Package.swift',
    strategy: 'tag-only',
    note: 'Swift Package Manager versions are tag-driven.',
  },
  {
    id: 'swift-ios',
    name: 'EdgeBaseIOS',
    ecosystem: 'swift',
    path: 'packages/sdk/swift/packages/ios/Package.swift',
    strategy: 'tag-only',
    note: 'Swift Package Manager versions are tag-driven.',
  },
  {
    id: 'kotlin-swift-package',
    name: 'EdgeBaseKotlin',
    ecosystem: 'swift',
    path: 'packages/sdk/kotlin/Package.swift',
    strategy: 'tag-only',
    note: 'Swift Package Manager versions are tag-driven.',
  },
];
