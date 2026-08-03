/**
 * CollabAdapter — anti-lock-in seam. Buzz is one implementation (Nostr relay),
 * but the pipeline sees ONLY this interface. NullCollabAdapter = in-memory
 * for tests AND as the documented fallback without Buzz.
 */
export interface InboundCommand {
  /** Nostr event id or synthetic id from the null adapter. */
  eventId: string;
  /** Target channel UUID (lowercase). */
  channelUuid: string;
  /** Author npub or hex. */
  authorPubkey: string;
  /** Raw message text (the command body is serialized in it). */
  text: string;
  /** Unix creation timestamp (seconds) from the relay. */
  createdAt: number;
}

export interface CollabHealth {
  ok: boolean;
  detail?: string;
}

export interface CollabAdapter {
  /** Posts a text message into a Buzz channel (kind 9, NIP-01). */
  postMessage(channelUuid: string, text: string, correlationId: string): Promise<{ eventId: string }>;
  /** Fetches incoming messages (kind 9) from a channel since `since` (unix seconds). */
  fetchCommands(channelUuid: string, since?: number): Promise<InboundCommand[]>;
  /** Idempotent: creates/ensures the channel exists, or returns its state. */
  ensureChannel(channelUuid: string, label?: string): Promise<{ ok: boolean }>;
  health(): Promise<CollabHealth>;
}

/** Documented fallback: the system degrades to local mode if Buzz is not configured. */
export class NullCollabAdapter implements CollabAdapter {
  private readonly posted: { channelUuid: string; text: string; correlationId: string; eventId: string }[] = [];

  async postMessage(channelUuid: string, text: string, correlationId: string): Promise<{ eventId: string }> {
    const eventId = `null-${this.posted.length + 1}`;
    this.posted.push({ channelUuid, text, correlationId, eventId });
    return { eventId };
  }

  async fetchCommands(_channelUuid: string, _since?: number): Promise<InboundCommand[]> {
    return [];
  }

  async ensureChannel(_channelUuid: string, _label?: string): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  async health(): Promise<CollabHealth> {
    return { ok: true, detail: 'null-adapter (Buzz not configured)' };
  }

  /** Test helper: captures posted messages. */
  capture(): readonly { channelUuid: string; text: string; correlationId: string; eventId: string }[] {
    return this.posted;
  }

  clear(): void {
    this.posted.length = 0;
  }
}
