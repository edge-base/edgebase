import type { EdgeBaseConfig } from '@edge-base/shared';
import { executeD1Sql } from './d1-sql.js';
import { executeDoSql } from './do-sql.js';
import {
  formatDbTargetValidationIssue,
  getD1BindingName,
  resolveDbTarget,
  shouldRouteToD1,
} from './do-router.js';
import {
  ensureLocalDevPostgresSchema,
  getLocalDevPostgresExecOptions,
  getProviderBindingName,
  withPostgresConnection,
} from './postgres-executor.js';
import { ensurePgSchema } from './postgres-schema-init.js';
import type { Env } from '../types.js';

export interface ProviderAwareSqlOptions {
  env?: Env;
  config: EdgeBaseConfig;
  databaseNamespace?: DurableObjectNamespace;
  workerUrl?: string;
  serviceKey?: string;
}

export interface ProviderAwareSqlResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

function inferColumns(rows: Record<string, unknown>[]): string[] {
  return rows.length > 0 ? Object.keys(rows[0] ?? {}) : [];
}

function normalizeRows(payload: {
  rows?: unknown[];
  items?: unknown[];
  results?: unknown[];
}): Record<string, unknown>[] {
  if (Array.isArray(payload.rows)) return payload.rows as Record<string, unknown>[];
  if (Array.isArray(payload.items)) return payload.items as Record<string, unknown>[];
  if (Array.isArray(payload.results)) return payload.results as Record<string, unknown>[];
  return [];
}

function readDollarQuoteToken(query: string, index: number): string | null {
  const match = query.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
  return match?.[0] ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Keep this marker format in sync with @edge-base/core TableRef.sql().
const TABLE_SQL_PARAM_MARKER_PREFIX = '__EDGEBASE_SQL_PARAM_';
const TABLE_SQL_PARAM_MARKER_SUFFIX = '__';
const TABLE_SQL_PARAM_MARKER_RE = new RegExp(
  `${escapeRegExp(TABLE_SQL_PARAM_MARKER_PREFIX)}(\\d+)${escapeRegExp(TABLE_SQL_PARAM_MARKER_SUFFIX)}`,
  'g',
);
const SQL_OPERATOR_CHARS = '+-*/<>=~!@#%^&|`?:';
const PRECEDING_WORDS_THAT_EXPECT_EXPRESSION = new Set([
  'ALL',
  'AND',
  'ANY',
  'ARRAY',
  'AS',
  'BETWEEN',
  'BY',
  'CASE',
  'DISTINCT',
  'ELSE',
  'EXISTS',
  'FILTER',
  'FROM',
  'GROUP',
  'HAVING',
  'ILIKE',
  'IN',
  'INTO',
  'IS',
  'JOIN',
  'LIKE',
  'LIMIT',
  'NOT',
  'OFFSET',
  'ON',
  'OR',
  'ORDER',
  'OVER',
  'PARTITION',
  'RETURNING',
  'SELECT',
  'SET',
  'SIMILAR',
  'THEN',
  'TO',
  'UNION',
  'UPDATE',
  'USING',
  'VALUES',
  'WHEN',
  'WHERE',
]);
const FOLLOWING_WORDS_THAT_DO_NOT_START_EXPRESSION = new Set([
  'AND',
  'AS',
  'BY',
  'ELSE',
  'END',
  'EXCEPT',
  'FETCH',
  'FILTER',
  'FOR',
  'FROM',
  'GROUP',
  'HAVING',
  'INTERSECT',
  'INTO',
  'JOIN',
  'LIMIT',
  'NULLS',
  'OFFSET',
  'ON',
  'OR',
  'ORDER',
  'OVER',
  'PARTITION',
  'RETURNING',
  'THEN',
  'UNION',
  'USING',
  'WHEN',
  'WHERE',
  'WINDOW',
]);

type SqlContextToken =
  | { kind: 'word'; value: string }
  | { kind: 'number' | 'param' | 'operator' }
  | { kind: 'open-paren' | 'close-paren' | 'open-bracket' | 'close-bracket' }
  | { kind: 'comma' | 'semicolon' | 'quote' | 'other' };

function isOperatorChar(char: string): boolean {
  return SQL_OPERATOR_CHARS.includes(char);
}

function isWordChar(char: string): boolean {
  return /[A-Za-z0-9_$]/.test(char);
}

function readPreviousSqlToken(query: string, index: number): SqlContextToken | null {
  let i = index - 1;
  while (i >= 0 && /\s/.test(query[i]!)) i--;
  if (i < 0) return null;

  const char = query[i]!;
  if (char === '(') return { kind: 'open-paren' };
  if (char === ')') return { kind: 'close-paren' };
  if (char === '[') return { kind: 'open-bracket' };
  if (char === ']') return { kind: 'close-bracket' };
  if (char === ',') return { kind: 'comma' };
  if (char === ';') return { kind: 'semicolon' };
  if (char === "'" || char === '"') return { kind: 'quote' };

  if (isOperatorChar(char)) {
    let start = i;
    while (start > 0 && isOperatorChar(query[start - 1]!)) start--;
    return { kind: 'operator' };
  }

  if (isWordChar(char)) {
    let start = i;
    while (start > 0 && isWordChar(query[start - 1]!)) start--;
    const token = query.slice(start, i + 1);
    if (/^\$\d+$/.test(token)) return { kind: 'param' };
    if (/^\d+(?:\.\d+)?$/.test(token)) return { kind: 'number' };
    return { kind: 'word', value: token.toUpperCase() };
  }

  return { kind: 'other' };
}

function readNextSqlToken(query: string, index: number): SqlContextToken | null {
  let i = index + 1;
  while (i < query.length && /\s/.test(query[i]!)) i++;
  if (i >= query.length) return null;

  const char = query[i]!;
  if (char === '(') return { kind: 'open-paren' };
  if (char === ')') return { kind: 'close-paren' };
  if (char === '[') return { kind: 'open-bracket' };
  if (char === ']') return { kind: 'close-bracket' };
  if (char === ',') return { kind: 'comma' };
  if (char === ';') return { kind: 'semicolon' };
  if (char === "'" || char === '"') return { kind: 'quote' };

  if (isOperatorChar(char)) {
    let end = i + 1;
    while (end < query.length && isOperatorChar(query[end]!)) end++;
    return { kind: 'operator' };
  }

  if (isWordChar(char)) {
    let end = i + 1;
    while (end < query.length && isWordChar(query[end]!)) end++;
    const token = query.slice(i, end);
    if (/^\$\d+$/.test(token)) return { kind: 'param' };
    if (/^\d+(?:\.\d+)?$/.test(token)) return { kind: 'number' };
    return { kind: 'word', value: token.toUpperCase() };
  }

  return { kind: 'other' };
}

function canTokenEndExpression(token: SqlContextToken | null): boolean {
  if (!token) return false;
  switch (token.kind) {
    case 'word':
      return !PRECEDING_WORDS_THAT_EXPECT_EXPRESSION.has(token.value);
    case 'number':
    case 'param':
    case 'close-paren':
    case 'close-bracket':
    case 'quote':
      return true;
    default:
      return false;
  }
}

function canTokenStartExpression(token: SqlContextToken | null): boolean {
  if (!token) return false;
  switch (token.kind) {
    case 'word':
      return !FOLLOWING_WORDS_THAT_DO_NOT_START_EXPRESSION.has(token.value);
    case 'number':
    case 'param':
    case 'open-paren':
    case 'open-bracket':
    case 'quote':
      return true;
    default:
      return false;
  }
}

function hasTaggedTemplateSqlMarkers(query: string): boolean {
  return query.includes(TABLE_SQL_PARAM_MARKER_PREFIX);
}

function isIdentifierContinuationChar(char: string | undefined): boolean {
  return !!char && /[A-Za-z0-9_$]/.test(char);
}

function isEscapedPostgresStringStart(query: string, quoteIndex: number): boolean {
  const prefix = query[quoteIndex - 1];
  if (prefix !== 'e' && prefix !== 'E') {
    return false;
  }
  return !isIdentifierContinuationChar(query[quoteIndex - 2]);
}

function unescapeEscapedPostgresQuestionOperators(query: string): string {
  let normalized = '';
  let state:
    | 'code'
    | 'single'
    | 'escaped-single'
    | 'double'
    | 'line-comment'
    | 'block-comment'
    | 'dollar-quote' = 'code';
  let dollarQuoteToken = '';

  for (let i = 0; i < query.length; i++) {
    const char = query[i]!;
    const next = query[i + 1];

    if (state === 'single') {
      normalized += char;
      if (char === "'" && next === "'") {
        normalized += next;
        i++;
        continue;
      }
      if (char === "'") state = 'code';
      continue;
    }

    if (state === 'escaped-single') {
      normalized += char;
      if (char === '\\' && next) {
        normalized += next;
        i++;
        continue;
      }
      if (char === "'" && next === "'") {
        normalized += next;
        i++;
        continue;
      }
      if (char === "'") state = 'code';
      continue;
    }

    if (state === 'double') {
      normalized += char;
      if (char === '"' && next === '"') {
        normalized += next;
        i++;
        continue;
      }
      if (char === '"') state = 'code';
      continue;
    }

    if (state === 'line-comment') {
      normalized += char;
      if (char === '\n') state = 'code';
      continue;
    }

    if (state === 'block-comment') {
      normalized += char;
      if (char === '*' && next === '/') {
        normalized += next;
        i++;
        state = 'code';
      }
      continue;
    }

    if (state === 'dollar-quote') {
      if (query.startsWith(dollarQuoteToken, i)) {
        normalized += dollarQuoteToken;
        i += dollarQuoteToken.length - 1;
        state = 'code';
        continue;
      }
      normalized += char;
      continue;
    }

    if (char === "'") {
      normalized += char;
      state = isEscapedPostgresStringStart(query, i) ? 'escaped-single' : 'single';
      continue;
    }
    if (char === '\\' && next === '?') {
      normalized += '?';
      i++;
      continue;
    }
    if (char === '"') {
      normalized += char;
      state = 'double';
      continue;
    }
    if (char === '-' && next === '-') {
      normalized += '--';
      i++;
      state = 'line-comment';
      continue;
    }
    if (char === '/' && next === '*') {
      normalized += '/*';
      i++;
      state = 'block-comment';
      continue;
    }
    if (char === '$') {
      const dollarQuote = readDollarQuoteToken(query, i);
      if (dollarQuote) {
        normalized += dollarQuote;
        i += dollarQuote.length - 1;
        state = 'dollar-quote';
        dollarQuoteToken = dollarQuote;
        continue;
      }
    }

    normalized += char;
  }

  return normalized;
}

function replaceTaggedTemplateSqlMarkers(
  query: string,
  style: 'postgres' | 'question',
  expectedParamCount = 0,
): string {
  let markerCount = 0;
  const seenIndexes = new Set<number>();
  const replaced = query.replace(TABLE_SQL_PARAM_MARKER_RE, (_match, indexText: string) => {
    const index = Number(indexText);
    if (!Number.isInteger(index) || index < 1) {
      throw new Error('Invalid internal SQL parameter marker index.');
    }
    markerCount++;
    seenIndexes.add(index);
    return style === 'postgres' ? `$${index}` : '?';
  });

  if (markerCount === 0) {
    return query;
  }
  if (style === 'postgres' && scanSqlPlaceholders(query).sawPostgresPlaceholder) {
    throw new Error(
      'Cannot mix tagged template interpolation with PostgreSQL-style $n placeholders.',
    );
  }
  if (markerCount !== expectedParamCount) {
    throw new Error(
      'Internal SQL parameter markers do not match params length. Rebuild the tagged template query and try again.',
    );
  }
  for (let index = 1; index <= expectedParamCount; index++) {
    if (!seenIndexes.has(index)) {
      throw new Error(
        'Internal SQL parameter markers are out of sequence. Rebuild the tagged template query and try again.',
      );
    }
  }

  return style === 'postgres' ? unescapeEscapedPostgresQuestionOperators(replaced) : replaced;
}

function isEscapedQuestionMark(query: string, index: number): boolean {
  return query[index - 1] === '\\';
}

function isStandalonePostgresQuestionOperator(query: string, index: number): boolean {
  const previousToken = readPreviousSqlToken(query, index);
  const nextToken = readNextSqlToken(query, index);
  return canTokenEndExpression(previousToken) && canTokenStartExpression(nextToken);
}

function isPrefixedPostgresQuestionOperator(query: string, index: number): boolean {
  const nextChar = query[index + 1];
  if (nextChar !== '|' && nextChar !== '&') {
    return false;
  }
  return canTokenEndExpression(readPreviousSqlToken(query, index));
}

function isSuffixedPostgresQuestionOperator(query: string, index: number): boolean {
  if (query[index - 1] !== '@') {
    return false;
  }
  return (
    canTokenEndExpression(readPreviousSqlToken(query, index - 1)) &&
    canTokenStartExpression(readNextSqlToken(query, index))
  );
}

function isQuestionBindPlaceholder(query: string, index: number): boolean {
  if (isEscapedQuestionMark(query, index)) {
    return false;
  }
  if (isSuffixedPostgresQuestionOperator(query, index)) {
    return false;
  }
  if (isPrefixedPostgresQuestionOperator(query, index)) {
    return false;
  }
  if (isStandalonePostgresQuestionOperator(query, index)) {
    return false;
  }
  return true;
}

function scanSqlPlaceholders(query: string): {
  questionPlaceholderIndexes: number[];
  sawPostgresPlaceholder: boolean;
} {
  const questionPlaceholderIndexes: number[] = [];
  let sawPostgresPlaceholder = false;
  let state: 'code' | 'single' | 'double' | 'line-comment' | 'block-comment' | 'dollar-quote' =
    'code';
  let dollarQuoteToken = '';

  for (let i = 0; i < query.length; i++) {
    const char = query[i]!;
    const next = query[i + 1];

    if (state === 'single') {
      if (char === "'" && next === "'") {
        i++;
        continue;
      }
      if (char === "'") state = 'code';
      continue;
    }

    if (state === 'double') {
      if (char === '"' && next === '"') {
        i++;
        continue;
      }
      if (char === '"') state = 'code';
      continue;
    }

    if (state === 'line-comment') {
      if (char === '\n') state = 'code';
      continue;
    }

    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        i++;
        state = 'code';
      }
      continue;
    }

    if (state === 'dollar-quote') {
      if (query.startsWith(dollarQuoteToken, i)) {
        i += dollarQuoteToken.length - 1;
        state = 'code';
      }
      continue;
    }

    if (char === "'") {
      state = 'single';
      continue;
    }
    if (char === '\\' && next === '?') {
      i++;
      continue;
    }
    if (char === '"') {
      state = 'double';
      continue;
    }
    if (char === '-' && next === '-') {
      i++;
      state = 'line-comment';
      continue;
    }
    if (char === '/' && next === '*') {
      i++;
      state = 'block-comment';
      continue;
    }
    if (char === '$') {
      const dollarQuote = readDollarQuoteToken(query, i);
      if (dollarQuote) {
        i += dollarQuote.length - 1;
        state = 'dollar-quote';
        dollarQuoteToken = dollarQuote;
        continue;
      }

      const positionalMatch = query.slice(i).match(/^\$(\d+)/);
      if (positionalMatch) {
        sawPostgresPlaceholder = true;
        i += positionalMatch[0].length - 1;
        continue;
      }
    }
    if (char === '?') {
      if (isQuestionBindPlaceholder(query, i)) {
        questionPlaceholderIndexes.push(i);
      }
    }
  }

  return { questionPlaceholderIndexes, sawPostgresPlaceholder };
}

export function normalizePostgresSqlPlaceholders(query: string, expectedParamCount = 0): string {
  const { questionPlaceholderIndexes, sawPostgresPlaceholder } = scanSqlPlaceholders(query);
  const questionPlaceholderCount = questionPlaceholderIndexes.length;
  if (questionPlaceholderCount === 0) {
    return unescapeEscapedPostgresQuestionOperators(query);
  }
  if (sawPostgresPlaceholder) {
    throw new Error('Cannot mix ? placeholders with PostgreSQL-style $n placeholders.');
  }
  if (expectedParamCount === 0) {
    return unescapeEscapedPostgresQuestionOperators(query);
  }
  if (questionPlaceholderCount !== expectedParamCount) {
    throw new Error(
      'PostgreSQL raw SQL placeholders do not match params length. If your query uses the PostgreSQL ? operator, use $1, $2, ... for bind parameters.',
    );
  }

  let normalized = '';
  let paramIndex = 1;
  let state: 'code' | 'single' | 'double' | 'line-comment' | 'block-comment' | 'dollar-quote' =
    'code';
  let dollarQuoteToken = '';
  const placeholderIndexes = new Set(questionPlaceholderIndexes);

  for (let i = 0; i < query.length; i++) {
    const char = query[i]!;
    const next = query[i + 1];

    if (state === 'single') {
      normalized += char;
      if (char === "'" && next === "'") {
        normalized += next;
        i++;
        continue;
      }
      if (char === "'") state = 'code';
      continue;
    }

    if (state === 'double') {
      normalized += char;
      if (char === '"' && next === '"') {
        normalized += next;
        i++;
        continue;
      }
      if (char === '"') state = 'code';
      continue;
    }

    if (state === 'line-comment') {
      normalized += char;
      if (char === '\n') state = 'code';
      continue;
    }

    if (state === 'block-comment') {
      normalized += char;
      if (char === '*' && next === '/') {
        normalized += next;
        i++;
        state = 'code';
      }
      continue;
    }

    if (state === 'dollar-quote') {
      if (query.startsWith(dollarQuoteToken, i)) {
        normalized += dollarQuoteToken;
        i += dollarQuoteToken.length - 1;
        state = 'code';
        continue;
      }
      normalized += char;
      continue;
    }

    if (char === "'") {
      normalized += char;
      state = 'single';
      continue;
    }
    if (char === '\\' && next === '?') {
      normalized += '?';
      i++;
      continue;
    }
    if (char === '"') {
      normalized += char;
      state = 'double';
      continue;
    }
    if (char === '-' && next === '-') {
      normalized += '--';
      i++;
      state = 'line-comment';
      continue;
    }
    if (char === '/' && next === '*') {
      normalized += '/*';
      i++;
      state = 'block-comment';
      continue;
    }
    if (char === '$') {
      const dollarQuote = readDollarQuoteToken(query, i);
      if (dollarQuote) {
        normalized += dollarQuote;
        i += dollarQuote.length - 1;
        state = 'dollar-quote';
        dollarQuoteToken = dollarQuote;
        continue;
      }

      const positionalMatch = query.slice(i).match(/^\$(\d+)/);
      if (positionalMatch) {
        normalized += positionalMatch[0];
        i += positionalMatch[0].length - 1;
        continue;
      }
    }
    if (char === '?' && placeholderIndexes.has(i)) {
      normalized += `$${paramIndex++}`;
      continue;
    }

    normalized += char;
  }

  return normalized;
}

export async function executeProviderAwareSql(
  opts: ProviderAwareSqlOptions,
  namespace: string,
  id: string | undefined,
  query: string,
  params: unknown[] = [],
): Promise<ProviderAwareSqlResult> {
  const usesTaggedTemplateMarkers = hasTaggedTemplateSqlMarkers(query);
  const rewriteTaggedTemplateQuery = (style: 'postgres' | 'question') =>
    usesTaggedTemplateMarkers ? replaceTaggedTemplateSqlMarkers(query, style, params.length) : query;
  const target = resolveDbTarget(opts.config, namespace, id);
  if (!target.ok) {
    throw new Error(formatDbTargetValidationIssue(target.issue, namespace));
  }
  const { dbBlock, instanceId } = target.value;

  if (opts.env) {
    if (!instanceId && (dbBlock.provider === 'neon' || dbBlock.provider === 'postgres')) {
      const bindingName = getProviderBindingName(namespace);
      const envRecord = opts.env as unknown as Record<string, unknown>;
      const hyperdrive = envRecord[bindingName] as { connectionString?: string } | undefined;
      const envKey = dbBlock.connectionString ?? `${bindingName}_URL`;
      const connectionString =
        hyperdrive?.connectionString ?? (envRecord[envKey] as string | undefined);
      if (!connectionString) {
        throw new Error(`PostgreSQL connection '${envKey}' not found.`);
      }

      const normalizedSql = usesTaggedTemplateMarkers
        ? rewriteTaggedTemplateQuery('postgres')
        : normalizePostgresSqlPlaceholders(query, params.length);
      const localDevOptions = getLocalDevPostgresExecOptions(
        opts.env as unknown as Record<string, unknown>,
        namespace,
      );
      if (localDevOptions) {
        await ensureLocalDevPostgresSchema(localDevOptions);
      }
      return withPostgresConnection(
        connectionString,
        async (executor) => {
          if (!localDevOptions) {
            await ensurePgSchema(connectionString, namespace, dbBlock.tables ?? {}, executor);
          }
          return executor(normalizedSql, params);
        },
        localDevOptions,
      );
    }

    if (!instanceId && shouldRouteToD1(namespace, opts.config)) {
      const bindingName = getD1BindingName(namespace);
      const d1 = (opts.env as unknown as Record<string, unknown>)[bindingName] as
        | D1Database
        | undefined;
      if (!d1) {
        throw new Error(`D1 binding '${bindingName}' not found.`);
      }
      const result = await executeD1Sql(d1, rewriteTaggedTemplateQuery('question'), params);
      const rows = result.rows;
      return {
        columns: inferColumns(rows),
        rows,
        rowCount: result.rowCount,
      };
    }

    if (opts.databaseNamespace) {
      const rows = await executeDoSql({
        databaseNamespace: opts.databaseNamespace,
        namespace,
        id: instanceId,
        query: rewriteTaggedTemplateQuery('question'),
        params,
        internal: true,
      });
      return {
        columns: inferColumns(rows),
        rows,
        rowCount: rows.length,
      };
    }
  }

  if (opts.workerUrl && opts.serviceKey) {
    const res = await fetch(`${opts.workerUrl}/api/sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EdgeBase-Service-Key': opts.serviceKey,
      },
      body: JSON.stringify({
        namespace,
        id: instanceId,
        sql: rewriteTaggedTemplateQuery('question'),
        params,
      }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ message: 'SQL execution failed' }))) as {
        message?: string;
      };
      throw new Error(err.message || 'SQL execution failed');
    }
    const data = (await res.json()) as {
      rows?: unknown[];
      items?: unknown[];
      results?: unknown[];
      columns?: string[];
      rowCount?: number;
    };
    const rows = normalizeRows(data);
    return {
      columns: Array.isArray(data.columns) ? data.columns.map(String) : inferColumns(rows),
      rows,
      rowCount: typeof data.rowCount === 'number' ? data.rowCount : rows.length,
    };
  }

  throw new Error('admin.sqlProviderAware() requires env or workerUrl.');
}
