// Node environment: real WebCrypto + fake IndexedDB via injected factory.
import { describe, expect, it } from 'vitest';

import { createSecretBox } from '../../src/crypto-box.js';

// Minimal in-memory IDBFactory stand-in is overkill — node lacks indexedDB, so
// without a factory the box must fall back to plaintext; WITH the real global
// crypto but no IDB we still exercise the passthrough contract. The AES path
// is covered through a tiny fake factory below.

import 'fake-indexeddb/auto';

describe('SecretBox', () => {
  it('seals and opens values round-trip (aes-gcm mode)', async () => {
    const box = await createSecretBox(`box-${Math.random().toString(36).slice(2)}`);
    expect(box.mode).toBe('aes-gcm');

    const sealed = await box.seal({ hello: '세계', n: 3 });
    expect(sealed).not.toEqual({ hello: '세계', n: 3 });
    expect((sealed as { __sealed?: number }).__sealed).toBe(1);

    expect(await box.open(sealed)).toEqual({ hello: '세계', n: 3 });
  });

  it('passes plain (pre-encryption) values through open()', async () => {
    const box = await createSecretBox(`box-${Math.random().toString(36).slice(2)}`);
    expect(await box.open({ plain: true })).toEqual({ plain: true });
  });

  it('reads tampered ciphertext as missing', async () => {
    const box = await createSecretBox(`box-${Math.random().toString(36).slice(2)}`);
    const sealed = (await box.seal({ secret: 1 })) as { data: Uint8Array };
    sealed.data[0] = sealed.data[0] ^ 0xff;
    expect(await box.open(sealed)).toBeUndefined();
  });

  it('passphrase custody: unlock, wrong-pass detection, and passphrase change keep data readable', async () => {
    const { createPassphraseSecretBox, changePassphraseSecretBox, passphraseBoxConfigured } =
      await import('../../src/crypto-box.js');
    const name = `lock-${Math.random().toString(36).slice(2)}`;
    // Keep PBKDF2 cheap in tests via the explicit test-only escape hatch.
    const fast = { iterations: 1_000, __unsafeAllowLowIterations: true };

    expect(await passphraseBoxConfigured(name)).toBe(false);
    const created = await createPassphraseSecretBox(name, 'correct horse', fast);
    if ('error' in created) throw new Error(`unexpected: ${created.error}`);
    expect(created.created).toBe(true);
    expect(await passphraseBoxConfigured(name)).toBe(true);
    const sealed = await created.box.seal({ secret: '비밀' });

    // Wrong passphrase: the authenticated unwrap must refuse.
    const wrong = await createPassphraseSecretBox(name, 'wrong pass', fast);
    expect('error' in wrong && wrong.error).toBe('wrong-passphrase');

    // Right passphrase from a fresh session reads existing data.
    const reopened = await createPassphraseSecretBox(name, 'correct horse', fast);
    if ('error' in reopened) throw new Error('reopen failed');
    expect(await reopened.box.open(sealed)).toEqual({ secret: '비밀' });

    // Change passphrase: old stops working, new reads the SAME sealed data.
    const changed = await changePassphraseSecretBox(name, 'correct horse', 'battery staple', fast);
    if ('error' in changed) throw new Error('change failed');
    expect(await changed.box.open(sealed)).toEqual({ secret: '비밀' });
    const oldPass = await createPassphraseSecretBox(name, 'correct horse', fast);
    expect('error' in oldPass && oldPass.error).toBe('wrong-passphrase');
    const newPass = await createPassphraseSecretBox(name, 'battery staple', fast);
    if ('error' in newPass) throw new Error('new pass failed');
    expect(await newPass.box.open(sealed)).toEqual({ secret: '비밀' });
  });

  it('same-name boxes share the persisted key; different names do not decrypt each other', async () => {
    const name = `box-${Math.random().toString(36).slice(2)}`;
    const a = await createSecretBox(name);
    const b = await createSecretBox(name);
    const other = await createSecretBox(`${name}-other`);

    const sealed = await a.seal('shared');
    expect(await b.open(sealed)).toBe('shared');
    expect(await other.open(sealed)).toBeUndefined();
  });

  it('AAD binds a value to its slot: round-trips with the right context, rejects a mismatch (cut-and-paste)', async () => {
    const box = await createSecretBox(`box-${Math.random().toString(36).slice(2)}`);

    const sealed = await box.seal({ balance: 100 }, 'record:accounts:alice');
    // v2 envelope carries an explicit version + algorithm.
    expect((sealed as { v?: number; alg?: string }).v).toBe(2);
    expect((sealed as { alg?: string }).alg).toBe('AES-GCM');

    // Correct slot decrypts.
    expect(await box.open(sealed, 'record:accounts:alice')).toEqual({ balance: 100 });
    // Cut-and-paste into another record's slot fails the authenticated decrypt.
    expect(await box.open(sealed, 'record:accounts:bob')).toBeUndefined();
    // Missing context is also a mismatch.
    expect(await box.open(sealed)).toBeUndefined();
  });

  it('strict rejectUnsealed mode treats non-sealed (injected plaintext) values as a miss', async () => {
    const name = `box-${Math.random().toString(36).slice(2)}`;
    const lax = await createSecretBox(name);
    const strict = await createSecretBox(name, { rejectUnsealed: true });

    // Legacy / attacker-injected plaintext: lax passes it through, strict drops it.
    expect(await lax.open({ injected: true })).toEqual({ injected: true });
    expect(await strict.open({ injected: true })).toBeUndefined();

    // Genuinely sealed values still read in strict mode.
    const sealed = await strict.seal({ ok: 1 }, 'ctx');
    expect(await strict.open(sealed, 'ctx')).toEqual({ ok: 1 });
  });

  it('rejects an unknown future envelope version', async () => {
    const box = await createSecretBox(`box-${Math.random().toString(36).slice(2)}`);
    const sealed = (await box.seal('v', 'ctx')) as { v: number };
    sealed.v = 999; // pretend a newer format we do not understand
    expect(await box.open(sealed, 'ctx')).toBeUndefined();
  });

  it('createSecretBox throws instead of silently degrading to plaintext without opt-in', async () => {
    // No IndexedDB factory + node has no global indexedDB via a bare name here?
    // Force the missing-crypto path by passing a bogus factory-less options and
    // stubbing resolve by using a name that still has fake-indexeddb; instead we
    // assert the opt-in path returns a plaintext box while the default throws.
    const badFactory = { open: undefined } as unknown as IDBFactory;
    await expect(
      createSecretBox(`box-${Math.random().toString(36).slice(2)}`, { factory: badFactory }),
    ).rejects.toThrow(/allowInsecureFallback/);

    const box = await createSecretBox(`box-${Math.random().toString(36).slice(2)}`, {
      factory: badFactory,
      allowInsecureFallback: true,
    });
    expect(box.mode).toBe('plaintext');
  });

  it('enforces a PBKDF2 iteration floor unless the test escape hatch is set', async () => {
    const { createPassphraseSecretBox } = await import('../../src/crypto-box.js');
    const name = `lock-${Math.random().toString(36).slice(2)}`;
    await expect(
      createPassphraseSecretBox(name, 'pw', { iterations: 1_000 }),
    ).rejects.toThrow(/below the minimum/);
    // With the escape hatch it succeeds.
    const ok = await createPassphraseSecretBox(name, 'pw', {
      iterations: 1_000,
      __unsafeAllowLowIterations: true,
    });
    expect('error' in ok).toBe(false);
  });

  it('concurrent first-runs converge on ONE key (atomic create, no data loss)', async () => {
    const name = `box-${Math.random().toString(36).slice(2)}`;
    // Race several first-run box creations against the same store.
    const boxes = await Promise.all(
      Array.from({ length: 5 }, () => createSecretBox(name)),
    );
    // A value sealed by the first box must be readable by ALL of them — which
    // only holds if every concurrent creation converged on the same key.
    const sealed = await boxes[0].seal({ v: 'converge' }, 'ctx');
    for (const box of boxes) {
      expect(await box.open(sealed, 'ctx')).toEqual({ v: 'converge' });
    }
  });

  it('passphrase concurrent first-runs converge on one wrapped key', async () => {
    const { createPassphraseSecretBox } = await import('../../src/crypto-box.js');
    const name = `lock-${Math.random().toString(36).slice(2)}`;
    const opts = { iterations: 1_000, __unsafeAllowLowIterations: true };
    const results = await Promise.all(
      Array.from({ length: 4 }, () => createPassphraseSecretBox(name, 'same-pass', opts)),
    );
    const boxes = results.map((r) => {
      if ('error' in r) throw new Error(`unexpected: ${r.error}`);
      return r.box;
    });
    const sealed = await boxes[0].seal({ v: 'shared-dek' }, 'ctx');
    for (const box of boxes) {
      expect(await box.open(sealed, 'ctx')).toEqual({ v: 'shared-dek' });
    }
  });

  it('encryptRecordCacheAdapter binds records to their (table,id) slot', async () => {
    const { encryptRecordCacheAdapter } = await import('../../src/crypto-box.js');
    const { createMemoryRecordCacheAdapter } = await import('../../src/record-cache.js');
    const box = await createSecretBox(`box-${Math.random().toString(36).slice(2)}`);
    const inner = createMemoryRecordCacheAdapter();
    const enc = encryptRecordCacheAdapter(inner, box);

    await enc.putRecords('accounts', [{ id: 'alice', value: { balance: 1 } }]);
    expect(await enc.listTable('accounts')).toEqual([{ id: 'alice', value: { balance: 1 } }]);

    // Cut-and-paste alice's sealed blob into bob's slot at the raw storage layer.
    const rawAlice = (await inner.listTable('accounts'))[0];
    await inner.putRecords('accounts', [{ id: 'bob', value: rawAlice.value }]);

    // bob's forged entry fails its AAD-bound decrypt and is dropped; alice stays.
    const opened = await enc.listTable('accounts');
    expect(opened.map((r) => r.id)).toEqual(['alice']);
  });

  it('encryptOutboxAdapter: claimed entries survive (bound to entryKey, not tabId); cross-key paste is rejected', async () => {
    const { encryptOutboxAdapter } = await import('../../src/crypto-box.js');
    const { createMemoryOutboxAdapter } = await import('../../src/durable-outbox.js');
    const box = await createSecretBox(`box-${Math.random().toString(36).slice(2)}`);
    const inner = createMemoryOutboxAdapter();
    const enc = encryptOutboxAdapter<{ op: string }>(inner, box);

    await enc.put({ entryKey: 'create:1', tabId: 'dead', updatedAt: 1, value: { op: 'x' } });

    // A claim re-homes the entry under a new tabId WITHOUT re-sealing — it must
    // still decrypt (entryKey, the logical slot, is unchanged).
    const claimed = await enc.claimTab('dead', 'fresh');
    expect(claimed.map((entry) => entry.value)).toEqual([{ op: 'x' }]);

    // But the same blob pasted under a DIFFERENT entryKey must not decrypt.
    const rawInner = (await inner.listEntries('fresh'))[0];
    await inner.put({ entryKey: 'create:2', tabId: 'fresh', updatedAt: 2, value: rawInner.value });
    const listed = await enc.listEntries('fresh');
    expect(listed.map((entry) => entry.entryKey)).toEqual(['create:1']);
  });
});
