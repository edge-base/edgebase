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

export const PYTHON_PUBLISH_TARGET_IDS = [
  'python-core',
  'python-admin',
];

export const PYTHON_OPTIONAL_PUBLISH_TARGET_IDS = [
  'python-sdk',
];

export const RUST_PUBLISH_TARGET_IDS = [
  'rust-core',
  'rust-admin',
];

export const NUGET_PUBLISH_TARGET_IDS = [
  'csharp-core',
  'csharp-admin',
  'csharp-unity',
];

export const RUBY_PUBLISH_TARGET_IDS = [
  'ruby-core',
  'ruby-admin',
];

export const HEX_PUBLISH_TARGET_IDS = [
  'elixir-core',
  'elixir-admin',
];

export const PHP_SPLIT_TARGET_IDS = [
  'php-core',
  'php-admin',
];

export const SWIFT_SPLIT_TARGET_IDS = [
  'swift-core',
  'swift-ios',
];

export const JITPACK_VERIFY_TARGET_IDS = [
  'java-core',
  'java-android',
  'java-admin',
  'kotlin-core',
  'kotlin-client',
  'kotlin-admin',
  'scala-core',
  'scala-admin',
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
    id: 'js-sdk-workspace',
    name: '@edge-base/sdk',
    ecosystem: 'npm',
    path: 'packages/sdk/js/package.json',
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
    strategy: 'tag-only',
    note: 'Composer package versions are tag-driven; composer.json omits the version field.',
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
    strategy: 'gradle-const-version',
  },
  {
    id: 'java-core',
    name: 'edgebase-core-java',
    ecosystem: 'java',
    path: 'packages/sdk/java/packages/core/build.gradle',
    strategy: 'gradle-root-version',
  },
  {
    id: 'java-android',
    name: 'edgebase-android-java',
    ecosystem: 'java',
    path: 'packages/sdk/java/packages/android/build.gradle',
    strategy: 'gradle-root-version',
  },
  {
    id: 'java-admin',
    name: 'edgebase-admin-java',
    ecosystem: 'java',
    path: 'packages/sdk/java/packages/admin/build.gradle',
    strategy: 'gradle-root-version',
  },
  {
    id: 'kotlin-sdk',
    name: 'edgebase-kotlin',
    ecosystem: 'kotlin',
    path: 'packages/sdk/kotlin/build.gradle.kts',
    strategy: 'gradle-const-version',
  },
  {
    id: 'kotlin-core',
    name: 'edgebase-core',
    ecosystem: 'kotlin',
    path: 'packages/sdk/kotlin/core/build.gradle.kts',
    strategy: 'gradle-root-version',
  },
  {
    id: 'kotlin-client',
    name: 'edgebase-client',
    ecosystem: 'kotlin',
    path: 'packages/sdk/kotlin/client/build.gradle.kts',
    strategy: 'gradle-root-version',
  },
  {
    id: 'kotlin-admin',
    name: 'edgebase-admin-kotlin',
    ecosystem: 'kotlin',
    path: 'packages/sdk/kotlin/admin/build.gradle.kts',
    strategy: 'gradle-root-version',
  },
  {
    id: 'scala-sdk',
    name: 'edgebase-scala',
    ecosystem: 'scala',
    path: 'packages/sdk/scala/build.gradle.kts',
    strategy: 'gradle-const-version',
  },
  {
    id: 'scala-core',
    name: 'edgebase-core-scala',
    ecosystem: 'scala',
    path: 'packages/sdk/scala/packages/core/build.gradle.kts',
    strategy: 'gradle-root-version',
  },
  {
    id: 'scala-admin',
    name: 'edgebase-admin-scala',
    ecosystem: 'scala',
    path: 'packages/sdk/scala/packages/admin/build.gradle.kts',
    strategy: 'gradle-root-version',
  },
  {
    id: 'csharp-admin',
    name: 'dev.edgebase.admin',
    ecosystem: 'csharp',
    path: 'packages/sdk/csharp/packages/admin/EdgeBase.Admin.csproj',
    strategy: 'csproj-version',
  },
  {
    id: 'cpp-unreal',
    name: 'EdgeBase Unreal plugin',
    ecosystem: 'cpp',
    path: 'packages/sdk/cpp/EdgeBase.uplugin',
    strategy: 'uplugin-version',
  },
  {
    id: 'csharp-unity',
    name: 'dev.edgebase.unity',
    ecosystem: 'csharp',
    path: 'packages/sdk/csharp/packages/unity/EdgeBase.Unity.csproj',
    strategy: 'csproj-version',
  },
  {
    id: 'csharp-core',
    name: 'dev.edgebase.core',
    ecosystem: 'csharp',
    path: 'packages/sdk/csharp/packages/core/EdgeBase.Core.csproj',
    strategy: 'csproj-version',
  },
  {
    id: 'ruby-core',
    name: 'edgebase_core',
    ecosystem: 'ruby',
    path: 'packages/sdk/ruby/packages/core/edgebase_core.gemspec',
    strategy: 'gemspec-version',
  },
  {
    id: 'ruby-admin',
    name: 'edgebase_admin',
    ecosystem: 'ruby',
    path: 'packages/sdk/ruby/packages/admin/edgebase_admin.gemspec',
    strategy: 'gemspec-version',
  },
  {
    id: 'elixir-core',
    name: 'edgebase_core',
    ecosystem: 'elixir',
    path: 'packages/sdk/elixir/packages/core/mix.exs',
    strategy: 'mix-version',
  },
  {
    id: 'elixir-admin',
    name: 'edgebase_admin',
    ecosystem: 'elixir',
    path: 'packages/sdk/elixir/packages/admin/mix.exs',
    strategy: 'mix-version',
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

export const RELEASE_VERSION_REFERENCES = [
  {
    path: 'packages/sdk/python/packages/admin/pyproject.toml',
    label: 'Python admin edgebase-core dependency',
    pattern: /(edgebase-core>=)(\d+\.\d+\.\d+)(,<)(\d+\.\d+\.\d+)/m,
    replace: ({ version, upperBound }, prefix, _current, middle) => `${prefix}${version}${middle}${upperBound}`,
  },
  {
    path: 'packages/sdk/python/packages/admin/README.md',
    label: 'Python admin README edgebase-core requirement',
    pattern: /(`edgebase-core>=)(\d+\.\d+\.\d+)(,<)(\d+\.\d+\.\d+)(`)/m,
    replace: ({ version, upperBound }, prefix, _current, middle, _currentUpper, suffix) => `${prefix}${version}${middle}${upperBound}${suffix}`,
  },
  {
    path: 'packages/sdk/python/pyproject.toml',
    label: 'Python SDK edgebase-core dependency',
    pattern: /("edgebase-core>=)(\d+\.\d+\.\d+)(,<)(\d+\.\d+\.\d+)(")/m,
    replace: ({ version, upperBound }, prefix, _current, middle, _currentUpper, suffix) => `${prefix}${version}${middle}${upperBound}${suffix}`,
  },
  {
    path: 'packages/sdk/python/pyproject.toml',
    label: 'Python SDK edgebase-admin dependency',
    pattern: /("edgebase-admin>=)(\d+\.\d+\.\d+)(,<)(\d+\.\d+\.\d+)(")/m,
    replace: ({ version, upperBound }, prefix, _current, middle, _currentUpper, suffix) => `${prefix}${version}${middle}${upperBound}${suffix}`,
  },
  {
    path: 'packages/sdk/dart/pubspec.yaml',
    label: 'Dart SDK edgebase_core dependency',
    pattern: /(^\s*edgebase_core:\s*\^)(\d+\.\d+\.\d+)(\s*$)/m,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/dart/pubspec.yaml',
    label: 'Dart SDK edgebase_flutter dependency',
    pattern: /(^\s*edgebase_flutter:\s*\^)(\d+\.\d+\.\d+)(\s*$)/m,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/dart/packages/admin/pubspec.yaml',
    label: 'Dart admin edgebase_core dependency',
    pattern: /(^\s*edgebase_core:\s*\^)(\d+\.\d+\.\d+)(\s*$)/m,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/dart/packages/flutter/pubspec.yaml',
    label: 'Dart Flutter edgebase_core dependency',
    pattern: /(^\s*edgebase_core:\s*\^)(\d+\.\d+\.\d+)(\s*$)/m,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/dart/packages/flutter/lib/src/database_live_client.dart',
    label: 'Dart Flutter database-live sdkVersion',
    pattern: /('sdkVersion': ')(\d+\.\d+\.\d+)(')/g,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/js/packages/web/src/database-live.ts',
    label: 'JS web database-live sdkVersion',
    pattern: /(sdkVersion: ')(\d+\.\d+\.\d+)(')/g,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/react-native/src/database-live.ts',
    label: 'React Native database-live sdkVersion',
    pattern: /(sdkVersion: ')(\d+\.\d+\.\d+)(')/g,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/rust/packages/admin/Cargo.toml',
    label: 'Rust admin edgebase-core dependency',
    pattern: /(^edgebase-core = \{ version = ")([^"]+)(", path = "\.\.\/core" \}$)/m,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/rust/README.md',
    label: 'Rust workspace README install versions',
    pattern: /(edgebase-(?:admin|core) = ")(\d+\.\d+\.\d+)(")/g,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/rust/packages/core/README.md',
    label: 'Rust core README install version',
    pattern: /(edgebase-core = ")(\d+\.\d+\.\d+)(")/m,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/rust/packages/admin/README.md',
    label: 'Rust admin README install version',
    pattern: /(edgebase-admin = ")(\d+\.\d+\.\d+)(")/m,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/rust/packages/core/src/room.rs',
    label: 'Rust room sdkVersion',
    pattern: /("sdkVersion": ")(\d+\.\d+\.\d+)(")/g,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/php/packages/admin/composer.json',
    label: 'PHP admin edgebase/core dependency',
    pattern: /("edgebase\/core":\s*"\^)(\d+\.\d+\.\d+)(")/m,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/php/packages/admin/composer.json',
    label: 'PHP admin local path version hint',
    pattern: /("edgebase\/core":\s*")(\d+\.\d+\.\d+)(")/m,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/ruby/packages/admin/edgebase_admin.gemspec',
    label: 'Ruby admin edgebase_core dependency',
    pattern: /(^\s*spec\.add_dependency "edgebase_core", "~> )(\d+\.\d+\.\d+)(")/m,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/kotlin/admin/README.md',
    label: 'Kotlin admin README install version',
    pattern: /(implementation\("com\.github\.edge-base\.edgebase:edgebase-admin-kotlin:)(v?\d+\.\d+\.\d+)("\))/m,
    replace: ({ tagVersion }, prefix, _current, suffix) => `${prefix}${tagVersion}${suffix}`,
  },
  {
    path: 'packages/sdk/kotlin/README.md',
    label: 'Kotlin README edgebase-core artifact version',
    pattern: /(edgebase-core:)(v?\d+\.\d+\.\d+)/g,
    replace: ({ tagVersion }, prefix) => `${prefix}${tagVersion}`,
  },
  {
    path: 'packages/sdk/kotlin/README.md',
    label: 'Kotlin README edgebase-client artifact version',
    pattern: /(edgebase-client:)(v?\d+\.\d+\.\d+)/g,
    replace: ({ tagVersion }, prefix) => `${prefix}${tagVersion}`,
  },
  {
    path: 'packages/sdk/kotlin/README.md',
    label: 'Kotlin README edgebase-admin-kotlin artifact version',
    pattern: /(edgebase-admin-kotlin:)(v?\d+\.\d+\.\d+)/g,
    replace: ({ tagVersion }, prefix) => `${prefix}${tagVersion}`,
  },
  {
    path: 'packages/sdk/kotlin/llms.txt',
    label: 'Kotlin llms public artifact versions',
    pattern: /(`com\.github\.edge-base\.edgebase:edgebase-(?:core|client|admin-kotlin):)(v?\d+\.\d+\.\d+)(`)/g,
    replace: ({ tagVersion }, prefix, _current, suffix) => `${prefix}${tagVersion}${suffix}`,
  },
  {
    path: 'packages/sdk/kotlin/llms.txt',
    label: 'Kotlin llms JitPack example tag',
    pattern: /(`v)(\d+\.\d+\.\d+)(`)/m,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/kotlin/client/README.md',
    label: 'Kotlin client README install version',
    pattern: /(edgebase-client:)(v?\d+\.\d+\.\d+)/g,
    replace: ({ tagVersion }, prefix) => `${prefix}${tagVersion}`,
  },
  {
    path: 'packages/sdk/kotlin/client/llms.txt',
    label: 'Kotlin client llms install version',
    pattern: /(`com\.github\.edge-base\.edgebase:edgebase-client:)(v?\d+\.\d+\.\d+)(`)/g,
    replace: ({ tagVersion }, prefix, _current, suffix) => `${prefix}${tagVersion}${suffix}`,
  },
  {
    path: 'packages/sdk/kotlin/admin/llms.txt',
    label: 'Kotlin admin llms install version',
    pattern: /(`com\.github\.edge-base\.edgebase:edgebase-admin-kotlin:)(v?\d+\.\d+\.\d+)(`)/g,
    replace: ({ tagVersion }, prefix, _current, suffix) => `${prefix}${tagVersion}${suffix}`,
  },
  {
    path: 'packages/sdk/kotlin/core/README.md',
    label: 'Kotlin core README install version',
    pattern: /(edgebase-core:)(v?\d+\.\d+\.\d+)/g,
    replace: ({ tagVersion }, prefix) => `${prefix}${tagVersion}`,
  },
  {
    path: 'packages/sdk/kotlin/core/llms.txt',
    label: 'Kotlin core llms install version',
    pattern: /(`com\.github\.edge-base\.edgebase:edgebase-core:)(v?\d+\.\d+\.\d+)(`)/g,
    replace: ({ tagVersion }, prefix, _current, suffix) => `${prefix}${tagVersion}${suffix}`,
  },
  {
    path: 'packages/sdk/kotlin/client/src/commonMain/kotlin/dev/edgebase/sdk/client/DatabaseLiveClient.kt',
    label: 'Kotlin client database-live SDK_VERSION',
    pattern: /(SDK_VERSION = ")(\d+\.\d+\.\d+)(")/g,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/kotlin/client/src/commonMain/kotlin/dev/edgebase/sdk/client/DatabaseLiveClient.kt',
    label: 'Kotlin client database-live sdkVersion docs',
    pattern: /(sdkVersion":"?)(\d+\.\d+\.\d+)(")/g,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/kotlin/README.md',
    label: 'Kotlin README JitPack example tag',
    pattern: /(`v)(\d+\.\d+\.\d+)(`)/m,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/java/packages/admin/README.md',
    label: 'Java admin README install version',
    pattern: /(implementation\("com\.github\.edge-base\.edgebase:edgebase-admin-java:)(v?\d+\.\d+\.\d+)("\))/m,
    replace: ({ tagVersion }, prefix, _current, suffix) => `${prefix}${tagVersion}${suffix}`,
  },
  {
    path: 'packages/sdk/java/README.md',
    label: 'Java README JitPack artifact versions',
    pattern: /(edgebase-(?:core-java|android-java|admin-java):)(v?\d+\.\d+\.\d+)/g,
    replace: ({ tagVersion }, prefix) => `${prefix}${tagVersion}`,
  },
  {
    path: 'packages/sdk/java/README.md',
    label: 'Java README Maven dependency versions',
    pattern: /(<version>)(v?\d+\.\d+\.\d+)(<\/version>)/g,
    replace: ({ tagVersion }, prefix, _current, suffix) => `${prefix}${tagVersion}${suffix}`,
  },
  {
    path: 'packages/sdk/java/llms.txt',
    label: 'Java llms public artifact versions',
    pattern: /(`com\.github\.edge-base\.edgebase:edgebase-(?:core-java|android-java|admin-java):)(v?\d+\.\d+\.\d+)(`)/g,
    replace: ({ tagVersion }, prefix, _current, suffix) => `${prefix}${tagVersion}${suffix}`,
  },
  {
    path: 'packages/sdk/java/llms.txt',
    label: 'Java llms JitPack example tag',
    pattern: /(`v)(\d+\.\d+\.\d+)(`)/m,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/java/packages/core/README.md',
    label: 'Java core README install version',
    pattern: /(edgebase-core-java:)(v?\d+\.\d+\.\d+)/g,
    replace: ({ tagVersion }, prefix) => `${prefix}${tagVersion}`,
  },
  {
    path: 'packages/sdk/java/packages/core/llms.txt',
    label: 'Java core llms install version',
    pattern: /(`com\.github\.edge-base\.edgebase:edgebase-core-java:)(v?\d+\.\d+\.\d+)(`)/g,
    replace: ({ tagVersion }, prefix, _current, suffix) => `${prefix}${tagVersion}${suffix}`,
  },
  {
    path: 'packages/sdk/java/packages/android/README.md',
    label: 'Java Android README install version',
    pattern: /(edgebase-android-java:)(v?\d+\.\d+\.\d+)/g,
    replace: ({ tagVersion }, prefix) => `${prefix}${tagVersion}`,
  },
  {
    path: 'packages/sdk/java/packages/android/llms.txt',
    label: 'Java Android llms install version',
    pattern: /(`com\.github\.edge-base\.edgebase:edgebase-android-java:)(v?\d+\.\d+\.\d+)(`)/g,
    replace: ({ tagVersion }, prefix, _current, suffix) => `${prefix}${tagVersion}${suffix}`,
  },
  {
    path: 'packages/sdk/java/packages/admin/llms.txt',
    label: 'Java admin llms install version',
    pattern: /(`com\.github\.edge-base\.edgebase:edgebase-admin-java:)(v?\d+\.\d+\.\d+)(`)/g,
    replace: ({ tagVersion }, prefix, _current, suffix) => `${prefix}${tagVersion}${suffix}`,
  },
  {
    path: 'packages/sdk/java/packages/android/src/main/java/dev/edgebase/sdk/client/DatabaseLiveClient.java',
    label: 'Java Android database-live SDK_VERSION',
    pattern: /(SDK_VERSION = ")(\d+\.\d+\.\d+)(")/g,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/java/packages/android/src/main/java/dev/edgebase/sdk/client/DatabaseLiveClient.java',
    label: 'Java Android database-live sdkVersion docs',
    pattern: /(sdkVersion":")(\d+\.\d+\.\d+)(")/g,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/scala/packages/admin/README.md',
    label: 'Scala admin README install version',
    pattern: /(libraryDependencies \+= "com\.github\.edge-base\.edgebase" % "edgebase-admin-scala" % ")(v?\d+\.\d+\.\d+)(")/m,
    replace: ({ tagVersion }, prefix, _current, suffix) => `${prefix}${tagVersion}${suffix}`,
  },
  {
    path: 'packages/sdk/scala/README.md',
    label: 'Scala README edgebase-core-scala version',
    pattern: /(edgebase-core-scala:)(v?\d+\.\d+\.\d+)/g,
    replace: ({ tagVersion }, prefix) => `${prefix}${tagVersion}`,
  },
  {
    path: 'packages/sdk/scala/README.md',
    label: 'Scala README edgebase-admin-scala version',
    pattern: /(edgebase-admin-scala:)(v?\d+\.\d+\.\d+)/g,
    replace: ({ tagVersion }, prefix) => `${prefix}${tagVersion}`,
  },
  {
    path: 'packages/sdk/scala/README.md',
    label: 'Scala README library dependency versions',
    pattern: /(% ")(v?\d+\.\d+\.\d+)(")/g,
    replace: ({ tagVersion }, prefix, _current, suffix) => `${prefix}${tagVersion}${suffix}`,
  },
  {
    path: 'packages/sdk/scala/llms.txt',
    label: 'Scala llms public artifact versions',
    pattern: /(`com\.github\.edge-base\.edgebase:edgebase-(?:core-scala|admin-scala):)(v?\d+\.\d+\.\d+)(`)/g,
    replace: ({ tagVersion }, prefix, _current, suffix) => `${prefix}${tagVersion}${suffix}`,
  },
  {
    path: 'packages/sdk/scala/llms.txt',
    label: 'Scala llms JitPack example tag',
    pattern: /(`v)(\d+\.\d+\.\d+)(`)/m,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/scala/packages/core/README.md',
    label: 'Scala core README install version',
    pattern: /(libraryDependencies \+= "com\.github\.edge-base\.edgebase" % "edgebase-core-scala" % ")(v?\d+\.\d+\.\d+)(")/m,
    replace: ({ tagVersion }, prefix, _current, suffix) => `${prefix}${tagVersion}${suffix}`,
  },
  {
    path: 'packages/sdk/scala/packages/core/llms.txt',
    label: 'Scala core llms install version',
    pattern: /(`com\.github\.edge-base\.edgebase:edgebase-core-scala:)(v?\d+\.\d+\.\d+)(`)/g,
    replace: ({ tagVersion }, prefix, _current, suffix) => `${prefix}${tagVersion}${suffix}`,
  },
  {
    path: 'packages/sdk/scala/packages/admin/llms.txt',
    label: 'Scala admin llms install version',
    pattern: /(`com\.github\.edge-base\.edgebase:edgebase-admin-scala:)(v?\d+\.\d+\.\d+)(`)/g,
    replace: ({ tagVersion }, prefix, _current, suffix) => `${prefix}${tagVersion}${suffix}`,
  },
  {
    path: 'packages/sdk/elixir/packages/admin/README.md',
    label: 'Elixir admin README install version',
    pattern: /(\{:edgebase_admin, "~> )([^"]+)("\})/m,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/elixir/packages/core/README.md',
    label: 'Elixir core README install version',
    pattern: /(\{:edgebase_core, "~> )([^"]+)("\})/m,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/elixir/packages/admin/mix.exs',
    label: 'Elixir admin edgebase_core dependency',
    pattern: /(\{:edgebase_core, "~> )([^"]+)(", path: "\.\.\/core"\})/m,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/csharp/packages/unity/DatabaseLiveClient.cs',
    label: 'C# Unity database-live sdkVersion',
    pattern: /(\["sdkVersion"\] = ")(\d+\.\d+\.\d+)(")/g,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/swift/README.md',
    label: 'Swift README install version',
    pattern: /(\.package\(url: "https:\/\/github\.com\/edge-base\/edgebase-swift", from: ")([^"]+)("\))/m,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/swift/README.md',
    label: 'Swift README core install version',
    pattern: /(\.package\(url: "https:\/\/github\.com\/edge-base\/edgebase-swift-core", from: ")([^"]+)("\))/m,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/swift/packages/core/README.md',
    label: 'Swift core README install version',
    pattern: /(\.package\(url: "https:\/\/github\.com\/edge-base\/edgebase-swift-core", from: ")([^"]+)("\))/m,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/swift/packages/ios/README.md',
    label: 'Swift client README install version',
    pattern: /(\.package\(url: "https:\/\/github\.com\/edge-base\/edgebase-swift", from: ")([^"]+)("\))/m,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'docs/docs/room/client-sdk.md',
    label: 'Room client Dart install version',
    pattern: /(^\s*edgebase_flutter:\s*\^)(\d+\.\d+\.\d+)(\s*$)/m,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'docs/docs/push/client-sdk.md',
    label: 'Push client Dart install version',
    pattern: /(^\s*edgebase_flutter:\s*\^)(\d+\.\d+\.\d+)(\s*$)/m,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/swift/packages/ios/Sources/DatabaseLiveClient.swift',
    label: 'Swift database-live sdkVersion in comments',
    pattern: /(sdkVersion":")(\d+\.\d+\.\d+)(")/g,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/swift/packages/ios/Sources/DatabaseLiveClient.swift',
    label: 'Swift database-live sdkVersion in code',
    pattern: /(sdkVersion": ")(\d+\.\d+\.\d+)(")/g,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'packages/sdk/python/src/edgebase/__init__.py',
    label: 'Python SDK __version__ fallback',
    pattern: /(__version__ = ")(\d+\.\d+\.\d+)(")/m,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'docs/docs/sdks/overview.md',
    label: 'SDK overview Swift install version',
    pattern: /(\.package\(url: "https:\/\/github\.com\/edge-base\/edgebase-swift", from: ")([^"]+)("\))/m,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'docs/docs/sdks/overview.md',
    label: 'SDK overview Kotlin client install version',
    pattern: /(implementation\("com\.github\.edge-base\.edgebase:edgebase-client:)(v?\d+\.\d+\.\d+)("\))/m,
    replace: ({ tagVersion }, prefix, _current, suffix) => `${prefix}${tagVersion}${suffix}`,
  },
  {
    path: 'docs/docs/sdks/overview.md',
    label: 'SDK overview Kotlin admin install version',
    pattern: /(implementation\("com\.github\.edge-base\.edgebase:edgebase-admin-kotlin:)(v?\d+\.\d+\.\d+)("\))/m,
    replace: ({ tagVersion }, prefix, _current, suffix) => `${prefix}${tagVersion}${suffix}`,
  },
  {
    path: 'docs/docs/sdks/overview.md',
    label: 'SDK overview Java client install version',
    pattern: /(implementation 'com\.github\.edge-base\.edgebase:edgebase-android-java:)(v?\d+\.\d+\.\d+)(')/m,
    replace: ({ tagVersion }, prefix, _current, suffix) => `${prefix}${tagVersion}${suffix}`,
  },
  {
    path: 'docs/docs/sdks/overview.md',
    label: 'SDK overview Java admin install version',
    pattern: /(implementation 'com\.github\.edge-base\.edgebase:edgebase-admin-java:)(v?\d+\.\d+\.\d+)(')/m,
    replace: ({ tagVersion }, prefix, _current, suffix) => `${prefix}${tagVersion}${suffix}`,
  },
  {
    path: 'docs/docs/sdks/overview.md',
    label: 'SDK overview Scala admin install version',
    pattern: /(libraryDependencies \+= "com\.github\.edge-base\.edgebase" % "edgebase-admin-scala" % ")(v?\d+\.\d+\.\d+)(")/m,
    replace: ({ tagVersion }, prefix, _current, suffix) => `${prefix}${tagVersion}${suffix}`,
  },
  {
    path: 'docs/docs/sdks/overview.md',
    label: 'SDK overview Elixir admin install version',
    pattern: /(\{:edgebase_admin, "~> )([^"]+)("\})/m,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
  {
    path: 'docs/docs/sdks/overview.md',
    label: 'SDK overview Rust admin install version',
    pattern: /(edgebase-admin = ")([^"]+)(")/m,
    replace: ({ version }, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
  },
];
