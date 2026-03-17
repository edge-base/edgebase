#!/usr/bin/env node
/**
 * bench-check.js — Performance regression gate for CI
 *
 * Reads vitest bench JSON output and checks P95 latency against thresholds.
 * Exit code 0 = pass, 1 = regression detected.
 *
 * Usage:
 *   node tools/bench-check.js [bench-results.json]
 *
 * If no file is specified, reads from stdin.
 *
 * Thresholds are defined below. Adjust as the project matures.
 */

import { readFileSync } from 'node:fs';

// ─── P95 Thresholds (milliseconds) ────────────────────────────────────────

const THRESHOLDS = {
  'GET list (default limit)': 50,
  'GET list (limit=100)': 80,
  'GET list with filter': 50,
  'GET list with sort': 50,
  'GET list with filter + sort + limit': 50,
  'POST create record': 100,
  'GET health check': 20,
};

// ─── Main ──────────────────────────────────────────────────────────────────

function main() {
  const file = process.argv[2];

  let raw;
  try {
    if (file) {
      raw = readFileSync(file, 'utf-8');
    } else {
      raw = readFileSync('/dev/stdin', 'utf-8');
    }
  } catch (err) {
    console.error('Error reading bench results:', err.message);
    console.log('\nUsage: node tools/bench-check.js [bench-results.json]');
    process.exit(1);
  }

  let results;
  if (!raw.trim()) {
    console.log('No benchmark JSON output found. Skipping check.');
    process.exit(0);
  }

  try {
    results = JSON.parse(raw);
  } catch {
    console.log('Benchmark output was not valid JSON. Skipping check.');
    process.exit(0);
  }

  // vitest bench JSON format: { testResults: [ { ... } ] }
  // Each test result has assertionResults with benchmarks
  const benchmarks = extractBenchmarks(results);

  if (benchmarks.length === 0) {
    console.log('No benchmark results found. Skipping check.');
    process.exit(0);
  }

  console.log('=== Performance Regression Check ===\n');

  let failed = false;

  for (const bench of benchmarks) {
    const threshold = findThreshold(bench.name);
    if (!threshold) {
      console.log(`  ⏩ ${bench.name}: ${bench.p95.toFixed(2)}ms (no threshold set)`);
      continue;
    }

    const pass = bench.p95 <= threshold;
    const icon = pass ? '✅' : '❌';
    console.log(`  ${icon} ${bench.name}: ${bench.p95.toFixed(2)}ms (threshold: ${threshold}ms)`);

    if (!pass) {
      failed = true;
    }
  }

  console.log('');

  if (failed) {
    console.log('❌ Performance regression detected! Some benchmarks exceed thresholds.');
    process.exit(1);
  } else {
    console.log('✅ All benchmarks within acceptable thresholds.');
    process.exit(0);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function extractBenchmarks(results) {
  const benchmarks = [];

  // Handle vitest bench JSON reporter format
  if (results.testResults) {
    for (const suite of results.testResults) {
      if (suite.assertionResults) {
        for (const assertion of suite.assertionResults) {
          if (assertion.benchmark) {
            benchmarks.push({
              name: assertion.ancestorTitles
                ? [...assertion.ancestorTitles, assertion.title].join(' > ')
                : assertion.title,
              p95: assertion.benchmark.p95 ?? assertion.benchmark.mean ?? 0,
              mean: assertion.benchmark.mean ?? 0,
              p99: assertion.benchmark.p99 ?? 0,
            });
          }
        }
      }
    }
  }

  // Handle alternative format: flat array
  if (Array.isArray(results)) {
    for (const item of results) {
      if (item.name && (item.p95 != null || item.mean != null)) {
        benchmarks.push({
          name: item.name,
          p95: item.p95 ?? item.mean ?? 0,
          mean: item.mean ?? 0,
          p99: item.p99 ?? 0,
        });
      }
    }
  }

  return benchmarks;
}

function findThreshold(name) {
  // Exact match
  if (THRESHOLDS[name]) return THRESHOLDS[name];

  // Partial match (bench name might have suite prefix)
  for (const [key, value] of Object.entries(THRESHOLDS)) {
    if (name.includes(key)) return value;
  }

  return null;
}

main();
