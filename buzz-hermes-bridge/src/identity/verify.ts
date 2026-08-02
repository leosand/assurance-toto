/**
 * Vérification NIP-01 d'un event signé fourni par l'appelant (POST /commands).
 * Empêche un tiers de soumettre une commande au nom du CEO sans posséder la clé.
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
  // Kind attendu côté Buzz channel = 9 (message de channel NIP-01).
  if (typeof ev.kind !== 'number' || ev.kind !== 9) {
    return { ok: false, reason: `kind.invalide:${String(ev.kind)} (attendu 9)` };
  }
  // Content de l'event doit sérialiser exactement la même commande (pas de mismatch).
  let contentCmd: unknown;
  try {
    contentCmd = JSON.parse(ev.content);
  } catch {
    return { ok: false, reason: 'content.non_json' };
  }
  if (!sameCommand(contentCmd, cmd)) {
    return { ok: false, reason: 'content.mismatch:commande_event_non_identique' };
  }
  // Vérification cryptographique NIP-01 (id + sig Schnorr).
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

/** Égalité structurelle stricte entre deux représentations de commande. */
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
