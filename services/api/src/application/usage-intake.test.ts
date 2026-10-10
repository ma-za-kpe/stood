import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { receiptPayload, type UsageReceipt } from '../domain/usage-receipt.js';
import type { StoredUsage, UsageStore } from '../ports/usage-store.js';
import { acceptUsage, usageAuthorities } from './usage-intake.js';

const now = 1790985600000;
const commit = 'b'.repeat(40);
const keys = generateKeyPairSync('ed25519');
const spki = (k = keys.publicKey) =>
  Buffer.from(k.export({ type: 'spki', format: 'pem' }).toString()).toString('base64');
const authorities = usageAuthorities(
  JSON.stringify([{ keyId: 'yard-usage-1', root: 'yard-buyers', publicKey: spki() }]),
);
function receipt(over: Partial<UsageReceipt> = {}, privateKey = keys.privateKey): UsageReceipt {
  const unsigned = {
    version: 1 as const,
    allowanceId: 'alw_1',
    trancheId: 'trn_1',
    commit,
    authority: { keyId: 'yard-usage-1', root: 'yard-buyers' },
    observedAt: now - 1000,
    nonce: 'nonce-0123456789abcdef',
    ...over,
  };
  return { ...unsigned, signature: sign(null, Buffer.from(receiptPayload(unsigned)), privateKey).toString('base64') };
}
function store(target: { allowanceId: string; commit: string } | null = { allowanceId: 'alw_1', commit }) {
  const rows = new Map<string, { usage: StoredUsage; receipt: UsageReceipt }>();
  const s: UsageStore = {
    target: async () => target,
    byNonce: async (n) => rows.get(n) ?? null,
    record: async (_p, r) => {
      const usage = {
        trancheId: r.trancheId,
        commit: r.commit,
        nonce: r.nonce,
        acceptedAt: new Date(now).toISOString(),
      };
      // Stored JSON comes back with its keys in another order.
      rows.set(r.nonce, { usage, receipt: Object.fromEntries(Object.entries(r).reverse()) as UsageReceipt });
      return usage;
    },
    find: async () => null,
  };
  return { s, rows };
}
const accept = (r: unknown, s: UsageStore, at = now) =>
  acceptUsage('platform_a', 'trn_1', r as UsageReceipt, { store: s, authorities, now: at });

// C4 (#77): Stood accepts a final milestone's usage only from a configured outside authority, bound to the exact
// tranche and commit, fresh, and once.
describe('acceptUsage', () => {
  it('stores a valid receipt, answers a retry of the same receipt the same way, and refuses a replay', async () => {
    const { s, rows } = store();
    const first = await accept(receipt(), s);
    expect(first).toMatchObject({ accepted: true, usage: { trancheId: 'trn_1', commit } });
    expect(await accept(receipt(), s)).toEqual(first);
    expect(rows.size).toBe(1);
    expect(await accept(receipt({ observedAt: now - 2000 }), s)).toEqual({ accepted: false, reason: 'replayed' });
    expect(await accept({ nonce: 'nonce-0123456789abcdef' }, s)).toEqual({ accepted: false, reason: 'replayed' });
  });

  it('refuses the wrong commit, an unknown or forged signer, a stale receipt and an unknown tranche', async () => {
    const other = generateKeyPairSync('ed25519');
    for (const [r, reason] of [
      [receipt({ commit: 'c'.repeat(40) }), 'binding'],
      [receipt({ authority: { keyId: 'someone', root: 'yard-buyers' } }), 'authority'],
      [receipt({}, other.privateKey), 'signature'],
      [receipt({ observedAt: now - 2 * 86400000 }), 'stale'],
      [{ version: 2 }, 'malformed'],
    ] as const)
      expect(await accept(r, store().s)).toEqual({ accepted: false, reason });
    expect(await accept(receipt(), store(null).s)).toEqual({ accepted: false, reason: 'not_found' });
  });

  it('reads only valid Ed25519 authorities from configuration', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(usageAuthorities(undefined)).toEqual([]);
    expect(usageAuthorities('not json')).toEqual([]);
    expect(usageAuthorities('{}')).toEqual([]);
    expect(
      usageAuthorities(
        JSON.stringify([
          { keyId: 'ok', root: 'yard-buyers', publicKey: spki() },
          { keyId: 'bad id!', root: 'r', publicKey: spki() },
          { keyId: 'rsa', root: 'r', publicKey: spki(rsa.publicKey) },
          { keyId: 'missing' },
        ]),
      ).map((a) => a.keyId),
    ).toEqual(['ok']);
  });
});
