/**
 * NIP-01 verification of a signed event provided by the caller (POST /commands).
 * Prevents a third party from submitting a command on behalf of the CEO without owning the key.
 */
import { verifyEvent } from 'nostr-tools/pure';
import type { VerifiedEvent } from 'nostr-tools/pure';
import type { Command } from '../commands/schemas.js';
import { normalizePubkey } from './keys.js';

export interface SignedEventInput {
  id: string;
  pubkey: string;
  sig: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

export interface SigVerifyOk {
  ok: true;
  authorHex: string;
}

export interface SigVerifyFail {
  ok: false;
  reason: string;
}

export function verifySignedEventForCommand(ev: SignedEventInput, cmd: Command): SigVerifyOk | SigVerifyFail {
  // Expected kind on the Buzz channel = 9 (NIP-01 channel message).
  if (typeof ev.kind !== 'number' || ev.kind !== 9) {
    return { ok: false, reason: `kind.invalide:${String(ev.kind)} (attendu 9)` };
  }
  // Event content must serialize exactly the same command (no mismatch).
  let contentCmd: unknown;
  try {
    contentCmd = JSON.parse(ev.content);
  } catch {
    return { ok: false, reason: 'content.non_json' };
  }
  if (!sameCommand(contentCmd, cmd)) {
    return { ok: false, reason: 'content.mismatch:commande_event_non_identique' };
  }
  // NIP-01 cryptographic verification (id + Schnorr sig).
  try {
    if (!verifyEvent(ev as VerifiedEvent)) {
      return { ok: false, reason: 'signature.nostr_invalide' };
    }
  } catch {
    return { ok: false, reason: 'signature.nostr_invalide' };
  }
  return { ok: true, authorHex: ev.pubkey.toLowerCase() };
}

export function authorNpubHex(author: string): string {
  try {
    return normalizePubkey(author);
  } catch {
    return author.toLowerCase();
  }
}

/** Strict structural equality between two command representations. */
export function sameCommand(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(',')}}`;
}
