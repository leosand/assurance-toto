import WebSocket from 'ws';
import { createHash } from 'node:crypto';
import { useWebSocketImplementation } from 'nostr-tools/relay';
import { finalizeEvent, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import type { VerifiedEvent } from 'nostr-tools/pure';
import type { BridgeConfig } from '../config.js';
import type { CollabAdapter, CollabHealth, InboundCommand } from './CollabAdapter.js';
import { NullCollabAdapter } from './CollabAdapter.js';
import { parseSecretKey } from '../identity/keys.js';

// Mandatory WS injection on Node for potential SimplePool subscriptions.
useWebSocketImplementation(WebSocket);

const KIND_TEXT_NOTE_CHANNEL = 9;
const KIND_HTTP_AUTH = 27235;

interface RelayPostResponse {
  event_id?: string;
  accepted?: boolean;
  message?: string;
}

/** The Buzz relay exposes a REST API in addition to WS (docs + verified facts). */
export class BuzzAdapter implements CollabAdapter {
  private readonly cfg: BridgeConfig;
  private readonly sk: Uint8Array;
  private readonly pubkeyHex: string;

  constructor(cfg: BridgeConfig, buzzPrivateKey: string) {
    this.cfg = cfg;
    const kp = parseSecretKey(buzzPrivateKey);
    this.sk = kp.secretKey;
    this.pubkeyHex = getPublicKey(kp.secretKey);
  }

  private authHeader(url: string, body: string): { Authorization: string } {
    const now = Math.floor(Date.now() / 1000);
    const payloadHash = sha256Hex(body);
    const unsigned = {
      kind: KIND_HTTP_AUTH,
      created_at: now,
      tags: [
        ['u', url],
        ['method', 'POST'],
        ['payload', payloadHash],
        ['t', String(now)],
      ],
      content: '',
    };
    const signed = finalizeEvent(unsigned, this.sk);
    const token = Buffer.from(JSON.stringify(signed), 'utf8').toString('base64');
    return { Authorization: `Nostr ${token}` };
  }

  private async httpPost(path: string, body: unknown): Promise<unknown> {
    const url = new URL(path, this.cfg.buzzRelayUrl).toString();
    const json = JSON.stringify(body);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.authHeader(url, json) },
      body: json,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Buzz REST ${path} → ${res.status} ${text.slice(0, 120)}`);
    }
    const ct = res.headers.get('content-type') ?? '';
    return ct.includes('application/json') ? ((await res.json()) as unknown) : await res.text();
  }

  async postMessage(channelUuid: string, text: string, correlationId: string): Promise<{ eventId: string }> {
    // Buzz channel = kind 9 event, tag h = lowercase uuid, content capped at 64 KiB.
    if (text.length > 64 * 1024) throw new Error('message too long (>64 KiB)');
    const unsigned = {
      kind: KIND_TEXT_NOTE_CHANNEL,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['h', channelUuid.toLowerCase()]],
      content: JSON.stringify({ correlation_id: correlationId, text }),
    };
    const signed = finalizeEvent(unsigned, this.sk);
    const out = (await this.httpPost('/events', signed)) as RelayPostResponse;
    return { eventId: out.event_id ?? signed.id };
  }

  async fetchCommands(channelUuid: string, since?: number): Promise<InboundCommand[]> {
    const filter: Record<string, unknown> = {
      kinds: [KIND_TEXT_NOTE_CHANNEL],
      '#h': [channelUuid.toLowerCase()],
      limit: 200,
    };
    if (since !== undefined) filter['since'] = since;
    const out = (await this.httpPost('/query', [filter])) as unknown;
    if (!Array.isArray(out)) return [];
    const events: InboundCommand[] = [];
    for (const ev of out) {
      const parsed = parseInboundEvent(ev);
      if (parsed !== null && parsed.channelUuid === channelUuid.toLowerCase()) events.push(parsed);
    }
    return events.sort((a, b) => a.createdAt - b.createdAt);
  }

  async ensureChannel(_channelUuid: string, _label?: string): Promise<{ ok: boolean }> {
    // Buzz creates channels on the fly on the first kind-9 event; nothing to do.
    return { ok: true };
  }

  async health(): Promise<CollabHealth> {
    try {
      const res = await fetch(new URL('/health', this.cfg.buzzRelayUrl).toString(), { method: 'GET' });
      return { ok: res.ok, detail: `buzz=${res.status}` };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Optional WS subscription (NIP-01 wire + NIP-42 auth) — non-blocking at startup. */
  async subscribeChannel(_channelUuid: string, _onEv: (cmd: InboundCommand) => void): Promise<() => void> {
    // Out of checkpoint scope: fetchCommands REST polling is enough for correlation.
    // If needed, wire SimplePool + relay.auth() (NIP-42) with nostr-tools here.
    return () => undefined;
  }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Converts a relay kind-9 event into a typed InboundCommand. */
function parseInboundEvent(raw: unknown): InboundCommand | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const ev = raw as Record<string, unknown>;
  const kind = ev['kind'];
  const id = ev['id'];
  const pubkey = ev['pubkey'];
  const createdAt = ev['created_at'];
  const tags = ev['tags'];
  const content = ev['content'];
  if (kind !== KIND_TEXT_NOTE_CHANNEL) return null;
  if (typeof id !== 'string' || typeof pubkey !== 'string' || typeof createdAt !== 'number') return null;
  if (typeof content !== 'string' || !Array.isArray(tags)) return null;
  const hTag = (tags as unknown[]).find((t) => Array.isArray(t) && t[0] === 'h' && typeof t[1] === 'string');
  if (!Array.isArray(hTag) || typeof hTag[1] !== 'string') return null;
  // NIP-01 signature verification, if the event is complete.
  try {
    const candidate = { id, pubkey, sig: String(ev['sig'] ?? ''), created_at: createdAt, kind, tags: tags as string[][], content } as VerifiedEvent;
    if (!verifyEvent(candidate)) return null;
  } catch {
    return null;
  }
  // Buzz content = JSON {correlation_id, text} OR free text. We extract the text.
  let text: string;
  try {
    const parsed = JSON.parse(content) as { correlation_id?: unknown; text?: unknown };
    text = typeof parsed.text === 'string' ? parsed.text : content;
  } catch {
    text = content;
  }
  return { eventId: id, channelUuid: String(hTag[1]).toLowerCase(), authorPubkey: pubkey, text, createdAt };
}

/** Factory: BuzzAdapter if BUZZ_PRIVATE_KEY+BUZZ_RELAY_URL are set, otherwise Null. */
export function makeCollabAdapter(cfg: BridgeConfig): CollabAdapter {
  if (cfg.buzzPrivateKey !== undefined && cfg.buzzRelayUrl.length > 0) {
    return new BuzzAdapter(cfg, cfg.buzzPrivateKey);
  }
  return new NullCollabAdapter();
}

