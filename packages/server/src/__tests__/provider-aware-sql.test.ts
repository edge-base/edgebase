import { describe, expect, it } from 'vitest';
import { normalizePostgresSqlPlaceholders } from '../lib/provider-aware-sql.js';

describe('provider-aware raw SQL helpers', () => {
  it('normalizes question-mark placeholders while preserving quoted and commented question marks', () => {
    const query = `
      SELECT '?' AS literal, "weird?" AS "column?"
      FROM posts
      WHERE title = ?
        AND body = $$literal ?$$
        /* keep ? */
        -- keep ?
        AND status = ?
    `;

    const normalized = normalizePostgresSqlPlaceholders(query, 2);

    expect(normalized).toContain('WHERE title = $1');
    expect(normalized).toContain('AND status = $2');
    expect(normalized).toContain('SELECT \'?\' AS literal, "weird?" AS "column?"');
    expect(normalized).toContain('$$literal ?$$');
    expect(normalized).toContain('/* keep ? */');
  });

  it('rejects mixed question-mark and PostgreSQL-style positional placeholders', () => {
    expect(() =>
      normalizePostgresSqlPlaceholders('SELECT * FROM posts WHERE id = $1 AND title = ?', 1),
    ).toThrow('Cannot mix ? placeholders with PostgreSQL-style $n placeholders.');
  });

  it('leaves PostgreSQL question-mark operators alone when no params are provided', () => {
    expect(
      normalizePostgresSqlPlaceholders("SELECT * FROM posts WHERE metadata ? 'featured'", 0),
    ).toBe("SELECT * FROM posts WHERE metadata ? 'featured'");
  });

  it('throws when question-mark placeholders do not match params length', () => {
    expect(() =>
      normalizePostgresSqlPlaceholders(
        "SELECT * FROM posts WHERE metadata ? 'featured' AND id = ?",
        1,
      ),
    ).toThrow('PostgreSQL raw SQL placeholders do not match params length.');
  });
});
