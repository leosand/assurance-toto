import { createHash } from 'node:crypto';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { decode, npubEncode } from 'nostr-tools/nip19';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import type { EventTemplate, VerifiedEvent } from 'nostr-tools/pure';

/** Paires de clés Nostr : une par identité (CEO + agents). Jamais logguées en clair. */
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
    throw new Error('Format de clé non supporté (nsec1… ou hex64 attendu)');
  }
  const publicHex = getPublicKey(sk);
  return { secretKey: sk, publicHex, npub: npubEncode(publicHex) };
}

/** npub → hex (pour comparaison avec BRIDGE_CEOPUBKEYS). Tolère déjà un hex. */
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

/** Vérifie une signature NIP-01 sur un événement structuré (pas d'any). */
export function verifySignedEvent(ev: VerifiedEvent): boolean {
  return verifyEvent(ev);
}

/** Empreinte stable affichable dans les logs sans exposer la clé. */
export function keyFingerprint(npub: string): string {
  return createHash('sha256').update(npub).digest('hex').slice(0, 12);
}

export { generateSecretKey, bytesToHex, verifyEvent };
