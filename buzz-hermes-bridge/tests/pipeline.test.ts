import { describe, it, expect, beforeEach } from 'vitest';
import pino from 'pino';
import { processInboundCommand, type PipelineDeps, type InboundCommandEnvelope } from '../src/pipeline.js';
import { makeMemoryRepository, type MemoryState } from '../src/db/repository.js';
import { NullCollabAdapter } from '../src/collab/CollabAdapter.js';
import { MemoryDlq } from '../src/dlq.js';
import { makeMetrics } from '../src/metrics/metrics.js';
import { loadConfig, type BridgeConfig } from '../src/config.js';
import { computeAuditHash } from '../src/audit.js';
import { createHash } from 'node:crypto';
import { verifyAuditChain } from '../src/audit.js';

const CEO_HEX = '853d09e8161497fd4ba0df474d87187a9764c866525e418de4b58442bb20d8ff';
const AGENT_HEX = 'fd904a8dddb79fc6e833c940ad9b6a9377e66b4b80361dc41ee6327da89d9103';
const SALES_HEX = 'a3b5c7d9e1f2034050607080a0b0c0d0e0f101112131415161718191a1b1c1d1';
const CHANNEL = '9f2a6d84-1f2c-4d7f-8b3a-1234567890ab';

function makeCfg(): BridgeConfig {
  // Env minimale, aucun secret.
  return loadConfig({
    CLAIM_SETTLEMENT_THRESHOLD_EUR: '5000',
    BRIDGE_CEOPUBKEYS: CEO_HEX,
    DLQ_MAX_ATTEMPTS: '3',
  } as NodeJS.ProcessEnv);
}

interface Fixture {
  deps: PipelineDeps;
  state: MemoryState;
  adapter: NullCollabAdapter;
  dlq: MemoryDlq;
}

function fixture(opts?: { sinistres?: { id: string; statut: string; montant_eur: number; compliance_bloque: boolean }[]; killActif?: boolean }): Fixture {
  const { repo, state } = makeMemoryRepository({
    sinistres: opts?.sinistres ?? [{ id: 'CLM-1', statut: 'ouvert', montant_eur: 3200, compliance_bloque: false }],
    ...(opts?.killActif !== undefined
      ? { killSwitch: { id: 1, actif: opts.killActif, active_par: CEO_HEX, active_le: '2026-08-02T00:00:00Z' } }
      : {}),
  });
  const adapter = new NullCollabAdapter();
  const dlq = new MemoryDlq();
  const metrics = makeMetrics();
  const logger = pino({ enabled: false });
  const cfg = makeCfg();
  const deps: PipelineDeps = {
    repo,
    adapter,
    dlq,
    metrics,
    logger,
    cfg,
    ceoPubkeysHex: [CEO_HEX],
    allowedUnsignedRolesHex: [AGENT_HEX],
  };
  return { deps, state, adapter, dlq };
}

function inbound(content: unknown, author = CEO_HEX, over: Partial<InboundCommandEnvelope> = {}): InboundCommandEnvelope {
  // Internal pipeline tests simulate the BuzzAdapter upstream: the signature was already verified.
  return {
    eventId: `http-test-${Math.random().toString(36).slice(2)}`,
    authorPubkey: author,
    content: JSON.stringify(content),
    channelUuid: CHANNEL,
    signed: true,
    ...over,
  };
}

function validApproveCmd(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'claim.settlement.approve',
    claim_id: 'CLM-1',
    max_amount_eur: 4000,
    reason: 'contre-expertise ok',
    approved_by: CEO_HEX,
    requested_at: '2026-08-02T01:00:00.000Z',
    ...over,
  };
}

describe('pipeline — cycle complet', () => {
  it('claim.settlement.approve → executed + P&L effect + Buzz message posted', async () => {
    const { deps, state, adapter } = fixture();
    const r = await processInboundCommand(deps, inbound(validApproveCmd()));
    expect(r.outcome).toBe('executed');
    // P&L: negative claim-settlement line emitted with the same correlation_id
    expect(state.pnl).toHaveLength(1);
    expect(state.pnl[0]!.categorie).toBe('reglement');
    expect(state.pnl[0]!.montant).toBe(-4000);
    expect(state.pnl[0]!.correlation_id).toBe(r.correlationId);
    // sinistre moved to "regle"
    expect(state.sinistres.get('CLM-1')!.statut).toBe('regle');
    // reply message posted on the right channel with the same correlation_id
    expect(adapter.capture()).toHaveLength(1);
    expect(adapter.capture()[0]!.correlationId).toBe(r.correlationId);
    expect(adapter.capture()[0]!.text).toContain(r.correlationId);
    // audit contient commande + executed
    const actions = state.audit.map((a) => a.action);
    expect(actions).toContain('command.claim.settlement.approve');
    expect(actions).toContain('command.executed');
  });

  it('idempotence: same command twice → the second is denied', async () => {
    const { deps, state } = fixture();
    const cmd = validApproveCmd();
    const content = JSON.stringify(cmd);
    const r1 = await processInboundCommand(deps, inbound(JSON.parse(content)));
    const r2 = await processInboundCommand(deps, inbound(JSON.parse(content)));
    expect(r1.outcome).toBe('executed');
    expect(r2.outcome).toBe('consumed');
    expect(r2.correlationId).not.toBe(r1.correlationId);
    // Un seul effet P&L en base
    expect(state.pnl).toHaveLength(1);
  });

  it('active kill-switch blocks autonomous execution (claim settle)', async () => {
    const { deps, state, dlq } = fixture({ killActif: true });
    // killswitch throws (retryable=false) → outcome 'dlq', nothing is executed
    const r = await processInboundCommand(deps, inbound(validApproveCmd()));
    expect(r.outcome).toBe('dlq');
    expect(state.pnl).toHaveLength(0);
    const entries = await dlq.list();
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0]!.reason).toContain('kill-switch');
  });

  it('active kill-switch: agent.killswitch.deactivate always passes', async () => {
    const { deps, state } = fixture({ killActif: true });
    const r = await processInboundCommand(
      deps,
      inbound({ type: 'agent.killswitch.deactivate', approved_by: CEO_HEX, reason: 'reprise', requested_at: '2026-08-02T01:00:00.000Z' }),
    );
    expect(r.outcome).toBe('executed');
    expect(state.killSwitch?.actif).toBe(false);
  });

  it('correlation_id propagate: provided → reused in audit + pnl + message', async () => {
    const { deps, state, adapter } = fixture();
    const cid = '11111111-2222-4333-8444-555555555555';
    const r = await processInboundCommand(deps, inbound(validApproveCmd(), CEO_HEX, { correlationId: cid }));
    expect(r.correlationId).toBe(cid);
    expect(state.audit.every((a) => a.correlation_id === cid)).toBe(true);
    expect(state.pnl[0]!.correlation_id).toBe(cid);
    expect(adapter.capture()[0]!.correlationId).toBe(cid);
  });

  it('commande invalide (texte libre) → denied, rien en DLQ, audit schema_invalid', async () => {
    const { deps, state, dlq } = fixture();
    const r = await processInboundCommand(deps, inbound('juste du texte libre'));
    expect(r.outcome).toBe('denied');
    expect(r.reason).toContain('schema.invalid');
    expect(state.pnl).toHaveLength(0);
    expect((await dlq.list()).length).toBe(0);
    expect(state.audit.some((a) => a.action === 'command.schema_invalid')).toBe(true);
  });

  it('policy deny (non-CEO role) → denied with no effect', async () => {
    const { deps, state } = fixture();
    // ACL: neither CEO nor allowlisted agent-sinistres → 'unknown' denied by the policy.
    const r = await processInboundCommand(deps, inbound(validApproveCmd(), SALES_HEX));
    expect(r.outcome).toBe('denied');
    expect(r.reason).toContain('rbac');
    expect(state.pnl).toHaveLength(0);
  });

  it('amount > requested cap → denied', async () => {
    const { deps, state } = fixture({
      sinistres: [{ id: 'CLM-BIG', statut: 'ouvert', montant_eur: 99000, compliance_bloque: false }],
    });
    // Signed CEO but undersized max_amount_eur (4000 < 99000) → amount deny.
    const r = await processInboundCommand(
      deps,
      inbound(validApproveCmd({ claim_id: 'CLM-BIG', max_amount_eur: 4000, approved_by: CEO_HEX }), CEO_HEX, { signed: true }),
    );
    expect(r.outcome).toBe('denied');
    expect(r.reason).toContain('montant');
    expect(state.pnl).toHaveLength(0);
  });

  it('audit chain is intact and tampering is detected', async () => {
    const { deps, state } = fixture();
    await processInboundCommand(deps, inbound(validApproveCmd()));
    await processInboundCommand(deps, inbound({ type: 'finance.report.request', periode: '2026-07', departements: ['auto'], approved_by: CEO_HEX, requested_at: '2026-08-02T01:00:00.000Z' }));
    const v1 = await verifyAuditChain(deps.repo);
    expect(v1.ok).toBe(true);
    // Tamper with an entry in the middle → detection.
    if (state.audit.length >= 2) {
      state.audit[0]!.payload = '{"tampered":true}';
      const v2 = await verifyAuditChain(deps.repo);
      expect(v2.ok).toBe(false);
      expect(v2.brokenAt).toBe(1);
    }
  });

  it('audit hash match sha256(prev + payload canonique)', () => {
    const payload = { b: 1, a: 2 };
    const hash = computeAuditHash('', payload);
    const manual = createHash('sha256').update('' + '{"a":2,"b":1}', 'utf8').digest('hex');
    expect(hash).toBe(manual);
  });
});

describe('pipeline — agent autonomy + anti-forgery (§6A/§6B)', () => {
  it('allowlisted claims agent under the threshold → executed (self-settlement)', async () => {
    const { deps, state } = fixture();
    const r = await processInboundCommand(
      deps,
      inbound(validApproveCmd({ max_amount_eur: 4000, approved_by: AGENT_HEX }), AGENT_HEX, { signed: false }),
    );
    expect(r.outcome).toBe('executed');
    expect(state.pnl).toHaveLength(1);
    expect(state.sinistres.get('CLM-1')!.statut).toBe('regle');
  });

  it('allowlisted claims agent ABOVE the threshold → denied rbac:au_dessus_seuil_reserve_CEO', async () => {
    const { deps, state } = fixture({
      sinistres: [{ id: 'CLM-BIG', statut: 'ouvert', montant_eur: 9000, compliance_bloque: false }],
    });
    const r = await processInboundCommand(
      deps,
      inbound(validApproveCmd({ claim_id: 'CLM-BIG', max_amount_eur: 9000, approved_by: AGENT_HEX }), AGENT_HEX, { signed: false }),
    );
    expect(r.outcome).toBe('denied');
    expect(r.reason).toBe('rbac:au_dessus_seuil_reserve_CEO');
    expect(state.pnl).toHaveLength(0);
  });

  it('anti-forgery dur : npub CEO SANS signature → denied rbac:ceo_sans_signature', async () => {
    const { deps, state } = fixture();
    const r = await processInboundCommand(deps, inbound(validApproveCmd(), CEO_HEX, { signed: false }));
    expect(r.outcome).toBe('denied');
    expect(r.reason).toBe('rbac:ceo_sans_signature');
    expect(state.pnl).toHaveLength(0);
  });

});
