import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

function read(relativePath) {
  return readFileSync(resolve(ROOT, relativePath), 'utf8');
}

function expectContains(relativePath, snippets) {
  const content = read(relativePath);
  for (const snippet of snippets) {
    assert.ok(
      content.includes(snippet),
      `${relativePath} is missing expected snippet: ${snippet}`,
    );
  }
}

expectContains('packages/sdk/rust/packages/core/src/generated/api_core.rs', [
  'fn encode_path_param(value: &str) -> String {',
  'encode_path_param(table)',
]);

expectContains('packages/sdk/rust/packages/admin/src/generated/admin_api_core.rs', [
  'fn encode_path_param(value: &str) -> String {',
  'encode_path_param(namespace)',
]);

expectContains('packages/sdk/dart/packages/core/lib/src/generated/api_core.dart', [
  'Uri.encodeComponent(table)',
  'Uri.encodeComponent(id)',
]);

expectContains('packages/sdk/dart/packages/admin/lib/src/generated/admin_api_core.dart', [
  'Uri.encodeComponent(namespace)',
]);

expectContains('packages/sdk/swift/packages/core/Sources/Generated/ApiCore.swift', [
  'private func edgebaseEncodePathParam(_ value: String) -> String {',
  'edgebaseEncodePathParam(table)',
]);

expectContains('packages/sdk/kotlin/core/src/commonMain/kotlin/dev/edgebase/sdk/core/generated/ApiCore.kt', [
  'import dev.edgebase.sdk.core.platformUrlEncode',
  'platformUrlEncode(table)',
]);

expectContains('packages/sdk/kotlin/admin/src/main/kotlin/dev/edgebase/sdk/admin/generated/AdminApiCore.kt', [
  'import dev.edgebase.sdk.core.platformUrlEncode',
  'platformUrlEncode(namespace)',
]);

expectContains('packages/sdk/java/packages/core/src/main/java/dev/edgebase/sdk/core/generated/GeneratedDbApi.java', [
  'private static String encodePathParam(String value) {',
  'encodePathParam(table)',
]);

expectContains('packages/sdk/java/packages/admin/src/main/java/dev/edgebase/sdk/admin/generated/GeneratedAdminApi.java', [
  'private static String encodePathParam(String value) {',
  'encodePathParam(namespace)',
]);

expectContains('packages/sdk/csharp/packages/core/Generated/ApiCore.cs', [
  'private static string EncodePathParam(string value)',
  'EncodePathParam(table)',
]);

expectContains('packages/sdk/csharp/packages/core/Generated/AdminApiCore.cs', [
  'private static string EncodePathParam(string value)',
  'EncodePathParam(@namespace)',
]);

expectContains('packages/sdk/cpp/packages/core/src/generated/api_core.cpp', [
  'std::string edgebase_encode_path_param(const std::string& value) {',
  'edgebase_encode_path_param(table)',
]);

console.log('Generated SDK path encoding looks correct.');
