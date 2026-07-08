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
