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
    const fast = { iterations: 1_000 }; // keep PBKDF2 cheap in tests

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
});
