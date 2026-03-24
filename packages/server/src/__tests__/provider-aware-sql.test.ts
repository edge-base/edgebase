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

  it('allows PostgreSQL question-mark operators alongside positional placeholders', () => {
    expect(
      normalizePostgresSqlPlaceholders(
        "SELECT * FROM posts WHERE metadata ? 'featured' AND title = $1",
        1,
      ),
    ).toBe("SELECT * FROM posts WHERE metadata ? 'featured' AND title = $1");
  });

  it('leaves PostgreSQL question-mark operators alone when no params are provided', () => {
    expect(
      normalizePostgresSqlPlaceholders("SELECT * FROM posts WHERE metadata ? 'featured'", 0),
    ).toBe("SELECT * FROM posts WHERE metadata ? 'featured'");
  });

  it('normalizes bind placeholders without touching PostgreSQL question-mark operators', () => {
    expect(
      normalizePostgresSqlPlaceholders(
        "SELECT * FROM posts WHERE metadata ? 'featured' AND id = ?",
        1,
      ),
    ).toBe("SELECT * FROM posts WHERE metadata ? 'featured' AND id = $1");
  });

  it('preserves PostgreSQL @? operators while still normalizing bind placeholders', () => {
    expect(
      normalizePostgresSqlPlaceholders(
        "SELECT * FROM posts WHERE metadata @? '$.featured' AND id = ?",
        1,
      ),
    ).toBe("SELECT * FROM posts WHERE metadata @? '$.featured' AND id = $1");
  });

  it('preserves PostgreSQL ?| operators while still normalizing bind placeholders', () => {
    expect(
      normalizePostgresSqlPlaceholders(
        "SELECT * FROM posts WHERE tags ?| ARRAY['featured', 'pinned'] AND id = ?",
        1,
      ),
    ).toBe("SELECT * FROM posts WHERE tags ?| ARRAY['featured', 'pinned'] AND id = $1");
  });

  it('supports escaped PostgreSQL question-mark operators as a raw SQL escape hatch', () => {
    expect(
      normalizePostgresSqlPlaceholders(
        "SELECT * FROM posts WHERE metadata @\\? '$.featured' AND id = ?",
        1,
      ),
    ).toBe("SELECT * FROM posts WHERE metadata @? '$.featured' AND id = $1");
  });

  it('still treats question marks after prefix operators as bind placeholders when an expression is expected', () => {
    expect(normalizePostgresSqlPlaceholders('SELECT @?::int', 1)).toBe('SELECT @$1::int');
  });

  it('treats SELECT-list question marks as bind placeholders, not operators', () => {
    expect(normalizePostgresSqlPlaceholders('SELECT ?, ? FROM posts', 2)).toBe(
      'SELECT $1, $2 FROM posts',
    );
  });
});
