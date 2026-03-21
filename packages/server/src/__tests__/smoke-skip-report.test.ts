import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

interface SmokeSkipEntry {
  method: string;
  path: string;
  operationId: string;
  reasonCode: string;
  reasonDescription: string;
}

interface SmokeSkipReport {
  totalRoutes: number;
  skippedRouteCount: number;
  summaryByReason: Record<string, number>;
  skippedRoutes: SmokeSkipEntry[];
}

const REPORT_PATH = resolve(
  fileURLToPath(new URL('../../test/integration/generated/smoke-skip-report.json', import.meta.url)),
);

function readReport(): SmokeSkipReport {
  return JSON.parse(readFileSync(REPORT_PATH, 'utf-8')) as SmokeSkipReport;
}

describe('smoke skip report', () => {
  it('tracks the current skip budget by reason', () => {
    const report = readReport();

    expect({
      totalRoutes: report.totalRoutes,
      skippedRouteCount: report.skippedRouteCount,
      summaryByReason: report.summaryByReason,
    }).toMatchInlineSnapshot(`
      {
        "skippedRouteCount": 0,
        "summaryByReason": {},
        "totalRoutes": 192,
      }
    `);
  });

  it('keeps skipped routes sorted and unique', () => {
    const report = readReport();
    const serialize = (entry: SmokeSkipEntry) => (
      `${entry.reasonCode}:${entry.path}:${entry.method}:${entry.operationId}`
    );
    const sortedEntries = [...report.skippedRoutes].sort((a, b) => (
      a.reasonCode.localeCompare(b.reasonCode)
      || a.path.localeCompare(b.path)
      || a.method.localeCompare(b.method)
      || a.operationId.localeCompare(b.operationId)
    ));

    expect(report.skippedRoutes).toEqual(sortedEntries);
    expect(new Set(report.skippedRoutes.map(serialize)).size).toBe(report.skippedRoutes.length);
  });

  it('requires every skipped route to explain itself', () => {
    const report = readReport();

    for (const entry of report.skippedRoutes) {
      expect(entry.reasonCode.trim().length, `${entry.operationId} is missing reasonCode.`).toBeGreaterThan(0);
      expect(
        entry.reasonDescription.trim().length,
        `${entry.operationId} is missing reasonDescription.`,
      ).toBeGreaterThan(0);
    }
  });
});
