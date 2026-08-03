/**
 * Builds and sends typed commands to buzz-hermes-bridge.
 *
 * The bridge validates the body with HttpCommandBodySchema (zod):
 *   POST {bridgeUrl}/commands
 *   { command: <Command>, author_pubkey: string, correlation_id?: uuid }
 * Then validates the strict command schema (ajv, additionalProperties:false,
 * date-time format dates, approved_by pattern npub|hex64). It then applies
 * the policy (thresholds, kill-switch, CEO approval) and the business effects —
 * the Hermes agent NEVER writes business data directly.
 */
import type { Logger } from 'pino';

/** Command strictly conforming to the bridge-side ajv schema. */
export interface BridgeCommand {
  type: string;
  [key: string]: unknown;
}

export interface BridgeClient {
  postCommand(command: BridgeCommand, correlationId: string): Promise<BridgePostResult>;
  /** CEO escalation: creates a 'en_attente' approval visible on GET /approvals. */
  createApprobation(input: ApprobationInput): Promise<BridgePostResult>;
  ping(): Promise<boolean>;
}

/** CEO approval request (settlement above threshold, brief §6B). */
export interface ApprobationInput {
  type: 'claim.settlement.approve';
  claim_id: string;
  montant_eur: number;
  reason: string;
  requested_by: string;
  correlation_id: string;
}

export interface BridgePostResult {
  ok: boolean;
  httpStatus: number;
  /** Bridge response body (derived from PipelineResult), or normalized error. */
  body: BridgeResponseBody;
}

export type BridgeResponseBody =
  | { outcome: string; [key: string]: unknown }
  | { ok: false; error: string; details?: unknown };

export interface BridgeClientDeps {
  bridgeUrl: string;
  /** The agent's npub (or hex) — becomes `author_pubkey`. */
  authorPubkey: string;
  logger: Logger;
  fetch?: typeof fetch;
}

function toIso(s: unknown): string {
  if (typeof s !== 'string') return new Date().toISOString();
  const t = Date.parse(s);
  return Number.isNaN(t) ? new Date().toISOString() : new Date(t).toISOString();
}

function clampAmount(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return NaN;
  return Math.round(n * 100) / 100;
}

function clampString(v: unknown, max: number): string {
  const s = typeof v === 'string' ? v : String(v ?? '');
  return s.slice(0, max);
}

/**
 * Validates and normalizes `recommander_reglement` → claim.settlement.approve
 * conforming to the bridge ajv schema. Returns null if minimal validation fails.
 */
export function buildSettlementCommand(input: {
  claim_id: unknown;
  montant: unknown;
  raison: unknown;
  approved_by: string;
}): BridgeCommand | null {
  const claimId = clampString(input.claim_id, 64);
  const montant = clampAmount(input.montant);
  const raison = clampString(input.raison, 500);
  if (claimId.length === 0 || raison.length === 0) return null;
  if (Number.isNaN(montant) || montant > 10_000_000) return null;
  return {
    type: 'claim.settlement.approve',
    claim_id: claimId,
    max_amount_eur: montant,
    reason: raison,
    approved_by: input.approved_by,
    requested_at: toIso(new Date().toISOString()),
  };
}

export function createBridgeClient(deps: BridgeClientDeps): BridgeClient {
  const fetchFn = deps.fetch ?? globalThis.fetch.bind(globalThis);
  const base = deps.bridgeUrl.replace(/\/$/, '');

  async function postJson(path: string, payload: unknown): Promise<BridgePostResult> {
    try {
      const resp = await fetchFn(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      let body: BridgeResponseBody;
      try {
        body = (await resp.json()) as BridgeResponseBody;
      } catch {
        body = { ok: false, error: `http_${resp.status}` };
      }
      return { ok: resp.ok, httpStatus: resp.status, body };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.warn({ action: 'bridge.unreachable', path }, 'bridge unreachable');
      return {
        ok: false,
        httpStatus: 0,
        body: { ok: false, error: `bridge.unreachable: ${msg}` },
      };
    }
  }

  return {
    async postCommand(command: BridgeCommand, correlationId: string): Promise<BridgePostResult> {
      return postJson('/commands', {
        command,
        author_pubkey: deps.authorPubkey,
        correlation_id: correlationId,
      });
    },

    async createApprobation(input: ApprobationInput): Promise<BridgePostResult> {
      return postJson('/approvals', { ...input, requested_by: deps.authorPubkey });
    },

    async ping(): Promise<boolean> {
      try {
        const resp = await fetchFn(`${base}/healthz`, { signal: AbortSignal.timeout(3_000) });
        return resp.ok;
      } catch {
        return false;
      }
    },
  };
}
