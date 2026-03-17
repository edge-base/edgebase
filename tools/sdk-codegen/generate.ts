#!/usr/bin/env tsx
/**
 * SDK Core auto-generator — 12 languages.
 *
 * Reads /openapi.json and generates typed Core API interfaces + HTTP implementations
 * for each SDK language.
 *
 * Usage:
 *   npx tsx tools/sdk-codegen/generate.ts
 *
 * Supported languages:
 *   TypeScript, Python, Go, Rust, Dart, Swift, Kotlin, Java, PHP, C#, C++
 *
 * Architecture:
 *   OpenAPI Spec → Core Interface (generated) + HTTP Implementation (generated)
 *                    ↓
 *   Wrapper (hand-written DX code, e.g. QueryBuilder) calls Core methods
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

// ─── Types ──────────────────────────────────────────────────────────────────

interface OpenAPISpec {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, OperationObject>>;
}

interface OperationObject {
  operationId?: string;
  summary?: string;
  tags?: string[];
  parameters?: Array<{
    name: string;
    in: string;
    required?: boolean;
    schema?: { type: string };
  }>;
  requestBody?: {
    content?: Record<string, { schema?: any }>;
  };
  responses?: Record<string, any>;
}

interface MethodDef {
  operationId: string;
  method: string;
  path: string;
  summary: string;
  hasBody: boolean;
  hasQuery: boolean;
  isHead: boolean;   // HEAD requests return no body — special handling needed
  params: string[];  // path parameters
}

interface PathDef {
  operationId: string;
  path: string;
  params: string[];
}

interface LangConfig {
  core?: string;
  admin?: string;
  core_header?: string;
  core_impl?: string;
  stripApiPrefix?: boolean;
}

// ─── Load Config & Spec ─────────────────────────────────────────────────────

const config = JSON.parse(readFileSync(resolve(__dirname, 'config.json'), 'utf-8'));
const specPath = resolve(ROOT, config.specPath);
let spec: OpenAPISpec;
try {
  spec = JSON.parse(readFileSync(specPath, 'utf-8'));
} catch (err) {
  console.error(`Failed to load spec from ${specPath}`);
  process.exit(1);
}

// ─── Name Conversion Utilities ──────────────────────────────────────────────

/** camelCase → snake_case */
function toSnakeCase(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/** camelCase → PascalCase */
function toPascalCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** camelCase → PascalCase + Async suffix (C#) */
function toCSharpName(s: string): string {
  return toPascalCase(s) + 'Async';
}

/** camelCase → SCREAMING_SNAKE_CASE */
function toScreamingSnake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}

/** /api/foo/bar → /foo/bar */
function stripPrefix(path: string): string {
  return path.replace(/^\/api/, '');
}

/** Map HTTP method to a lowercase verb name for SDK calls */
function httpVerb(method: string): string {
  switch (method) {
    case 'GET': return 'get';
    case 'POST': return 'post';
    case 'PUT': return 'put';
    case 'DELETE': return 'delete';
    case 'PATCH': return 'patch';
    case 'HEAD': return 'head';
    default: return 'get';
  }
}

// ─── Reserved Keyword Handling ──────────────────────────────────────────────

const CSHARP_RESERVED = new Set([
  'abstract', 'as', 'base', 'bool', 'break', 'byte', 'case', 'catch', 'char',
  'checked', 'class', 'const', 'continue', 'decimal', 'default', 'delegate',
  'do', 'double', 'else', 'enum', 'event', 'explicit', 'extern', 'false',
  'finally', 'fixed', 'float', 'for', 'foreach', 'goto', 'if', 'implicit',
  'in', 'int', 'interface', 'internal', 'is', 'lock', 'long', 'namespace',
  'new', 'null', 'object', 'operator', 'out', 'override', 'params', 'private',
  'protected', 'public', 'readonly', 'ref', 'return', 'sbyte', 'sealed',
  'short', 'sizeof', 'stackalloc', 'static', 'string', 'struct', 'switch',
  'this', 'throw', 'true', 'try', 'typeof', 'uint', 'ulong', 'unchecked',
  'unsafe', 'ushort', 'using', 'virtual', 'void', 'volatile', 'while',
]);

const CPP_RESERVED = new Set([
  'alignas', 'alignof', 'and', 'asm', 'auto', 'bool', 'break', 'case',
  'catch', 'char', 'class', 'const', 'continue', 'default', 'delete', 'do',
  'double', 'else', 'enum', 'explicit', 'export', 'extern', 'false', 'float',
  'for', 'friend', 'goto', 'if', 'inline', 'int', 'long', 'mutable',
  'namespace', 'new', 'noexcept', 'nullptr', 'operator', 'private',
  'protected', 'public', 'register', 'return', 'short', 'signed', 'sizeof',
  'static', 'struct', 'switch', 'template', 'this', 'throw', 'true', 'try',
  'typedef', 'typeid', 'typename', 'union', 'unsigned', 'using', 'virtual',
  'void', 'volatile', 'while',
]);

/** Escape param name for C# — prefix with @ */
function csParam(name: string): string {
  return CSHARP_RESERVED.has(name) ? `@${name}` : name;
}

/** Escape param name for C++ — append _ suffix */
function cppParam(name: string): string {
  return CPP_RESERVED.has(name) ? `${name}_` : name;
}

// Go reserved keywords
const GO_RESERVED = new Set([
  'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else',
  'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface',
  'map', 'package', 'range', 'return', 'select', 'struct', 'switch', 'type',
  'var',
]);

/** Escape param name for Go — append underscore suffix */
function goParam(name: string): string {
  return GO_RESERVED.has(name) ? `${name}_` : name;
}

// Rust reserved keywords
const RUST_RESERVED = new Set([
  'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn',
  'else', 'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in',
  'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return',
  'self', 'Self', 'static', 'struct', 'super', 'trait', 'true', 'type',
  'union', 'unsafe', 'use', 'where', 'while', 'yield',
]);

/** Escape param name for Rust — prefix with r# (raw identifier) */
function rustParam(name: string): string {
  const snake = toSnakeCase(name);
  return RUST_RESERVED.has(snake) ? `r#${snake}` : snake;
}

// ─── Extract Methods by Tag ─────────────────────────────────────────────────

function extractMethods(): Map<string, MethodDef[]> {
  const byTag = new Map<string, MethodDef[]>();

  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'delete', 'patch', 'head'].includes(method)) continue;
      const operation = op as OperationObject;
      const tag = operation.tags?.[0] ?? 'untagged';
      const targetKey = config.tagMapping[tag] ?? tag;

      if (!byTag.has(targetKey)) byTag.set(targetKey, []);

      // Extract path parameters
      const pathParams = (path.match(/\{(\w+)\}/g) || []).map(p => p.replace(/[{}]/g, ''));

      byTag.get(targetKey)!.push({
        operationId: operation.operationId ?? `${method}_${path}`,
        method: method.toUpperCase(),
        path,
        summary: operation.summary ?? '',
        hasBody: !!operation.requestBody,
        hasQuery: !!(operation.parameters?.some(p => p.in === 'query')),
        isHead: method === 'head',
        params: pathParams,
      });
    }
  }

  return byTag;
}

/** Extract unique paths for Path Constants generation (deduped by operationId).
 *  Multiple HTTP methods on the same path each get their own path constant
 *  (e.g. download_file, check_file_exists, delete_file all share /storage/{bucket}/{key}).
 */
function extractAllPaths(): PathDef[] {
  const seen = new Map<string, PathDef>();
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'delete', 'patch', 'head'].includes(method)) continue;
      const operation = op as OperationObject;
      const opId = operation.operationId ?? `${method}_${path}`;
      if (seen.has(opId)) continue;
      const pathParams = (path.match(/\{(\w+)\}/g) || []).map(p => p.replace(/[{}]/g, ''));
      seen.set(opId, { operationId: opId, path, params: pathParams });
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.path.localeCompare(b.path));
}

// ─── TypeScript Generator ───────────────────────────────────────────────────

function generateTypeScript(tag: string, methods: MethodDef[]): string {
  const lines: string[] = [];

  lines.push(`/**`);
  lines.push(` * Auto-generated ${tag} API Core — DO NOT EDIT.`);
  lines.push(` * Regenerate: npx tsx tools/sdk-codegen/generate.ts`);
  lines.push(` * Source: openapi.json (${spec.info.version})`);
  lines.push(` */`);
  lines.push(``);
  lines.push(`// ─── Interface ─────────────────────────────────────────────────────────────`);
  lines.push(``);

  const interfaceName = tag === 'admin' ? 'GeneratedAdminApi' : 'GeneratedDbApi';
  const className = tag === 'admin' ? 'DefaultAdminApi' : 'DefaultDbApi';

  // Interface
  lines.push(`export interface ${interfaceName} {`);
  for (const m of methods) {
    const args = tsBuildArgs(m);
    const returnType = m.isHead ? 'Promise<boolean>' : 'Promise<unknown>';
    lines.push(`  /** ${m.summary} — ${m.method} ${m.path} */`);
    lines.push(`  ${m.operationId}(${args}): ${returnType};`);
  }
  lines.push(`}`);
  lines.push(``);

  // Implementation
  lines.push(`// ─── Implementation ────────────────────────────────────────────────────────`);
  lines.push(``);
  const hasHead = methods.some(m => m.isHead);
  lines.push(`export interface HttpTransport {`);
  lines.push(`  request<T>(method: string, path: string, options?: {`);
  lines.push(`    query?: Record<string, string>;`);
  lines.push(`    body?: unknown;`);
  lines.push(`  }): Promise<T>;`);
  if (hasHead) {
    lines.push(`  /** HEAD request — returns true if 2xx, false otherwise (no body parsing) */`);
    lines.push(`  head(path: string): Promise<boolean>;`);
  }
  lines.push(`}`);
  lines.push(``);
  lines.push(`export class ${className} implements ${interfaceName} {`);
  lines.push(`  constructor(private readonly transport: HttpTransport) {}`);
  lines.push(``);

  for (const m of methods) {
    const args = tsBuildArgs(m);
    const pathExpr = tsBuildPath(m);

    if (m.isHead) {
      // HEAD methods return boolean (exists/not-exists), no body
      lines.push(`  async ${m.operationId}(${args}): Promise<boolean> {`);
      lines.push(`    return this.transport.head(${pathExpr});`);
    } else {
      lines.push(`  async ${m.operationId}(${args}): Promise<unknown> {`);
      if (m.hasBody && m.hasQuery) {
        lines.push(`    return this.transport.request('${m.method}', ${pathExpr}, { body, query });`);
      } else if (m.hasBody) {
        lines.push(`    return this.transport.request('${m.method}', ${pathExpr}, { body });`);
      } else if (m.hasQuery) {
        lines.push(`    return this.transport.request('${m.method}', ${pathExpr}, { query });`);
      } else {
        lines.push(`    return this.transport.request('${m.method}', ${pathExpr});`);
      }
    }
    lines.push(`  }`);
    lines.push(``);
  }

  lines.push(`}`);
  lines.push(``);

  return lines.join('\n');
}

function tsBuildArgs(m: MethodDef): string {
  const args: string[] = [];
  for (const param of m.params) {
    args.push(`${param}: string`);
  }
  if (m.hasBody) args.push('body: unknown');
  if (m.hasQuery) args.push('query: Record<string, string>');
  return args.join(', ');
}

function tsBuildPath(m: MethodDef): string {
  if (m.params.length === 0) return `'${m.path}'`;
  let path = m.path;
  for (const param of m.params) {
    path = path.replace(`{${param}}`, `\${${param}}`);
  }
  return `\`${path}\``;
}

// ─── Python Generator ───────────────────────────────────────────────────────

function generatePython(tag: string, methods: MethodDef[]): string {
  const lines: string[] = [];
  const className = tag === 'admin' ? 'GeneratedAdminApi' : 'GeneratedDbApi';
  const needsPathQuote = methods.some((m) => m.params.length > 0);

  lines.push(`"""Auto-generated ${tag} API Core — DO NOT EDIT.`);
  lines.push(``);
  lines.push(`Regenerate: npx tsx tools/sdk-codegen/generate.ts`);
  lines.push(`Source: openapi.json (${spec.info.version})`);
  lines.push(`"""`);
  lines.push(``);
  lines.push(`from __future__ import annotations`);
  lines.push(``);
  if (needsPathQuote) {
    lines.push(`import urllib.parse`);
    lines.push(``);
  }
  lines.push(`from typing import TYPE_CHECKING, Any`);
  lines.push(``);
  lines.push(`if TYPE_CHECKING:`);
  lines.push(`    from edgebase_core.http_client import HttpClient`);
  lines.push(``);
  lines.push(``);
  lines.push(`class ${className}:`);
  lines.push(`    """Generated API methods — calls HttpClient internally."""`);
  lines.push(``);
  lines.push(`    def __init__(self, http: HttpClient) -> None:`);
  lines.push(`        self._http = http`);

  for (const m of methods) {
    const name = toSnakeCase(m.operationId);
    const path = stripPrefix(m.path);
    const pyParams = pyBuildParams(m);
    const pyPath = pyBuildPath(m, path);

    const returnType = m.isHead ? 'bool' : 'Any';
    lines.push(``);
    lines.push(`    def ${name}(${pyParams}) -> ${returnType}:`);
    lines.push(`        """${m.summary} — ${m.method} ${m.path}"""`);

    if (m.isHead) {
      lines.push(`        return self._http.head(${pyPath})`);
    } else {
      const verb = httpVerb(m.method);
      if (m.hasBody && m.hasQuery) {
        lines.push(`        return self._http.${verb}(${pyPath}, body, params=query)`);
      } else if (m.hasBody) {
        lines.push(`        return self._http.${verb}(${pyPath}, body)`);
      } else if (m.hasQuery) {
        lines.push(`        return self._http.get(${pyPath}, params=query)`);
      } else if (verb === 'post' || verb === 'put' || verb === 'patch') {
        lines.push(`        return self._http.${verb}(${pyPath})`);
      } else if (verb === 'delete') {
        lines.push(`        return self._http.delete(${pyPath})`);
      } else {
        lines.push(`        return self._http.get(${pyPath})`);
      }
    }
  }

  lines.push(``);
  return lines.join('\n');
}

function pyBuildParams(m: MethodDef): string {
  const args = ['self'];
  for (const param of m.params) {
    args.push(`${toSnakeCase(param)}: str`);
  }
  if (m.hasBody) args.push('body: Any');
  if (m.hasQuery) args.push('query: dict[str, str] | None = None');
  return args.join(', ');
}

function pyBuildPath(m: MethodDef, basePath: string): string {
  if (m.params.length === 0) return `"${basePath}"`;
  let path = basePath;
  for (const param of m.params) {
    path = path.replace(`{${param}}`, `{urllib.parse.quote(${toSnakeCase(param)}, safe='')}`);
  }
  return `f"${path}"`;
}

// ─── Ruby Generator ─────────────────────────────────────────────────────────

function generateRuby(tag: string, methods: MethodDef[]): string {
  const lines: string[] = [];
  const className = tag === 'admin' ? 'GeneratedAdminApi' : 'GeneratedDbApi';
  const moduleName = tag === 'admin' ? 'EdgebaseAdmin' : 'EdgebaseCore';
  const needsPathQuote = methods.some((m) => m.params.length > 0);

  lines.push(`# frozen_string_literal: true`);
  lines.push(``);
  lines.push(`# Auto-generated ${tag} API Core — DO NOT EDIT.`);
  lines.push(`#`);
  lines.push(`# Regenerate: npx tsx tools/sdk-codegen/generate.ts`);
  lines.push(`# Source: openapi.json (${spec.info.version})`);
  lines.push(``);
  if (needsPathQuote) {
    lines.push(`require "cgi"`);
    lines.push(``);
  }
  lines.push(`module ${moduleName}`);
  lines.push(`  class ${className}`);
  lines.push(`    # Generated API methods — calls HttpClient internally.`);
  lines.push(``);
  lines.push(`    def initialize(http)`);
  lines.push(`      @http = http`);
  lines.push(`    end`);
  if (tag === 'core') {
    lines.push(``);
    lines.push(`    attr_reader :http`);
  }

  for (const m of methods) {
    const name = toSnakeCase(m.operationId);
    const path = stripPrefix(m.path);
    const rubyParams = rubyBuildParams(m);
    const rubyPath = rubyBuildPath(m, path);

    lines.push(``);
    lines.push(`    # ${m.summary} — ${m.method} ${m.path}`);
    lines.push(`    def ${name}(${rubyParams})`);

    if (m.isHead) {
      lines.push(`      @http.head(${rubyPath})`);
    } else {
      const verb = httpVerb(m.method);
      if (m.hasBody && m.hasQuery) {
        lines.push(`      @http.${verb}(${rubyPath}, body, params: query)`);
      } else if (m.hasBody) {
        lines.push(`      @http.${verb}(${rubyPath}, body)`);
      } else if (m.hasQuery) {
        lines.push(`      @http.get(${rubyPath}, params: query)`);
      } else if (verb === 'post' || verb === 'put' || verb === 'patch') {
        lines.push(`      @http.${verb}(${rubyPath})`);
      } else if (verb === 'delete') {
        lines.push(`      @http.delete(${rubyPath})`);
      } else {
        lines.push(`      @http.get(${rubyPath})`);
      }
    }

    lines.push(`    end`);
  }

  lines.push(`  end`);
  lines.push(`end`);
  lines.push(``);
  return lines.join('\n');
}

function rubyBuildParams(m: MethodDef): string {
  const args: string[] = [];
  for (const param of m.params) {
    args.push(toSnakeCase(param));
  }
  if (m.hasBody) args.push('body = nil');
  if (m.hasQuery) args.push('query: nil');
  return args.join(', ');
}

function rubyBuildPath(m: MethodDef, basePath: string): string {
  if (m.params.length === 0) return `"${basePath}"`;
  let path = basePath;
  for (const param of m.params) {
    path = path.replace(`{${param}}`, `#{CGI.escape(${toSnakeCase(param)}).gsub('+', '%20')}`);
  }
  return `"${path}"`;
}

// ─── Go Generator ───────────────────────────────────────────────────────────

function generateGo(tag: string, methods: MethodDef[]): string {
  const lines: string[] = [];
  const structName = tag === 'admin' ? 'GeneratedAdminApi' : 'GeneratedDbApi';

  lines.push(`// Auto-generated ${tag} API Core — DO NOT EDIT.`);
  lines.push(`// Regenerate: npx tsx tools/sdk-codegen/generate.ts`);
  lines.push(`// Source: openapi.json (${spec.info.version})`);
  lines.push(``);
  lines.push(`package edgebase`);
  lines.push(``);
  lines.push(`import "context"`);
  lines.push(``);
  lines.push(`// ${structName} contains auto-generated API methods.`);
  lines.push(`type ${structName} struct {`);
  lines.push(`\tclient *HTTPClient`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`// New${structName} creates a new instance.`);
  lines.push(`func New${structName}(client *HTTPClient) *${structName} {`);
  lines.push(`\treturn &${structName}{client: client}`);
  lines.push(`}`);

  for (const m of methods) {
    const name = toPascalCase(m.operationId);
    const path = m.path; // Go SDK does NOT strip /api/
    const goParams = goBuildParams(m);
    const goPath = goBuildPath(m, path);

    lines.push(``);
    lines.push(`// ${name} — ${m.summary} — ${m.method} ${m.path}`);

    if (m.isHead) {
      lines.push(`func (a *${structName}) ${name}(${goParams}) (bool, error) {`);
      lines.push(`\treturn a.client.Head(ctx, ${goPath})`);
    } else {
      lines.push(`func (a *${structName}) ${name}(${goParams}) (map[string]interface{}, error) {`);
      if (m.hasBody && m.hasQuery) {
        lines.push(`\treturn a.client.DoWithQuery(ctx, "${m.method}", ${goPath}, body, query)`);
      } else if (m.hasBody) {
        lines.push(`\treturn a.client.do(ctx, "${m.method}", ${goPath}, body)`);
      } else if (m.hasQuery) {
        lines.push(`\treturn a.client.GetWithQuery(ctx, ${goPath}, query)`);
      } else {
        const goMethod = m.method === 'DELETE' ? 'Delete' : m.method === 'PUT' ? 'Put' : m.method === 'PATCH' ? 'Patch' : m.method === 'POST' ? 'Post' : 'Get';
        if (['POST', 'PUT', 'PATCH'].includes(m.method)) {
          lines.push(`\treturn a.client.${goMethod}(ctx, ${goPath}, nil)`);
        } else {
          lines.push(`\treturn a.client.${goMethod}(ctx, ${goPath})`);
        }
      }
    }
    lines.push(`}`);
  }

  lines.push(``);
  return lines.join('\n');
}

function goBuildParams(m: MethodDef): string {
  const args = ['ctx context.Context'];
  for (const param of m.params) {
    args.push(`${goParam(param)} string`);
  }
  if (m.hasBody) args.push('body interface{}');
  if (m.hasQuery) args.push('query map[string]string');
  return args.join(', ');
}

function goBuildPath(m: MethodDef, basePath: string): string {
  if (m.params.length === 0) return `"${basePath}"`;
  // Use fmt.Sprintf for path params
  let fmtPath = basePath;
  const fmtArgs: string[] = [];
  for (const param of m.params) {
    fmtPath = fmtPath.replace(`{${param}}`, '%s');
    fmtArgs.push(`url.PathEscape(${goParam(param)})`);
  }
  return `fmt.Sprintf("${fmtPath}", ${fmtArgs.join(', ')})`;
}

function generateGoWithFmt(tag: string, methods: MethodDef[]): string {
  // Check if any method has path params → need "fmt" import
  const needsFmt = methods.some(m => m.params.length > 0);
  const content = generateGo(tag, methods);
  if (needsFmt) {
    return content.replace(`import "context"`, `import (\n\t"context"\n\t"fmt"\n\t"net/url"\n)`);
  }
  return content;
}

// ─── Rust Generator ─────────────────────────────────────────────────────────

function generateRust(tag: string, methods: MethodDef[]): string {
  const lines: string[] = [];
  const structName = tag === 'admin' ? 'GeneratedAdminApi' : 'GeneratedDbApi';

  lines.push(`//! Auto-generated ${tag} API Core — DO NOT EDIT.`);
  lines.push(`//! Regenerate: npx tsx tools/sdk-codegen/generate.ts`);
  lines.push(`//! Source: openapi.json (${spec.info.version})`);
  lines.push(``);
  lines.push(`use crate::Error;`);
  lines.push(`use crate::HttpClient;`);
  lines.push(`use serde_json::Value;`);
  lines.push(``);
  lines.push(`fn encode_path_param(value: &str) -> String {`);
  lines.push(`    urlencoding::encode(value).into_owned()`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`/// Auto-generated API methods.`);
  lines.push(`pub struct ${structName}<'a> {`);
  lines.push(`    http: &'a HttpClient,`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`impl<'a> ${structName}<'a> {`);
  lines.push(`    pub fn new(http: &'a HttpClient) -> Self {`);
  lines.push(`        Self { http }`);
  lines.push(`    }`);

  for (const m of methods) {
    const name = toSnakeCase(m.operationId);
    const path = m.path; // Rust SDK does NOT strip /api/
    const rustParams = rustBuildParams(m);
    const rustPath = rustBuildPath(m, path);

    lines.push(``);
    lines.push(`    /// ${m.summary} — ${m.method} ${m.path}`);

    if (m.isHead) {
      lines.push(`    pub async fn ${name}(${rustParams}) -> Result<bool, Error> {`);
      lines.push(`        self.http.head(${rustPath}).await`);
    } else {
      const verb = httpVerb(m.method);
      lines.push(`    pub async fn ${name}(${rustParams}) -> Result<Value, Error> {`);
      if (m.hasBody && m.hasQuery) {
        lines.push(`        self.http.${verb}_with_query(${rustPath}, body, query).await`);
      } else if (m.hasBody) {
        // Rust: delete() takes no body; use delete_with_body() for DELETE+body
        const rustVerb = verb === 'delete' ? 'delete_with_body' : verb;
        lines.push(`        self.http.${rustVerb}(${rustPath}, body).await`);
      } else if (m.hasQuery) {
        lines.push(`        self.http.get_with_query(${rustPath}, query).await`);
      } else if (verb === 'post' || verb === 'patch' || verb === 'put') {
        lines.push(`        self.http.${verb}(${rustPath}, &Value::Null).await`);
      } else if (verb === 'delete') {
        lines.push(`        self.http.delete(${rustPath}).await`);
      } else {
        lines.push(`        self.http.get(${rustPath}).await`);
      }
    }
    lines.push(`    }`);
  }

  lines.push(`}`);
  lines.push(``);
  return lines.join('\n');
}

function rustBuildParams(m: MethodDef): string {
  const args = ['&self'];
  for (const param of m.params) {
    args.push(`${rustParam(param)}: &str`);
  }
  if (m.hasBody) args.push('body: &Value');
  if (m.hasQuery) args.push('query: &std::collections::HashMap<String, String>');
  return args.join(', ');
}

function rustBuildPath(m: MethodDef, basePath: string): string {
  if (m.params.length === 0) return `"${basePath}"`;
  let fmtStr = basePath;
  const fmtArgs: string[] = [];
  for (const param of m.params) {
    fmtStr = fmtStr.replace(`{${param}}`, '{}');
    fmtArgs.push(`encode_path_param(${rustParam(param)})`);
  }
  return `&format!("${fmtStr}", ${fmtArgs.join(', ')})`;
}

// ─── Dart Generator ─────────────────────────────────────────────────────────

function generateDart(tag: string, methods: MethodDef[]): string {
  const lines: string[] = [];
  const className = tag === 'admin' ? 'GeneratedAdminApi' : 'GeneratedDbApi';

  lines.push(`// Auto-generated ${tag} API Core — DO NOT EDIT.`);
  lines.push(`// Regenerate: npx tsx tools/sdk-codegen/generate.ts`);
  lines.push(`// Source: openapi.json (${spec.info.version})`);
  lines.push(``);
  if (tag === 'admin') {
    lines.push(`import 'package:edgebase_core/src/http_client.dart';`);
  } else {
    lines.push(`import '../http_client.dart';`);
  }
  lines.push(``);
  lines.push(`/// Auto-generated API methods.`);
  lines.push(`class ${className} {`);
  lines.push(`  final HttpClient _http;`);
  lines.push(``);
  lines.push(`  /// Expose the underlying HttpClient for subclass access.`);
  lines.push(`  HttpClient get httpClient => _http;`);
  lines.push(``);
  lines.push(`  ${className}(this._http);`);

  for (const m of methods) {
    const name = m.operationId; // Dart uses camelCase
    const path = stripPrefix(m.path); // Dart auto-prepends /api/
    const dartParams = dartBuildParams(m);
    const dartPath = dartBuildPath(m, path);

    lines.push(``);
    lines.push(`  /// ${m.summary} — ${m.method} ${m.path}`);

    if (m.isHead) {
      lines.push(`  Future<bool> ${name}(${dartParams}) async {`);
      lines.push(`    return _http.head(${dartPath});`);
    } else {
      const verb = httpVerb(m.method);
      lines.push(`  Future<dynamic> ${name}(${dartParams}) async {`);
      if (m.hasBody && m.hasQuery) {
        lines.push(`    return _http.${verb}WithQuery(${dartPath}, body, query);`);
      } else if (m.hasBody) {
        lines.push(`    return _http.${verb}(${dartPath}, body);`);
      } else if (m.hasQuery) {
        lines.push(`    return _http.get(${dartPath}, query);`);
      } else if (verb === 'post' || verb === 'patch' || verb === 'put') {
        lines.push(`    return _http.${verb}(${dartPath}, {});`);
      } else if (verb === 'delete') {
        lines.push(`    return _http.delete(${dartPath});`);
      } else {
        lines.push(`    return _http.get(${dartPath}, null);`);
      }
    }
    lines.push(`  }`);
  }

  lines.push(`}`);
  lines.push(``);
  return lines.join('\n');
}

function dartBuildParams(m: MethodDef): string {
  const args: string[] = [];
  for (const param of m.params) {
    args.push(`String ${param}`);
  }
  if (m.hasBody) args.push('Object? body');
  if (m.hasQuery) args.push('Map<String, String>? query');
  return args.join(', ');
}

function dartBuildPath(m: MethodDef, basePath: string): string {
  if (m.params.length === 0) return `'${basePath}'`;
  let path = basePath;
  for (const param of m.params) {
    path = path.replace(`{${param}}`, `\${Uri.encodeComponent(${param})}`);
  }
  return `'${path}'`;
}

// ─── Swift Generator ────────────────────────────────────────────────────────

function generateSwift(tag: string, methods: MethodDef[]): string {
  const lines: string[] = [];
  const structName = tag === 'admin' ? 'GeneratedAdminApi' : 'GeneratedDbApi';

  lines.push(`// Auto-generated ${tag} API Core — DO NOT EDIT.`);
  lines.push(`// Regenerate: npx tsx tools/sdk-codegen/generate.ts`);
  lines.push(`// Source: openapi.json (${spec.info.version})`);
  lines.push(``);
  lines.push(`import Foundation`);
  lines.push(``);
  lines.push(`private func edgebaseEncodePathParam(_ value: String) -> String {`);
  lines.push(`    var allowed = CharacterSet.alphanumerics`);
  lines.push(`    allowed.insert(charactersIn: "-._~")`);
  lines.push(`    return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`/// Auto-generated API methods.`);
  lines.push(`public struct ${structName} {`);
  lines.push(`    private let http: HttpClient`);
  lines.push(``);
  lines.push(`    public init(http: HttpClient) {`);
  lines.push(`        self.http = http`);
  lines.push(`    }`);

  for (const m of methods) {
    const name = m.operationId; // Swift uses camelCase
    const path = stripPrefix(m.path); // Swift auto-prepends /api/
    const swiftParams = swiftBuildParams(m);
    const swiftPath = swiftBuildPath(m, path);

    lines.push(``);
    lines.push(`    /// ${m.summary} — ${m.method} ${m.path}`);

    if (m.isHead) {
      lines.push(`    public func ${name}(${swiftParams}) async -> Bool {`);
      lines.push(`        return await http.head(${swiftPath})`);
    } else {
      const verb = httpVerb(m.method);
      lines.push(`    public func ${name}(${swiftParams}) async throws -> Any {`);
      if (m.hasBody && m.hasQuery) {
        lines.push(`        return try await http.${verb}(${swiftPath}, body, queryParams: query)`);
      } else if (m.hasBody) {
        lines.push(`        return try await http.${verb}(${swiftPath}, body)`);
      } else if (m.hasQuery) {
        lines.push(`        return try await http.get(${swiftPath}, queryParams: query)`);
      } else if (verb === 'post' || verb === 'patch' || verb === 'put') {
        lines.push(`        return try await http.${verb}(${swiftPath}, [:])`);
      } else if (verb === 'delete') {
        lines.push(`        return try await http.delete(${swiftPath})`);
      } else {
        lines.push(`        return try await http.get(${swiftPath})`);
      }
    }
    lines.push(`    }`);
  }

  lines.push(`}`);
  lines.push(``);
  return lines.join('\n');
}

function swiftBuildParams(m: MethodDef): string {
  const args: string[] = [];
  for (const param of m.params) {
    args.push(`_ ${param}: String`);
  }
  if (m.hasBody) args.push('_ body: [String: Any]');
  if (m.hasQuery) args.push('query: [String: String]? = nil');
  return args.join(', ');
}

function swiftBuildPath(m: MethodDef, basePath: string): string {
  if (m.params.length === 0) return `"${basePath}"`;
  let path = basePath;
  for (const param of m.params) {
    path = path.replace(`{${param}}`, `\\(edgebaseEncodePathParam(${param}))`);
  }
  return `"${path}"`;
}

// ─── Kotlin Generator ───────────────────────────────────────────────────────

function generateKotlin(tag: string, methods: MethodDef[]): string {
  const lines: string[] = [];
  const className = tag === 'admin' ? 'GeneratedAdminApi' : 'GeneratedDbApi';
  const pkg = tag === 'admin' ? 'dev.edgebase.sdk.admin.generated' : 'dev.edgebase.sdk.core.generated';
  const httpImport = tag === 'admin' ? 'dev.edgebase.sdk.core.HttpClient' : 'dev.edgebase.sdk.core.HttpClient';

  lines.push(`// Auto-generated ${tag} API Core — DO NOT EDIT.`);
  lines.push(`// Regenerate: npx tsx tools/sdk-codegen/generate.ts`);
  lines.push(`// Source: openapi.json (${spec.info.version})`);
  lines.push(``);
  lines.push(`package ${pkg}`);
  lines.push(``);
  lines.push(`import ${httpImport}`);
  lines.push(`import dev.edgebase.sdk.core.platformUrlEncode`);
  lines.push(``);
  lines.push(`/**`);
  lines.push(` * Auto-generated API methods.`);
  lines.push(` */`);
  // Core class is `open` with `protected` http to allow subclass adapter subclassing.
  const ktClassMod = tag === 'core' ? 'open ' : '';
  const ktHttpVis = tag === 'core' ? 'protected' : 'private';
  lines.push(`${ktClassMod}class ${className}(${ktHttpVis} val http: HttpClient) {`);

  // Expose httpClient getter for subclass access from external instances (e.g. subclass adapter)
  if (tag === 'core') {
    lines.push(``);
    lines.push(`    /** Expose the underlying HttpClient for adapter access. */`);
    lines.push(`    val httpClient: HttpClient get() = http`);
  }

  for (const m of methods) {
    const name = m.operationId; // Kotlin uses camelCase
    const path = stripPrefix(m.path); // Kotlin auto-prepends /api/
    const ktParams = ktBuildParams(m);
    const ktPath = ktBuildPath(m, path);
    // dbSingle* methods are `open` in core so subclass adapter can override them.
    const ktMethodMod = tag === 'core' && name.startsWith('dbSingle') ? 'open ' : '';

    lines.push(``);
    lines.push(`    /** ${m.summary} — ${m.method} ${m.path} */`);

    if (m.isHead) {
      lines.push(`    ${ktMethodMod}suspend fun ${name}(${ktParams}): Boolean =`);
      lines.push(`        http.head(${ktPath})`);
    } else {
      const verb = httpVerb(m.method);
      lines.push(`    @Suppress("UNCHECKED_CAST")`);
      lines.push(`    ${ktMethodMod}suspend fun ${name}(${ktParams}): Any? =`);
      if (m.hasBody && m.hasQuery) {
        lines.push(`        http.${verb}WithQuery(${ktPath}, body, query)`);
      } else if (m.hasBody) {
        lines.push(`        http.${verb}(${ktPath}, body)`);
      } else if (m.hasQuery) {
        lines.push(`        http.get(${ktPath}, query)`);
      } else if (verb === 'post' || verb === 'patch' || verb === 'put') {
        lines.push(`        http.${verb}(${ktPath})`);
      } else if (verb === 'delete') {
        lines.push(`        http.delete(${ktPath})`);
      } else {
        lines.push(`        http.get(${ktPath})`);
      }
    }
  }

  lines.push(`}`);
  lines.push(``);
  return lines.join('\n');
}

function ktBuildParams(m: MethodDef): string {
  const args: string[] = [];
  for (const param of m.params) {
    args.push(`${param}: String`);
  }
  if (m.hasBody) args.push('body: Map<String, Any?> = emptyMap()');
  if (m.hasQuery) args.push('query: Map<String, String>? = null');
  return args.join(', ');
}

function ktBuildPath(m: MethodDef, basePath: string): string {
  if (m.params.length === 0) return `"${basePath}"`;
  let path = basePath;
  for (const param of m.params) {
    path = path.replace(`{${param}}`, `\${platformUrlEncode(${param})}`);
  }
  return `"${path}"`;
}

// ─── Java Generator ─────────────────────────────────────────────────────────

function generateJava(tag: string, methods: MethodDef[]): string {
  const lines: string[] = [];
  const className = tag === 'admin' ? 'GeneratedAdminApi' : 'GeneratedDbApi';
  const pkg = tag === 'admin' ? 'dev.edgebase.sdk.admin.generated' : 'dev.edgebase.sdk.core.generated';
  const httpImport = 'dev.edgebase.sdk.core.HttpClient';
  const errorImport = 'dev.edgebase.sdk.core.EdgeBaseError';

  lines.push(`// Auto-generated ${tag} API Core — DO NOT EDIT.`);
  lines.push(`// Regenerate: npx tsx tools/sdk-codegen/generate.ts`);
  lines.push(`// Source: openapi.json (${spec.info.version})`);
  lines.push(``);
  lines.push(`package ${pkg};`);
  lines.push(``);
  lines.push(`import ${httpImport};`);
  lines.push(`import ${errorImport};`);
  lines.push(``);
  lines.push(`import java.net.URLEncoder;`);
  lines.push(`import java.nio.charset.StandardCharsets;`);
  lines.push(`import java.util.Map;`);
  lines.push(``);
  lines.push(`/**`);
  lines.push(` * Auto-generated API methods.`);
  lines.push(` */`);
  lines.push(`public class ${className} {`);
  lines.push(`    private final HttpClient http;`);
  lines.push(``);
  lines.push(`    public ${className}(HttpClient http) {`);
  lines.push(`        this.http = http;`);
  lines.push(`    }`);
  lines.push(``);
  lines.push(`    private static String encodePathParam(String value) {`);
  lines.push(`        return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");`);
  lines.push(`    }`);

  for (const m of methods) {
    const name = m.operationId; // Java uses camelCase
    const path = stripPrefix(m.path); // Java auto-prepends /api/
    const javaParams = javaBuildParams(m);
    const javaPath = javaBuildPath(m, path);

    lines.push(``);
    lines.push(`    /** ${m.summary} — ${m.method} ${m.path} */`);

    if (m.isHead) {
      lines.push(`    public boolean ${name}(${javaParams}) throws EdgeBaseError {`);
      lines.push(`        return http.head(${javaPath});`);
    } else {
      const verb = httpVerb(m.method);
      lines.push(`    public Object ${name}(${javaParams}) throws EdgeBaseError {`);
      if (m.hasBody && m.hasQuery) {
        lines.push(`        return http.${verb}WithQuery(${javaPath}, body, query);`);
      } else if (m.hasBody) {
        lines.push(`        return http.${verb}(${javaPath}, body);`);
      } else if (m.hasQuery) {
        lines.push(`        return http.getWithQuery(${javaPath}, query);`);
      } else if (verb === 'post' || verb === 'patch' || verb === 'put') {
        lines.push(`        return http.${verb}(${javaPath}, null);`);
      } else if (verb === 'delete') {
        lines.push(`        return http.delete(${javaPath});`);
      } else {
        lines.push(`        return http.get(${javaPath});`);
      }
    }
    lines.push(`    }`);
  }

  lines.push(`}`);
  lines.push(``);
  return lines.join('\n');
}

function javaBuildParams(m: MethodDef): string {
  const args: string[] = [];
  for (const param of m.params) {
    args.push(`String ${param}`);
  }
  if (m.hasBody) args.push('Map<String, ?> body');
  if (m.hasQuery) args.push('Map<String, String> query');
  return args.join(', ');
}

function javaBuildPath(m: MethodDef, basePath: string): string {
  if (m.params.length === 0) return `"${basePath}"`;
  let expr = `"${basePath}"`;
  for (const param of m.params) {
    expr = expr.replace(`{${param}}`, `" + encodePathParam(${param}) + "`);
  }
  // Clean up trailing empty strings
  return expr.replace(/ \+ ""$/, '').replace(/"" \+ /g, '');
}

// ─── PHP Generator ──────────────────────────────────────────────────────────

function generatePhp(tag: string, methods: MethodDef[]): string {
  const lines: string[] = [];
  const className = tag === 'admin' ? 'GeneratedAdminApi' : 'GeneratedDbApi';

  lines.push(`<?php`);
  lines.push(``);
  lines.push(`// Auto-generated ${tag} API Core — DO NOT EDIT.`);
  lines.push(`// Regenerate: npx tsx tools/sdk-codegen/generate.ts`);
  lines.push(`// Source: openapi.json (${spec.info.version})`);
  lines.push(``);
  lines.push(`declare(strict_types=1);`);
  lines.push(``);
  lines.push(`namespace EdgeBase\\Core\\Generated;`);
  lines.push(``);
  lines.push(`use EdgeBase\\Core\\HttpClient;`);
  lines.push(``);
  lines.push(`/**`);
  lines.push(` * Auto-generated API methods.`);
  lines.push(` */`);
  lines.push(`class ${className}`);
  lines.push(`{`);
  // Core class uses `protected` $http so subclass adapter can access it.
  const phpHttpVis = tag === 'core' ? 'protected' : 'private';
  lines.push(`    ${phpHttpVis} HttpClient $http;`);
  lines.push(``);
  lines.push(`    public function __construct(HttpClient $http)`);
  lines.push(`    {`);
  lines.push(`        $this->http = $http;`);
  lines.push(`    }`);
  if (tag === 'core') {
    lines.push(``);
    lines.push(`    public function http_client(): HttpClient`);
    lines.push(`    {`);
    lines.push(`        return $this->http;`);
    lines.push(`    }`);
  }

  for (const m of methods) {
    const name = toSnakeCase(m.operationId); // PHP uses snake_case
    const path = stripPrefix(m.path); // PHP auto-prepends /api/
    const phpParams = phpBuildParams(m);
    const phpPath = phpBuildPath(m, path);

    lines.push(``);
    lines.push(`    /** ${m.summary} — ${m.method} ${m.path} */`);

    if (m.isHead) {
      lines.push(`    public function ${name}(${phpParams}): bool`);
      lines.push(`    {`);
      lines.push(`        return $this->http->head(${phpPath});`);
    } else {
      const verb = httpVerb(m.method);
      lines.push(`    public function ${name}(${phpParams}): mixed`);
      lines.push(`    {`);
      if (m.hasBody && m.hasQuery) {
        lines.push(`        return $this->http->${verb}WithQuery(${phpPath}, $body, $query);`);
      } else if (m.hasBody) {
        lines.push(`        return $this->http->${verb}(${phpPath}, $body);`);
      } else if (m.hasQuery) {
        lines.push(`        return $this->http->get(${phpPath}, $query);`);
      } else if (verb === 'post' || verb === 'patch' || verb === 'put') {
        lines.push(`        return $this->http->${verb}(${phpPath});`);
      } else if (verb === 'delete') {
        lines.push(`        return $this->http->delete(${phpPath});`);
      } else {
        lines.push(`        return $this->http->get(${phpPath});`);
      }
    }
    lines.push(`    }`);
  }

  lines.push(`}`);
  lines.push(``);
  return lines.join('\n');
}

function phpBuildParams(m: MethodDef): string {
  const args: string[] = [];
  for (const param of m.params) {
    args.push(`string $${toSnakeCase(param)}`);
  }
  if (m.hasBody) args.push('mixed $body = null');
  if (m.hasQuery) args.push('array $query = []');
  return args.join(', ');
}

function phpBuildPath(m: MethodDef, basePath: string): string {
  if (m.params.length === 0) return `'${basePath}'`;
  let expr = `'${basePath}'`;
  for (const param of m.params) {
    expr = expr.replace(`{${param}}`, `' . rawurlencode($${toSnakeCase(param)}) . '`);
  }
  return expr.replace(/ \. ''$/, '').replace(/^'' \. /, '').replace(/'' \. /g, '');
}

// ─── C# Generator ───────────────────────────────────────────────────────────

function generateCSharp(tag: string, methods: MethodDef[]): string {
  const lines: string[] = [];
  const className = tag === 'admin' ? 'GeneratedAdminApi' : 'GeneratedDbApi';

  lines.push(`// Auto-generated ${tag} API Core — DO NOT EDIT.`);
  lines.push(`// Regenerate: npx tsx tools/sdk-codegen/generate.ts`);
  lines.push(`// Source: openapi.json (${spec.info.version})`);
  lines.push(``);
  lines.push(`using System;`);
  lines.push(`using System.Collections.Generic;`);
  lines.push(`using System.Threading;`);
  lines.push(`using System.Threading.Tasks;`);
  lines.push(``);
  lines.push(`namespace EdgeBase.Generated`);
  lines.push(`{`);
  lines.push(``);
  lines.push(`/// <summary>`);
  lines.push(`/// Auto-generated API methods.`);
  lines.push(`/// </summary>`);
  lines.push(`public class ${className}`);
  lines.push(`{`);
  lines.push(`    private readonly JbHttpClient _http;`);
  lines.push(``);
  lines.push(`    public ${className}(JbHttpClient http)`);
  lines.push(`    {`);
  lines.push(`        _http = http;`);
  lines.push(`    }`);
  lines.push(``);
  lines.push(`    private static string EncodePathParam(string value)`);
  lines.push(`        => Uri.EscapeDataString(value);`);

  for (const m of methods) {
    const name = toCSharpName(m.operationId); // PascalCase + Async
    const path = m.path; // C# SDK does NOT strip /api/
    const csParams = csBuildParams(m);
    const csPath = csBuildPath(m, path);

    lines.push(``);
    lines.push(`    /// <summary>${m.summary} — ${m.method} ${m.path}</summary>`);

    if (m.isHead) {
      lines.push(`    public Task<bool> ${name}(${csParams})`);
      lines.push(`        => _http.HeadAsync(${csPath}, ct);`);
    } else {
      const httpMethod = m.method === 'GET' ? 'GetAsync' : m.method === 'POST' ? 'PostAsync' : m.method === 'PATCH' ? 'PatchAsync' : m.method === 'PUT' ? 'PutAsync' : 'DeleteAsync';

      if (m.hasBody && m.hasQuery) {
        lines.push(`    public Task<Dictionary<string, object?>> ${name}(${csParams})`);
        lines.push(`        => _http.${httpMethod}WithQuery(${csPath}, body, query, ct);`);
      } else if (m.hasBody) {
        lines.push(`    public Task<Dictionary<string, object?>> ${name}(${csParams})`);
        lines.push(`        => _http.${httpMethod}(${csPath}, body, ct);`);
      } else if (m.hasQuery) {
        lines.push(`    public Task<Dictionary<string, object?>> ${name}(${csParams})`);
        lines.push(`        => _http.GetWithQueryAsync(${csPath}, query, ct);`);
      } else {
        lines.push(`    public Task<Dictionary<string, object?>> ${name}(${csParams})`);
        lines.push(`        => _http.${httpMethod}(${csPath}${httpMethod === 'GetAsync' || httpMethod === 'DeleteAsync' ? ', ct' : ', null, ct'});`);
      }
    }
  }

  lines.push(`}`);
  lines.push(``);
  lines.push(`}`);
  lines.push(``);
  return lines.join('\n');
}

function csBuildParams(m: MethodDef): string {
  const args: string[] = [];
  for (const param of m.params) {
    args.push(`string ${csParam(param)}`);
  }
  if (m.hasBody) args.push('object? body = null');
  if (m.hasQuery) args.push('Dictionary<string, string>? query = null');
  args.push('CancellationToken ct = default');
  return args.join(', ');
}

function csBuildPath(m: MethodDef, basePath: string): string {
  if (m.params.length === 0) return `"${basePath}"`;
  let expr = `$"${basePath}"`;
  for (const param of m.params) {
    expr = expr.replace(`{${param}}`, `{EncodePathParam(${csParam(param)})}`);
  }
  return expr;
}

// ─── C++ Generator ──────────────────────────────────────────────────────────

function generateCppHeader(tag: string, methods: MethodDef[]): string {
  const lines: string[] = [];
  const className = tag === 'admin' ? 'GeneratedAdminApi' : 'GeneratedDbApi';

  lines.push(`// Auto-generated ${tag} API Core — DO NOT EDIT.`);
  lines.push(`// Regenerate: npx tsx tools/sdk-codegen/generate.ts`);
  lines.push(`// Source: openapi.json (${spec.info.version})`);
  lines.push(``);
  lines.push(`#pragma once`);
  lines.push(``);
  lines.push(`#include <string>`);
  lines.push(`#include <map>`);
  lines.push(``);
  lines.push(`namespace client {`);
  lines.push(``);
  lines.push(`struct Result;`);
  lines.push(`class HttpClient;`);
  lines.push(``);
  lines.push(`/// Auto-generated API methods.`);
  lines.push(`class ${className} {`);
  lines.push(`public:`);
  lines.push(`  explicit ${className}(HttpClient& http) : http_(http) {}`);
  // Core class needs virtual destructor for safe polymorphic deletion (subclass adapter).
  if (tag === 'core') {
    lines.push(`  virtual ~${className}() = default;`);
    // Accessor for subclass constructors (e.g. subclass adapter).
    lines.push(`  HttpClient& getHttp() const { return http_; }`);
  }
  lines.push(``);

  for (const m of methods) {
    const name = toSnakeCase(m.operationId);
    const cppParams = cppBuildHeaderParams(m);
    // dbSingle* methods are virtual in core so subclass adapter can override them.
    const cppVirtual = tag === 'core' && m.operationId.startsWith('dbSingle') ? 'virtual ' : '';

    lines.push(`  /// ${m.summary} — ${m.method} ${m.path}`);
    if (m.isHead) {
      lines.push(`  ${cppVirtual}bool ${name}(${cppParams}) const;`);
    } else {
      lines.push(`  ${cppVirtual}Result ${name}(${cppParams}) const;`);
    }
  }

  lines.push(``);
  // Core class uses `protected` http_ so subclass adapter subclass can access it.
  const cppHttpSection = tag === 'core' ? 'protected' : 'private';
  lines.push(`${cppHttpSection}:`);
  lines.push(`  HttpClient& http_;`);
  lines.push(`};`);
  lines.push(``);
  lines.push(`} // namespace client`);
  lines.push(``);
  return lines.join('\n');
}

function generateCppImpl(tag: string, methods: MethodDef[]): string {
  const lines: string[] = [];
  const className = tag === 'admin' ? 'GeneratedAdminApi' : 'GeneratedDbApi';

  lines.push(`// Auto-generated ${tag} API Core — DO NOT EDIT.`);
  lines.push(`// Regenerate: npx tsx tools/sdk-codegen/generate.ts`);
  lines.push(`// Source: openapi.json (${spec.info.version})`);
  lines.push(``);
  lines.push(`#include "edgebase/generated/api_core.h"`);
  lines.push(`#include "edgebase/edgebase.h"`);
  lines.push(``);
  lines.push(`namespace client {`);
  lines.push(`namespace {`);
  lines.push(`std::string edgebase_encode_path_param(const std::string& value) {`);
  lines.push(`  static constexpr char HEX[] = "0123456789ABCDEF";`);
  lines.push(`  std::string encoded;`);
  lines.push(`  encoded.reserve(value.size() * 3);`);
  lines.push(`  for (unsigned char ch : value) {`);
  lines.push(`    const bool is_unreserved =`);
  lines.push(`        (ch >= 'A' && ch <= 'Z') ||`);
  lines.push(`        (ch >= 'a' && ch <= 'z') ||`);
  lines.push(`        (ch >= '0' && ch <= '9') ||`);
  lines.push(`        ch == '-' || ch == '.' || ch == '_' || ch == '~';`);
  lines.push(`    if (is_unreserved) {`);
  lines.push(`      encoded.push_back(static_cast<char>(ch));`);
  lines.push(`      continue;`);
  lines.push(`    }`);
  lines.push(`    encoded.push_back('%');`);
  lines.push(`    encoded.push_back(HEX[(ch >> 4) & 0x0F]);`);
  lines.push(`    encoded.push_back(HEX[ch & 0x0F]);`);
  lines.push(`  }`);
  lines.push(`  return encoded;`);
  lines.push(`}`);
  lines.push(`} // namespace`);

  for (const m of methods) {
    const name = toSnakeCase(m.operationId);
    const path = m.path; // C++ SDK does NOT strip /api/
    const cppParams = cppBuildImplParams(m);
    const cppPath = cppBuildPath(m, path);

    lines.push(``);

    if (m.isHead) {
      lines.push(`bool ${className}::${name}(${cppParams}) const {`);
      lines.push(`  return http_.head(${cppPath});`);
    } else {
      const verb = httpVerb(m.method);
      // C++ uses `del` instead of `delete` (reserved keyword)
      const cppVerb = verb === 'delete' ? 'del' : verb;
      lines.push(`Result ${className}::${name}(${cppParams}) const {`);
      if (m.hasBody && m.hasQuery) {
        lines.push(`  return http_.post_with_query(${cppPath}, json_body, query);`);
      } else if (m.hasBody) {
        lines.push(`  return http_.${cppVerb}(${cppPath}, json_body);`);
      } else if (m.hasQuery) {
        lines.push(`  return http_.get(${cppPath}, query);`);
      } else if (verb === 'post' || verb === 'patch') {
        lines.push(`  return http_.${verb}(${cppPath}, "{}");`);
      } else if (verb === 'delete') {
        lines.push(`  return http_.del(${cppPath});`);
      } else {
        lines.push(`  return http_.get(${cppPath});`);
      }
    }
    lines.push(`}`);
  }

  lines.push(``);
  lines.push(`} // namespace client`);
  lines.push(``);
  return lines.join('\n');
}

function cppBuildHeaderParams(m: MethodDef): string {
  const args: string[] = [];
  for (const param of m.params) {
    args.push(`const std::string& ${cppParam(toSnakeCase(param))}`);
  }
  if (m.hasBody) args.push('const std::string& json_body');
  if (m.hasQuery) args.push('const std::map<std::string, std::string>& query = {}');
  return args.join(', ');
}

function cppBuildImplParams(m: MethodDef): string {
  // Implementation must NOT repeat default arguments (C++ rule)
  const args: string[] = [];
  for (const param of m.params) {
    args.push(`const std::string& ${cppParam(toSnakeCase(param))}`);
  }
  if (m.hasBody) args.push('const std::string& json_body');
  if (m.hasQuery) args.push('const std::map<std::string, std::string>& query');
  return args.join(', ');
}

function cppBuildPath(m: MethodDef, basePath: string): string {
  if (m.params.length === 0) return `"${basePath}"`;
  // Use string concatenation
  let parts: string[] = [];
  let remaining = basePath;
  for (const param of m.params) {
    const idx = remaining.indexOf(`{${param}}`);
    const before = remaining.substring(0, idx);
    if (before) parts.push(`"${before}"`);
    parts.push(`edgebase_encode_path_param(${cppParam(toSnakeCase(param))})`);
    remaining = remaining.substring(idx + param.length + 2);
  }
  if (remaining) parts.push(`"${remaining}"`);
  return parts.join(' + ');
}

// ─── Generator Dispatch ─────────────────────────────────────────────────────

type GeneratorFn = (tag: string, methods: MethodDef[]) => string;

const generators: Record<string, GeneratorFn> = {
  typescript: generateTypeScript,
  python: generatePython,
  go: generateGoWithFmt,
  rust: generateRust,
  dart: generateDart,
  swift: generateSwift,
  kotlin: generateKotlin,
  java: generateJava,
  php: generatePhp,
  csharp: generateCSharp,
  ruby: generateRuby,
};

// ─── Path Constants Generators ──────────────────────────────────────────────

function generatePathsTypeScript(paths: PathDef[]): string {
  const lines: string[] = [];
  lines.push(`// ─── Path Constants ────────────────────────────────────────────────────────`);
  lines.push(``);
  lines.push(`export class ApiPaths {`);
  for (const p of paths) {
    if (p.params.length === 0) {
      lines.push(`  static readonly ${toScreamingSnake(p.operationId)} = '${p.path}';`);
    } else {
      const args = p.params.map(param => `${param}: string`).join(', ');
      let tmpl = p.path;
      for (const param of p.params) {
        tmpl = tmpl.replace(`{${param}}`, `\${${param}}`);
      }
      lines.push(`  static ${p.operationId}(${args}) { return \`${tmpl}\`; }`);
    }
  }
  lines.push(`}`);
  lines.push(``);
  return '\n' + lines.join('\n');
}

function generatePathsPython(paths: PathDef[]): string {
  const lines: string[] = [];
  lines.push(``);
  lines.push(``);
  lines.push(`class ApiPaths:`);
  lines.push(`    """Auto-generated path constants — DO NOT EDIT."""`);
  lines.push(``);
  for (const p of paths) {
    if (p.params.length === 0) {
      lines.push(`    ${toScreamingSnake(p.operationId)} = "${p.path}"`);
    }
  }
  // Parametrized paths as static methods
  for (const p of paths) {
    if (p.params.length > 0) {
      const pyParams = p.params.map(param => `${toSnakeCase(param)}: str`).join(', ');
      let fstr = p.path;
      for (const param of p.params) {
        fstr = fstr.replace(`{${param}}`, `{${toSnakeCase(param)}}`);
      }
      lines.push(``);
      lines.push(`    @staticmethod`);
      lines.push(`    def ${toSnakeCase(p.operationId)}(${pyParams}) -> str:`);
      lines.push(`        return f"${fstr}"`);
    }
  }
  lines.push(``);
  return lines.join('\n');
}

function generatePathsRuby(paths: PathDef[]): string {
  const lines: string[] = [];
  lines.push(``);
  lines.push(``);
  lines.push(`  # Auto-generated path constants — DO NOT EDIT.`);
  lines.push(`  module ApiPaths`);
  for (const p of paths) {
    if (p.params.length === 0) {
      lines.push(`    ${toScreamingSnake(p.operationId)} = "${p.path}"`);
    }
  }
  // Parametrized paths as module methods
  for (const p of paths) {
    if (p.params.length > 0) {
      const rubyParams = p.params.map(param => `${toSnakeCase(param)}`).join(', ');
      let fstr = p.path;
      for (const param of p.params) {
        fstr = fstr.replace(`{${param}}`, `#{${toSnakeCase(param)}}`);
      }
      lines.push(``);
      lines.push(`    def self.${toSnakeCase(p.operationId)}(${rubyParams})`);
      lines.push(`      "${fstr}"`);
      lines.push(`    end`);
    }
  }
  lines.push(`  end`);
  lines.push(``);
  return lines.join('\n');
}

function generatePathsGo(paths: PathDef[]): string {
  const lines: string[] = [];
  lines.push(``);
  lines.push(`// ─── Path Constants ────────────────────────────────────────────────────────`);
  lines.push(``);
  const statics = paths.filter(p => p.params.length === 0);
  if (statics.length > 0) {
    lines.push(`const (`);
    for (const p of statics) {
      lines.push(`\tPath${toPascalCase(p.operationId)} = "${p.path}"`);
    }
    lines.push(`)`);
  }
  for (const p of paths) {
    if (p.params.length > 0) {
      const goParams = p.params.map(param => `${goParam(param)} string`).join(', ');
      // Build path using concatenation
      let parts: string[] = [];
      let remaining = p.path;
      for (const param of p.params) {
        const placeholder = `{${param}}`;
        const idx = remaining.indexOf(placeholder);
        const before = remaining.substring(0, idx);
        if (before) parts.push(`"${before}"`);
        parts.push(goParam(param));
        remaining = remaining.substring(idx + placeholder.length);
      }
      if (remaining) parts.push(`"${remaining}"`);
      lines.push(``);
      lines.push(`// Path${toPascalCase(p.operationId)} builds the path for ${p.path}.`);
      lines.push(`func Path${toPascalCase(p.operationId)}(${goParams}) string {`);
      lines.push(`\treturn ${parts.join(' + ')}`);
      lines.push(`}`);
    }
  }
  lines.push(``);
  return lines.join('\n');
}

function generatePathsRust(paths: PathDef[]): string {
  const lines: string[] = [];
  lines.push(``);
  lines.push(`// ─── Path Constants ────────────────────────────────────────────────────────`);
  lines.push(``);
  lines.push(`pub struct ApiPaths;`);
  lines.push(``);
  lines.push(`impl ApiPaths {`);
  for (const p of paths) {
    if (p.params.length === 0) {
      lines.push(`    pub const ${toScreamingSnake(p.operationId)}: &'static str = "${p.path}";`);
    } else {
      const rustParams = p.params.map(param => `${rustParam(param)}: &str`).join(', ');
      let fmtStr = p.path;
      const fmtArgs: string[] = [];
      for (const param of p.params) {
        fmtStr = fmtStr.replace(`{${param}}`, '{}');
        fmtArgs.push(rustParam(param));
      }
      lines.push(`    pub fn ${toSnakeCase(p.operationId)}(${rustParams}) -> String {`);
      lines.push(`        format!("${fmtStr}", ${fmtArgs.join(', ')})`);
      lines.push(`    }`);
    }
  }
  lines.push(`}`);
  lines.push(``);
  return lines.join('\n');
}

function generatePathsDart(paths: PathDef[]): string {
  const lines: string[] = [];
  lines.push(``);
  lines.push(`// ─── Path Constants ────────────────────────────────────────────────────────`);
  lines.push(``);
  lines.push(`class ApiPaths {`);
  lines.push(`  ApiPaths._();`);
  lines.push(``);
  for (const p of paths) {
    if (p.params.length === 0) {
      lines.push(`  static const ${toScreamingSnake(p.operationId)} = '${p.path}';`);
    } else {
      const dartParams = p.params.map(param => `String ${param}`).join(', ');
      let tmpl = p.path;
      for (const param of p.params) {
        tmpl = tmpl.replace(`{${param}}`, `\$${param}`);
      }
      lines.push(`  static String ${p.operationId}(${dartParams}) => '${tmpl}';`);
    }
  }
  lines.push(`}`);
  lines.push(``);
  return lines.join('\n');
}

function generatePathsSwift(paths: PathDef[]): string {
  const lines: string[] = [];
  lines.push(``);
  lines.push(`// ─── Path Constants ────────────────────────────────────────────────────────`);
  lines.push(``);
  lines.push(`public enum ApiPaths {`);
  for (const p of paths) {
    if (p.params.length === 0) {
      lines.push(`    public static let ${toScreamingSnake(p.operationId)} = "${p.path}"`);
    } else {
      const swiftParams = p.params.map(param => `_ ${param}: String`).join(', ');
      let tmpl = p.path;
      for (const param of p.params) {
        tmpl = tmpl.replace(`{${param}}`, `\\(${param})`);
      }
      lines.push(`    public static func ${p.operationId}(${swiftParams}) -> String { "${tmpl}" }`);
    }
  }
  lines.push(`}`);
  lines.push(``);
  return lines.join('\n');
}

function generatePathsKotlin(paths: PathDef[]): string {
  const lines: string[] = [];
  lines.push(``);
  lines.push(`/**`);
  lines.push(` * Auto-generated path constants.`);
  lines.push(` */`);
  lines.push(`object ApiPaths {`);
  for (const p of paths) {
    if (p.params.length === 0) {
      lines.push(`    const val ${toScreamingSnake(p.operationId)} = "${p.path}"`);
    } else {
      const ktParams = p.params.map(param => `${param}: String`).join(', ');
      let tmpl = p.path;
      for (const param of p.params) {
        tmpl = tmpl.replace(`{${param}}`, `\$${param}`);
      }
      lines.push(`    fun ${p.operationId}(${ktParams}) = "${tmpl}"`);
    }
  }
  lines.push(`}`);
  lines.push(``);
  return lines.join('\n');
}

function generatePathsJava(paths: PathDef[]): string {
  const lines: string[] = [];
  lines.push(``);
  lines.push(`    /**`);
  lines.push(`     * Auto-generated path constants.`);
  lines.push(`     */`);
  lines.push(`    public static final class ApiPaths {`);
  lines.push(`        private ApiPaths() {}`);
  lines.push(``);
  for (const p of paths) {
    if (p.params.length === 0) {
      lines.push(`        public static final String ${toScreamingSnake(p.operationId)} = "${p.path}";`);
    } else {
      const javaParams = p.params.map(param => `String ${param}`).join(', ');
      // Build path using concatenation
      let parts: string[] = [];
      let remaining = p.path;
      for (const param of p.params) {
        const placeholder = `{${param}}`;
        const idx = remaining.indexOf(placeholder);
        const before = remaining.substring(0, idx);
        if (before) parts.push(`"${before}"`);
        parts.push(param);
        remaining = remaining.substring(idx + placeholder.length);
      }
      if (remaining) parts.push(`"${remaining}"`);
      let expr = parts.join(' + ');
      lines.push(`        public static String ${p.operationId}(${javaParams}) {`);
      lines.push(`            return ${expr};`);
      lines.push(`        }`);
    }
  }
  lines.push(`    }`);
  return lines.join('\n');
}

function generatePathsPhp(paths: PathDef[]): string {
  const lines: string[] = [];
  lines.push(``);
  lines.push(`/**`);
  lines.push(` * Auto-generated path constants.`);
  lines.push(` */`);
  lines.push(`final class ApiPaths`);
  lines.push(`{`);
  for (const p of paths) {
    if (p.params.length === 0) {
      lines.push(`    public const ${toScreamingSnake(p.operationId)} = '${p.path}';`);
    } else {
      const phpParams = p.params.map(param => `string $${toSnakeCase(param)}`).join(', ');
      let tmpl = p.path;
      for (const param of p.params) {
        tmpl = tmpl.replace(`{${param}}`, `{$${toSnakeCase(param)}}`);
      }
      lines.push(``);
      lines.push(`    public static function ${toSnakeCase(p.operationId)}(${phpParams}): string`);
      lines.push(`    {`);
      lines.push(`        return "${tmpl}";`);
      lines.push(`    }`);
    }
  }
  lines.push(`}`);
  lines.push(``);
  return lines.join('\n');
}

function generatePathsCSharp(paths: PathDef[]): string {
  const lines: string[] = [];
  lines.push(``);
  lines.push(`/// <summary>`);
  lines.push(`/// Auto-generated path constants.`);
  lines.push(`/// </summary>`);
  lines.push(`public static class ApiPaths`);
  lines.push(`{`);
  for (const p of paths) {
    if (p.params.length === 0) {
      lines.push(`    public const string ${toScreamingSnake(p.operationId)} = "${p.path}";`);
    } else {
      const csParams = p.params.map(param => `string ${csParam(param)}`).join(', ');
      let tmpl = p.path;
      for (const param of p.params) {
        tmpl = tmpl.replace(`{${param}}`, `{${csParam(param)}}`);
      }
      lines.push(`    public static string ${toPascalCase(p.operationId)}(${csParams}) => $"${tmpl}";`);
    }
  }
  lines.push(`}`);
  return lines.join('\n');
}

function generatePathsCppHeader(paths: PathDef[]): string {
  const lines: string[] = [];
  lines.push(``);
  lines.push(`/// Auto-generated path constants.`);
  lines.push(`namespace ApiPaths {`);
  for (const p of paths) {
    if (p.params.length === 0) {
      lines.push(`  constexpr const char* ${toScreamingSnake(p.operationId)} = "${p.path}";`);
    } else {
      const cppParams = p.params.map(param => `const std::string& ${cppParam(toSnakeCase(param))}`).join(', ');
      let parts: string[] = [];
      let remaining = p.path;
      for (const param of p.params) {
        const placeholder = `{${param}}`;
        const idx = remaining.indexOf(placeholder);
        const before = remaining.substring(0, idx);
        if (before) parts.push(`"${before}"`);
        parts.push(cppParam(toSnakeCase(param)));
        remaining = remaining.substring(idx + placeholder.length);
      }
      if (remaining) parts.push(`"${remaining}"`);
      lines.push(`  inline std::string ${toSnakeCase(p.operationId)}(${cppParams}) {`);
      lines.push(`    return ${parts.join(' + ')};`);
      lines.push(`  }`);
    }
  }
  lines.push(`} // namespace ApiPaths`);
  return lines.join('\n');
}

/** Append/insert ApiPaths block into generated core content */
function appendPathsBlock(lang: string, content: string, paths: PathDef[]): string {
  switch (lang) {
    case 'typescript':
      return content + generatePathsTypeScript(paths);
    case 'python':
      return content + generatePathsPython(paths);
    case 'ruby': {
      // Insert ApiPaths module before the closing `end` of the outer module
      const idx = content.lastIndexOf('\nend\n');
      return content.substring(0, idx) + '\n' + generatePathsRuby(paths) + '\nend\n';
    }
    case 'go':
      return content + generatePathsGo(paths);
    case 'rust':
      return content + generatePathsRust(paths);
    case 'dart':
      return content + generatePathsDart(paths);
    case 'swift':
      return content + generatePathsSwift(paths);
    case 'kotlin':
      return content + generatePathsKotlin(paths);
    case 'java': {
      // Insert nested class before final } of the main class
      const idx = content.lastIndexOf('\n}\n');
      return content.substring(0, idx) + '\n' + generatePathsJava(paths) + '\n}\n';
    }
    case 'php':
      return content + generatePathsPhp(paths);
    case 'csharp': {
      // Insert inside namespace, after GeneratedDbApi class closing }
      // Content ends with: ...}\n\n}\n (class-close, blank, namespace-close)
      const lastNs = content.lastIndexOf('\n}\n');
      return content.substring(0, lastNs) + '\n' + generatePathsCSharp(paths) + '\n\n}\n';
    }
    default:
      return content;
  }
}

/** Insert ApiPaths namespace into C++ header (inside client namespace) */
function insertCppPaths(content: string, paths: PathDef[]): string {
  return content.replace('} // namespace client', generatePathsCppHeader(paths) + '\n\n} // namespace client');
}

// ─── Client Wrapper Types ────────────────────────────────────────────────────

interface WrapperMethodConfig {
  op: string;
  name: string;
}

interface WrapperGroupConfig {
  doc: string;
  methods: WrapperMethodConfig[];
}

interface WrapperConfigFile {
  description: string;
  groups: Record<string, WrapperGroupConfig>;
}

interface ResolvedWrapperMethod {
  wrapperName: string;
  coreName: string;
  method: MethodDef;
}

interface ResolvedWrapperGroup {
  groupName: string;
  doc: string;
  methods: ResolvedWrapperMethod[];
}

// Load wrapper config
const wrapperConfig: WrapperConfigFile = JSON.parse(
  readFileSync(resolve(__dirname, 'wrapper-config.json'), 'utf-8'),
);

/** Resolve wrapper config against extracted spec methods */
function resolveWrappers(methodsByTag: Map<string, MethodDef[]>): ResolvedWrapperGroup[] {
  const methodMap = new Map<string, MethodDef>();
  for (const methods of methodsByTag.values()) {
    for (const m of methods) {
      methodMap.set(m.operationId, m);
    }
  }

  const groups: ResolvedWrapperGroup[] = [];
  for (const [groupName, groupConfig] of Object.entries(wrapperConfig.groups)) {
    const methods: ResolvedWrapperMethod[] = [];
    for (const wm of groupConfig.methods) {
      const method = methodMap.get(wm.op);
      if (method) {
        methods.push({ wrapperName: wm.name, coreName: wm.op, method });
      } else {
        console.warn(`  ⚠️  Wrapper '${wm.name}' → operationId '${wm.op}' not found in spec`);
      }
    }
    if (methods.length > 0) {
      groups.push({ groupName, doc: groupConfig.doc, methods });
    }
  }
  return groups;
}

// ─── Wrapper Generators ─────────────────────────────────────────────────────

/** Helper: build call arguments list (variable names only, no types) */
function wrapperCallArgs(m: MethodDef, transform: (s: string) => string = s => s, bodyName = 'body', queryName = 'query'): string[] {
  const args: string[] = m.params.map(transform);
  if (m.hasBody) args.push(bodyName);
  if (m.hasQuery) args.push(queryName);
  return args;
}

function generateWrappersTS(groups: ResolvedWrapperGroup[]): string {
  const lines: string[] = [];
  lines.push(`/**`);
  lines.push(` * Auto-generated client wrapper methods — DO NOT EDIT.`);
  lines.push(` * Regenerate: npx tsx tools/sdk-codegen/generate.ts`);
  lines.push(` * Source: wrapper-config.json + openapi.json (${spec.info.version})`);
  lines.push(` *`);
  lines.push(` * These classes provide user-friendly method names that delegate`);
  lines.push(` * to GeneratedDbApi core methods. Extend or compose in hand-written`);
  lines.push(` * client code to add side effects (token management, etc.).`);
  lines.push(` */`);
  lines.push(``);
  lines.push(`import type { GeneratedDbApi } from './api-core.js';`);
  lines.push(``);

  for (const group of groups) {
    const className = `Generated${toPascalCase(group.groupName)}Methods`;
    lines.push(`/** ${group.doc} */`);
    lines.push(`export class ${className} {`);
    lines.push(`  constructor(protected core: GeneratedDbApi) {}`);
    lines.push(``);

    for (const wm of group.methods) {
      const m = wm.method;
      const args = tsBuildArgs(m);
      const callArgs = wrapperCallArgs(m);
      const returnType = m.isHead ? 'Promise<boolean>' : 'Promise<unknown>';

      lines.push(`  /** ${m.summary} */`);
      lines.push(`  async ${wm.wrapperName}(${args}): ${returnType} {`);
      lines.push(`    return this.core.${wm.coreName}(${callArgs.join(', ')});`);
      lines.push(`  }`);
      lines.push(``);
    }

    lines.push(`}`);
    lines.push(``);
  }

  return lines.join('\n');
}

function generateWrappersPython(groups: ResolvedWrapperGroup[]): string {
  const lines: string[] = [];
  lines.push(`"""Auto-generated client wrapper methods — DO NOT EDIT.`);
  lines.push(``);
  lines.push(`Regenerate: npx tsx tools/sdk-codegen/generate.ts`);
  lines.push(`Source: wrapper-config.json + openapi.json (${spec.info.version})`);
  lines.push(`"""`);
  lines.push(``);
  lines.push(`from __future__ import annotations`);
  lines.push(``);
  lines.push(`from typing import TYPE_CHECKING, Any`);
  lines.push(``);
  lines.push(`if TYPE_CHECKING:`);
  lines.push(`    from edgebase_core.generated.api_core import GeneratedDbApi`);
  lines.push(``);
  lines.push(``);

  for (const group of groups) {
    const className = `Generated${toPascalCase(group.groupName)}Methods`;
    lines.push(`class ${className}:`);
    lines.push(`    """${group.doc}"""`);
    lines.push(``);
    lines.push(`    def __init__(self, core: GeneratedDbApi) -> None:`);
    lines.push(`        self._core = core`);

    for (const wm of group.methods) {
      const m = wm.method;
      const name = toSnakeCase(wm.wrapperName);
      const coreName = toSnakeCase(wm.coreName);
      const params = ['self'];
      const callArgs: string[] = [];
      for (const p of m.params) { const sn = toSnakeCase(p); params.push(`${sn}: str`); callArgs.push(sn); }
      if (m.hasBody) { params.push('body: Any = None'); callArgs.push('body'); }
      if (m.hasQuery) { params.push('query: dict[str, str] | None = None'); callArgs.push('query'); }
      const returnType = m.isHead ? 'bool' : 'Any';

      lines.push(``);
      lines.push(`    def ${name}(${params.join(', ')}) -> ${returnType}:`);
      lines.push(`        """${m.summary}"""`);
      lines.push(`        return self._core.${coreName}(${callArgs.join(', ')})`);
    }

    lines.push(``);
    lines.push(``);
  }

  return lines.join('\n');
}

function generateWrappersRuby(groups: ResolvedWrapperGroup[]): string {
  const lines: string[] = [];
  lines.push(`# frozen_string_literal: true`);
  lines.push(``);
  lines.push(`# Auto-generated client wrapper methods — DO NOT EDIT.`);
  lines.push(`#`);
  lines.push(`# Regenerate: npx tsx tools/sdk-codegen/generate.ts`);
  lines.push(`# Source: wrapper-config.json + openapi.json (${spec.info.version})`);
  lines.push(``);
  lines.push(`module EdgebaseCore`);

  for (const group of groups) {
    const className = `Generated${toPascalCase(group.groupName)}Methods`;
    lines.push(`  class ${className}`);
    lines.push(`    # ${group.doc}`);
    lines.push(``);
    lines.push(`    def initialize(core)`);
    lines.push(`      @core = core`);
    lines.push(`    end`);

    for (const wm of group.methods) {
      const m = wm.method;
      const name = toSnakeCase(wm.wrapperName);
      const coreName = toSnakeCase(wm.coreName);
      const params: string[] = [];
      const callArgs: string[] = [];
      for (const p of m.params) { const sn = toSnakeCase(p); params.push(sn); callArgs.push(sn); }
      if (m.hasBody) { params.push('body = nil'); callArgs.push('body'); }
      if (m.hasQuery) { params.push('query: nil'); callArgs.push('query: query'); }

      lines.push(``);
      lines.push(`    # ${m.summary}`);
      lines.push(`    def ${name}(${params.join(', ')})`);
      lines.push(`      @core.${coreName}(${callArgs.join(', ')})`);
      lines.push(`    end`);
    }

    lines.push(`  end`);
    lines.push(``);
  }

  lines.push(`end`);
  lines.push(``);
  return lines.join('\n');
}

function generateWrappersGo(groups: ResolvedWrapperGroup[]): string {
  const lines: string[] = [];
  lines.push(`// Auto-generated client wrapper methods — DO NOT EDIT.`);
  lines.push(`// Regenerate: npx tsx tools/sdk-codegen/generate.ts`);
  lines.push(`// Source: wrapper-config.json + openapi.json (${spec.info.version})`);
  lines.push(``);
  lines.push(`package edgebase`);
  lines.push(``);
  lines.push(`import "context"`);
  lines.push(``);

  for (const group of groups) {
    const structName = `Generated${toPascalCase(group.groupName)}Methods`;
    lines.push(`// ${structName} — ${group.doc}`);
    lines.push(`type ${structName} struct {`);
    lines.push(`\tCore *GeneratedDbApi`);
    lines.push(`}`);
    lines.push(``);

    for (const wm of group.methods) {
      const m = wm.method;
      const goName = toPascalCase(wm.wrapperName);
      const coreName = toPascalCase(wm.coreName);
      const params = ['ctx context.Context'];
      const callArgs = ['ctx'];
      for (const p of m.params) { params.push(`${p} string`); callArgs.push(p); }
      if (m.hasBody) { params.push('body interface{}'); callArgs.push('body'); }
      if (m.hasQuery) { params.push('query map[string]string'); callArgs.push('query'); }

      lines.push(`// ${goName} — ${m.summary}`);
      if (m.isHead) {
        lines.push(`func (w *${structName}) ${goName}(${params.join(', ')}) (bool, error) {`);
      } else {
        lines.push(`func (w *${structName}) ${goName}(${params.join(', ')}) (map[string]interface{}, error) {`);
      }
      lines.push(`\treturn w.Core.${coreName}(${callArgs.join(', ')})`);
      lines.push(`}`);
      lines.push(``);
    }
  }

  return lines.join('\n');
}

function generateWrappersRust(groups: ResolvedWrapperGroup[]): string {
  const lines: string[] = [];
  lines.push(`//! Auto-generated client wrapper methods — DO NOT EDIT.`);
  lines.push(`//! Regenerate: npx tsx tools/sdk-codegen/generate.ts`);
  lines.push(`//! Source: wrapper-config.json + openapi.json (${spec.info.version})`);
  lines.push(``);
  lines.push(`use crate::Error;`);
  lines.push(`use crate::generated::api_core::GeneratedDbApi;`);
  lines.push(`use serde_json::Value;`);
  lines.push(``);

  for (const group of groups) {
    const structName = `Generated${toPascalCase(group.groupName)}Methods`;
    lines.push(`/// ${group.doc}`);
    lines.push(`pub struct ${structName}<'a> {`);
    lines.push(`    core: &'a GeneratedDbApi<'a>,`);
    lines.push(`}`);
    lines.push(``);
    lines.push(`impl<'a> ${structName}<'a> {`);
    lines.push(`    pub fn new(core: &'a GeneratedDbApi<'a>) -> Self {`);
    lines.push(`        Self { core }`);
    lines.push(`    }`);

    for (const wm of group.methods) {
      const m = wm.method;
      const name = toSnakeCase(wm.wrapperName);
      const coreName = toSnakeCase(wm.coreName);
      const params = ['&self'];
      const callArgs: string[] = [];
      for (const p of m.params) { const sn = toSnakeCase(p); params.push(`${sn}: &str`); callArgs.push(sn); }
      if (m.hasBody) { params.push('body: &Value'); callArgs.push('body'); }
      if (m.hasQuery) { params.push('query: &std::collections::HashMap<String, String>'); callArgs.push('query'); }

      lines.push(``);
      lines.push(`    /// ${m.summary}`);
      if (m.isHead) {
        lines.push(`    pub async fn ${name}(${params.join(', ')}) -> Result<bool, Error> {`);
      } else {
        lines.push(`    pub async fn ${name}(${params.join(', ')}) -> Result<Value, Error> {`);
      }
      lines.push(`        self.core.${coreName}(${callArgs.join(', ')}).await`);
      lines.push(`    }`);
    }

    lines.push(`}`);
    lines.push(``);
  }

  return lines.join('\n');
}

function generateWrappersDart(groups: ResolvedWrapperGroup[]): string {
  const lines: string[] = [];
  lines.push(`// Auto-generated client wrapper methods — DO NOT EDIT.`);
  lines.push(`// Regenerate: npx tsx tools/sdk-codegen/generate.ts`);
  lines.push(`// Source: wrapper-config.json + openapi.json (${spec.info.version})`);
  lines.push(``);
  lines.push(`import 'api_core.dart';`);
  lines.push(``);

  for (const group of groups) {
    const className = `Generated${toPascalCase(group.groupName)}Methods`;
    lines.push(`/// ${group.doc}`);
    lines.push(`class ${className} {`);
    lines.push(`  final GeneratedDbApi _core;`);
    lines.push(``);
    lines.push(`  ${className}(this._core);`);

    for (const wm of group.methods) {
      const m = wm.method;
      const params: string[] = [];
      const callArgs: string[] = [];
      for (const p of m.params) { params.push(`String ${p}`); callArgs.push(p); }
      if (m.hasBody) { params.push('Object? body'); callArgs.push('body'); }
      if (m.hasQuery) { params.push('Map<String, String>? query'); callArgs.push('query'); }

      lines.push(``);
      lines.push(`  /// ${m.summary}`);
      if (m.isHead) {
        lines.push(`  Future<bool> ${wm.wrapperName}(${params.join(', ')}) async {`);
      } else {
        lines.push(`  Future<dynamic> ${wm.wrapperName}(${params.join(', ')}) async {`);
      }
      lines.push(`    return _core.${wm.coreName}(${callArgs.join(', ')});`);
      lines.push(`  }`);
    }

    lines.push(`}`);
    lines.push(``);
  }

  return lines.join('\n');
}

function generateWrappersSwift(groups: ResolvedWrapperGroup[]): string {
  const lines: string[] = [];
  lines.push(`// Auto-generated client wrapper methods — DO NOT EDIT.`);
  lines.push(`// Regenerate: npx tsx tools/sdk-codegen/generate.ts`);
  lines.push(`// Source: wrapper-config.json + openapi.json (${spec.info.version})`);
  lines.push(``);
  lines.push(`import Foundation`);
  lines.push(``);

  for (const group of groups) {
    const structName = `Generated${toPascalCase(group.groupName)}Methods`;
    lines.push(`/// ${group.doc}`);
    lines.push(`public struct ${structName} {`);
    lines.push(`    public let core: GeneratedDbApi`);
    lines.push(``);
    lines.push(`    public init(core: GeneratedDbApi) {`);
    lines.push(`        self.core = core`);
    lines.push(`    }`);

    for (const wm of group.methods) {
      const m = wm.method;
      const params: string[] = [];
      const callArgs: string[] = [];
      for (const p of m.params) { params.push(`_ ${p}: String`); callArgs.push(p); }
      if (m.hasBody) { params.push('_ body: [String: Any]'); callArgs.push('body'); }
      if (m.hasQuery) { params.push('query: [String: String]? = nil'); callArgs.push('query: query'); }

      lines.push(``);
      lines.push(`    /// ${m.summary}`);
      if (m.isHead) {
        lines.push(`    public func ${wm.wrapperName}(${params.join(', ')}) async -> Bool {`);
      } else {
        lines.push(`    public func ${wm.wrapperName}(${params.join(', ')}) async throws -> Any {`);
      }
      if (m.isHead) {
        lines.push(`        return await core.${wm.coreName}(${callArgs.join(', ')})`);
      } else {
        lines.push(`        return try await core.${wm.coreName}(${callArgs.join(', ')})`);
      }
      lines.push(`    }`);
    }

    lines.push(`}`);
    lines.push(``);
  }

  return lines.join('\n');
}

function generateWrappersKotlin(groups: ResolvedWrapperGroup[]): string {
  const lines: string[] = [];
  lines.push(`// Auto-generated client wrapper methods — DO NOT EDIT.`);
  lines.push(`// Regenerate: npx tsx tools/sdk-codegen/generate.ts`);
  lines.push(`// Source: wrapper-config.json + openapi.json (${spec.info.version})`);
  lines.push(``);
  lines.push(`package dev.edgebase.sdk.core.generated`);
  lines.push(``);

  for (const group of groups) {
    const className = `Generated${toPascalCase(group.groupName)}Methods`;
    lines.push(`/** ${group.doc} */`);
    lines.push(`open class ${className}(protected val core: GeneratedDbApi) {`);

    for (const wm of group.methods) {
      const m = wm.method;
      const params: string[] = [];
      const callArgs: string[] = [];
      for (const p of m.params) { params.push(`${p}: String`); callArgs.push(p); }
      if (m.hasBody) { params.push('body: Map<String, Any?> = emptyMap()'); callArgs.push('body'); }
      if (m.hasQuery) { params.push('query: Map<String, String>? = null'); callArgs.push('query'); }

      lines.push(``);
      lines.push(`    /** ${m.summary} */`);
      if (m.isHead) {
        lines.push(`    open suspend fun ${wm.wrapperName}(${params.join(', ')}): Boolean =`);
      } else {
        lines.push(`    @Suppress("UNCHECKED_CAST")`);
        lines.push(`    open suspend fun ${wm.wrapperName}(${params.join(', ')}): Any? =`);
      }
      lines.push(`        core.${wm.coreName}(${callArgs.join(', ')})`);
    }

    lines.push(`}`);
    lines.push(``);
  }

  return lines.join('\n');
}

function generateWrappersJava(groups: ResolvedWrapperGroup[]): string {
  const lines: string[] = [];
  lines.push(`// Auto-generated client wrapper methods — DO NOT EDIT.`);
  lines.push(`// Regenerate: npx tsx tools/sdk-codegen/generate.ts`);
  lines.push(`// Source: wrapper-config.json + openapi.json (${spec.info.version})`);
  lines.push(``);
  lines.push(`package dev.edgebase.sdk.core.generated;`);
  lines.push(``);
  lines.push(`import dev.edgebase.sdk.core.EdgeBaseError;`);
  lines.push(``);
  lines.push(`import java.util.Map;`);
  lines.push(``);
  lines.push(`/**`);
  lines.push(` * Auto-generated client wrapper methods.`);
  lines.push(` */`);
  lines.push(`public class GeneratedClientWrappers {`);
  lines.push(``);

  for (const group of groups) {
    const className = `${toPascalCase(group.groupName)}Methods`;
    lines.push(`    /** ${group.doc} */`);
    lines.push(`    public static class ${className} {`);
    lines.push(`        protected final GeneratedDbApi core;`);
    lines.push(``);
    lines.push(`        public ${className}(GeneratedDbApi core) {`);
    lines.push(`            this.core = core;`);
    lines.push(`        }`);

    for (const wm of group.methods) {
      const m = wm.method;
      const params: string[] = [];
      const callArgs: string[] = [];
      for (const p of m.params) { params.push(`String ${p}`); callArgs.push(p); }
      if (m.hasBody) { params.push('Map<String, ?> body'); callArgs.push('body'); }
      if (m.hasQuery) { params.push('Map<String, String> query'); callArgs.push('query'); }

      lines.push(``);
      lines.push(`        /** ${m.summary} */`);
      if (m.isHead) {
        lines.push(`        public boolean ${wm.wrapperName}(${params.join(', ')}) throws EdgeBaseError {`);
      } else {
        lines.push(`        public Object ${wm.wrapperName}(${params.join(', ')}) throws EdgeBaseError {`);
      }
      lines.push(`            return core.${wm.coreName}(${callArgs.join(', ')});`);
      lines.push(`        }`);
    }

    lines.push(`    }`);
    lines.push(``);
  }

  lines.push(`}`);
  lines.push(``);
  return lines.join('\n');
}

function generateWrappersPhp(groups: ResolvedWrapperGroup[]): string {
  const lines: string[] = [];
  lines.push(`<?php`);
  lines.push(``);
  lines.push(`// Auto-generated client wrapper methods — DO NOT EDIT.`);
  lines.push(`// Regenerate: npx tsx tools/sdk-codegen/generate.ts`);
  lines.push(`// Source: wrapper-config.json + openapi.json (${spec.info.version})`);
  lines.push(``);
  lines.push(`declare(strict_types=1);`);
  lines.push(``);
  lines.push(`namespace EdgeBase\\Core\\Generated;`);
  lines.push(``);

  for (const group of groups) {
    const className = `Generated${toPascalCase(group.groupName)}Methods`;
    lines.push(`/** ${group.doc} */`);
    lines.push(`class ${className}`);
    lines.push(`{`);
    lines.push(`    protected GeneratedDbApi $core;`);
    lines.push(``);
    lines.push(`    public function __construct(GeneratedDbApi $core)`);
    lines.push(`    {`);
    lines.push(`        $this->core = $core;`);
    lines.push(`    }`);

    for (const wm of group.methods) {
      const m = wm.method;
      const phpName = toSnakeCase(wm.wrapperName);
      const coreName = toSnakeCase(wm.coreName);
      const params: string[] = [];
      const callArgs: string[] = [];
      for (const p of m.params) { const sn = toSnakeCase(p); params.push(`string $${sn}`); callArgs.push(`$${sn}`); }
      if (m.hasBody) { params.push('mixed $body = null'); callArgs.push('$body'); }
      if (m.hasQuery) { params.push('array $query = []'); callArgs.push('$query'); }
      const returnType = m.isHead ? 'bool' : 'mixed';

      lines.push(``);
      lines.push(`    /** ${m.summary} */`);
      lines.push(`    public function ${phpName}(${params.join(', ')}): ${returnType}`);
      lines.push(`    {`);
      lines.push(`        return $this->core->${coreName}(${callArgs.join(', ')});`);
      lines.push(`    }`);
    }

    lines.push(`}`);
    lines.push(``);
  }

  return lines.join('\n');
}

function generateWrappersCSharp(groups: ResolvedWrapperGroup[]): string {
  const lines: string[] = [];
  lines.push(`// Auto-generated client wrapper methods — DO NOT EDIT.`);
  lines.push(`// Regenerate: npx tsx tools/sdk-codegen/generate.ts`);
  lines.push(`// Source: wrapper-config.json + openapi.json (${spec.info.version})`);
  lines.push(``);
  lines.push(`using System.Collections.Generic;`);
  lines.push(`using System.Threading;`);
  lines.push(`using System.Threading.Tasks;`);
  lines.push(``);
  lines.push(`namespace EdgeBase.Generated`);
  lines.push(`{`);
  lines.push(``);

  for (const group of groups) {
    const className = `Generated${toPascalCase(group.groupName)}Methods`;
    lines.push(`/// <summary>`);
    lines.push(`/// ${group.doc}`);
    lines.push(`/// </summary>`);
    lines.push(`public class ${className}`);
    lines.push(`{`);
    lines.push(`    protected readonly GeneratedDbApi _core;`);
    lines.push(``);
    lines.push(`    public ${className}(GeneratedDbApi core)`);
    lines.push(`    {`);
    lines.push(`        _core = core;`);
    lines.push(`    }`);

    for (const wm of group.methods) {
      const m = wm.method;
      const csName = toCSharpName(wm.wrapperName);
      const coreName = toCSharpName(wm.coreName);
      const params: string[] = [];
      const callArgs: string[] = [];
      for (const p of m.params) { params.push(`string ${csParam(p)}`); callArgs.push(csParam(p)); }
      if (m.hasBody) { params.push('object? body = null'); callArgs.push('body'); }
      if (m.hasQuery) { params.push('Dictionary<string, string>? query = null'); callArgs.push('query'); }
      params.push('CancellationToken ct = default');
      callArgs.push('ct');

      lines.push(``);
      lines.push(`    /// <summary>${m.summary}</summary>`);
      if (m.isHead) {
        lines.push(`    public virtual Task<bool> ${csName}(${params.join(', ')})`);
      } else {
        lines.push(`    public virtual Task<Dictionary<string, object?>> ${csName}(${params.join(', ')})`);
      }
      lines.push(`        => _core.${coreName}(${callArgs.join(', ')});`);
    }

    lines.push(`}`);
    lines.push(``);
  }

  lines.push(`}`);
  lines.push(``);
  return lines.join('\n');
}

function generateWrappersCppHeader(groups: ResolvedWrapperGroup[]): string {
  const lines: string[] = [];
  lines.push(`// Auto-generated client wrapper methods — DO NOT EDIT.`);
  lines.push(`// Regenerate: npx tsx tools/sdk-codegen/generate.ts`);
  lines.push(`// Source: wrapper-config.json + openapi.json (${spec.info.version})`);
  lines.push(``);
  lines.push(`#pragma once`);
  lines.push(``);
  lines.push(`#include <string>`);
  lines.push(`#include <map>`);
  lines.push(``);
  lines.push(`namespace client {`);
  lines.push(``);
  lines.push(`struct Result;`);
  lines.push(`class GeneratedDbApi;`);
  lines.push(``);

  for (const group of groups) {
    const className = `Generated${toPascalCase(group.groupName)}Methods`;
    lines.push(`/// ${group.doc}`);
    lines.push(`class ${className} {`);
    lines.push(`public:`);
    lines.push(`  explicit ${className}(GeneratedDbApi& core) : core_(core) {}`);
    lines.push(``);

    for (const wm of group.methods) {
      const m = wm.method;
      const name = toSnakeCase(wm.wrapperName);
      const cppParams = cppBuildHeaderParams(m);

      lines.push(`  /// ${m.summary}`);
      if (m.isHead) {
        lines.push(`  bool ${name}(${cppParams}) const;`);
      } else {
        lines.push(`  Result ${name}(${cppParams}) const;`);
      }
    }

    lines.push(``);
    lines.push(`private:`);
    lines.push(`  GeneratedDbApi& core_;`);
    lines.push(`};`);
    lines.push(``);
  }

  lines.push(`} // namespace client`);
  lines.push(``);
  return lines.join('\n');
}

function generateWrappersCppImpl(groups: ResolvedWrapperGroup[]): string {
  const lines: string[] = [];
  lines.push(`// Auto-generated client wrapper methods — DO NOT EDIT.`);
  lines.push(`// Regenerate: npx tsx tools/sdk-codegen/generate.ts`);
  lines.push(`// Source: wrapper-config.json + openapi.json (${spec.info.version})`);
  lines.push(``);
  lines.push(`#include "edgebase/generated/client_wrappers.h"`);
  lines.push(`#include "edgebase/generated/api_core.h"`);
  lines.push(`#include "edgebase/edgebase.h"`);
  lines.push(``);
  lines.push(`namespace client {`);

  for (const group of groups) {
    const className = `Generated${toPascalCase(group.groupName)}Methods`;

    for (const wm of group.methods) {
      const m = wm.method;
      const name = toSnakeCase(wm.wrapperName);
      const coreName = toSnakeCase(wm.coreName);
      const cppParams = cppBuildImplParams(m);
      const callArgs: string[] = [];
      for (const p of m.params) callArgs.push(cppParam(toSnakeCase(p)));
      if (m.hasBody) callArgs.push('json_body');
      if (m.hasQuery) callArgs.push('query');

      lines.push(``);
      if (m.isHead) {
        lines.push(`bool ${className}::${name}(${cppParams}) const {`);
      } else {
        lines.push(`Result ${className}::${name}(${cppParams}) const {`);
      }
      lines.push(`  return core_.${coreName}(${callArgs.join(', ')});`);
      lines.push(`}`);
    }
  }

  lines.push(``);
  lines.push(`} // namespace client`);
  lines.push(``);
  return lines.join('\n');
}

/** Dispatch table for wrapper generators */
const wrapperGenerators: Record<string, (groups: ResolvedWrapperGroup[]) => string> = {
  typescript: generateWrappersTS,
  python: generateWrappersPython,
  go: generateWrappersGo,
  rust: generateWrappersRust,
  dart: generateWrappersDart,
  swift: generateWrappersSwift,
  kotlin: generateWrappersKotlin,
  java: generateWrappersJava,
  php: generateWrappersPhp,
  csharp: generateWrappersCSharp,
  ruby: generateWrappersRuby,
};

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
  const methodsByTag = extractMethods();
  const allPaths = extractAllPaths();

  if (methodsByTag.size === 0) {
    console.log('No methods found in spec. Convert more routes to createRoute() first.');
    process.exit(0);
  }

  console.log(`📍 ${allPaths.length} unique paths for ApiPaths constants`);

  let totalFiles = 0;

  for (const [lang, langConfig] of Object.entries(config.languages as Record<string, LangConfig>)) {
    console.log(`\n📦 ${lang}`);

    // Special case: C++ has header + impl files
    if (lang === 'cpp') {
      for (const [tag, methods] of methodsByTag) {
        if (tag !== 'core') continue; // C++ is client-only

        // Header
        if (langConfig.core_header) {
          const fullPath = resolve(ROOT, langConfig.core_header);
          mkdirSync(dirname(fullPath), { recursive: true });
          let content = generateCppHeader(tag, methods);
          if (allPaths.length > 0) {
            content = insertCppPaths(content, allPaths);
          }
          writeFileSync(fullPath, content, 'utf-8');
          console.log(`  ✅ ${langConfig.core_header} (${methods.length} methods + ApiPaths)`);
          totalFiles++;
        }

        // Implementation
        if (langConfig.core_impl) {
          const fullPath = resolve(ROOT, langConfig.core_impl);
          mkdirSync(dirname(fullPath), { recursive: true });
          writeFileSync(fullPath, generateCppImpl(tag, methods), 'utf-8');
          console.log(`  ✅ ${langConfig.core_impl} (${methods.length} methods)`);
          totalFiles++;
        }
      }
      continue;
    }

    const generator = generators[lang];
    if (!generator) {
      console.log(`  ⚠️  No generator for '${lang}', skipping.`);
      continue;
    }

    for (const [tag, methods] of methodsByTag) {
      const outputPath = (langConfig as Record<string, string>)[tag];
      if (!outputPath) {
        // Swift has no admin, C++ is client-only
        if (tag === 'admin' && (lang === 'swift')) {
          continue; // Expected — no admin package for Swift
        }
        console.log(`  ⚠️  No output path for tag '${tag}', skipping.`);
        continue;
      }

      const fullPath = resolve(ROOT, outputPath);
      mkdirSync(dirname(fullPath), { recursive: true });

      let content = generator(tag, methods);
      // Append ApiPaths to core files only
      if (tag === 'core' && allPaths.length > 0) {
        content = appendPathsBlock(lang, content, allPaths);
      }
      writeFileSync(fullPath, content, 'utf-8');
      const pathsSuffix = tag === 'core' ? ' + ApiPaths' : '';
      console.log(`  ✅ ${outputPath} (${methods.length} methods${pathsSuffix})`);
      totalFiles++;
    }
  }

  // ─── Wrapper Generation ──────────────────────────────────────────────────
  const wrapperGroups = resolveWrappers(methodsByTag);

  if (wrapperGroups.length > 0) {
    const totalWrapperMethods = wrapperGroups.reduce((sum, g) => sum + g.methods.length, 0);
    console.log(`\n🎯 Client Wrappers: ${wrapperGroups.length} groups, ${totalWrapperMethods} methods`);

    const wrapperPaths = config.wrappers as Record<string, string> | undefined;
    if (wrapperPaths) {
      for (const [lang, outputPath] of Object.entries(wrapperPaths)) {
        // C++ special case: header + impl
        if (lang === 'cpp_header') {
          const fullPath = resolve(ROOT, outputPath);
          mkdirSync(dirname(fullPath), { recursive: true });
          writeFileSync(fullPath, generateWrappersCppHeader(wrapperGroups), 'utf-8');
          console.log(`  ✅ ${outputPath}`);
          totalFiles++;
          continue;
        }
        if (lang === 'cpp_impl') {
          const fullPath = resolve(ROOT, outputPath);
          mkdirSync(dirname(fullPath), { recursive: true });
          writeFileSync(fullPath, generateWrappersCppImpl(wrapperGroups), 'utf-8');
          console.log(`  ✅ ${outputPath}`);
          totalFiles++;
          continue;
        }

        const generator = wrapperGenerators[lang];
        if (!generator) {
          console.log(`  ⚠️  No wrapper generator for '${lang}', skipping.`);
          continue;
        }

        const fullPath = resolve(ROOT, outputPath);
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, generator(wrapperGroups), 'utf-8');
        console.log(`  ✅ ${outputPath}`);
        totalFiles++;
      }
    }
  }

  console.log(`\n✅ Done. Generated ${totalFiles} files for ${Object.keys(config.languages).length} language(s).`);
}

main();
