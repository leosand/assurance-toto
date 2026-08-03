import { createHash } from 'node:crypto';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { decode, npubEncode } from 'nostr-tools/nip19';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import type { EventTemplate, VerifiedEvent } from 'nostr-tools/pure';

/** Nostr key pairs: one per identity (CEO + agents). Never logged in plaintext. */
export interface KeyPair {
  secretKey: Uint8Array;
  publicHex: string;
  npub: string;
}

export function parseSecretKey(input: string): KeyPair {
  let sk: Uint8Array;
  if (input.startsWith('nsec1')) {
    const dec = decode(input);
    if (dec.type !== 'nsec') throw new Error('BUZZ_PRIVATE_KEY nsec invalide');
    sk = dec.data;
  } else if (/^[0-9a-f]{64}$/i.test(input)) {
    sk = hexToBytes(input.toLowerCase());
  } else {
    throw new Error('Unsupported key format (expected nsec1… or hex64)');
  }
  const publicHex = getPublicKey(sk);
  return { secretKey: sk, publicHex, npub: npubEncode(publicHex) };
}

/** npub → hex (for comparison with BRIDGE_CEOPUBKEYS). Already tolerates hex. */
export function normalizePubkey(input: string): string {
  const t = input.trim();
  if (/^[0-9a-f]{64}$/i.test(t)) return t.toLowerCase();
  const dec = decode(t);
  if (dec.type !== 'npub') throw new Error(`npub invalide: ${t.slice(0, 12)}…`);
  return dec.data;
}

export function keyPairToNpub(kp: KeyPair): string {
  return kp.npub;
}

export function signEvent(sk: Uint8Array, template: EventTemplate): VerifiedEvent {
  return finalizeEvent(template, sk);
}

/** Verifies a NIP-01 signature on a structured event (no any). */
export function verifySignedEvent(ev: VerifiedEvent): boolean {
  return verifyEvent(ev);
}

/** Stable fingerprint that can be shown in logs without exposing the key. */
export function keyFingerprint(npub: string): string {
  return createHash('sha256').update(npub).digest('hex').slice(0, 12);
}

export { generateSecretKey, bytesToHex, verifyEvent };
