/**
 * CollabAdapter — seam anti lock-in. Buzz est une implémentation (Nostr relay),
 * mais la pipeline ne voit QUE cette interface. NullCollabAdapter = in-memory
 * pour tests ET fallback documenté sans Buzz.
 */
export interface InboundCommand {
  /** id d'événement Nostr ou id synthétique côté null adapter. */
  eventId: string;
  /** Chanel UUID cible (lowercase). */
  channelUuid: string;
  /** Auteur npub ou hex. */
  authorPubkey: string;
  /** Texte brut du message (le body de commande s'y trouve sérialisé). */
  text: string;
  /** Timestamp unix (seconds) de création côté relay. */
  createdAt: number;
}

export interface CollabHealth {
  ok: boolean;
  detail?: string;
}

export interface CollabAdapter {
  /** Poste un message texte dans un channel Buzz (kind 9, NIP-01). */
  postMessage(channelUuid: string, text: string, correlationId: string): Promise<{ eventId: string }>;
  /** Récupère les messages entrants (kind 9) d'un channel depuis `since` (unix seconds). */
  fetchCommands(channelUuid: string, since?: number): Promise<InboundCommand[]>;
  /** Idempotent: crée/assure l'existence du channel ou retourne son état. */
  ensureChannel(channelUuid: string, label?: string): Promise<{ ok: boolean }>;
  health(): Promise<CollabHealth>;
}

/** Fallback documenté : système dégrade en local si Buzz n'est pas configuré. */
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
    return { ok: true, detail: 'null-adapter (Buzz non configuré)' };
  }

  /** Test helper : capture des messages postés. */
  capture(): readonly { channelUuid: string; text: string; correlationId: string; eventId: string }[] {
    return this.posted;
  }

  clear(): void {
    this.posted.length = 0;
  }
}
