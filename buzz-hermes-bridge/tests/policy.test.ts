import { describe, it, expect, beforeEach } from 'vitest';
import { evaluate, type Role } from '../src/policy/policy.js';
import type { PolicyContext, SinistreRow, KillSwitchRow } from '../src/db/repository.js';
import type { Command } from '../src/commands/schemas.js';

// Synthetic keys (never reused elsewhere). CEO hex authorized by the config.
const CEO_HEX = '853d09e8161497fd4ba0df474d87187a9764c866525e418de4b58442bb20d8ff';
const AGENT_HEX = 'fd904a8dddb79fc6e833c940ad9b6a9377e66b4b80361dc41ee6327da89d9103';

function ctx(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    killSwitch: { id: 1, actif: false, active_par: null, active_le: null },
    sinistre: { id: 'CLM-1', statut: 'ouvert', montant_eur: 3200, compliance_bloque: false },
    commandConsumed: false,
    approbation: null,
    thresholdEur: 5000,
    ...overrides,
  };
}

function approveCmd(overrides: Record<string, unknown> = {}): Command {
  return {
    type: 'claim.settlement.approve',
    claim_id: 'CLM-1',
    max_amount_eur: 4000,
    reason: 'ok',
    approved_by: CEO_HEX,
    requested_at: '2026-08-02T01:00:00.000Z',
    ...(overrides as object),
  } as Command;
}

describe('policy.evaluate — 7 deny rules + allow (agent autonomy §6B)', () => {
  it("1) unauthorized role (sales) → deny 'rbac:reglement_non_autorise_pour_role'", () => {
    const r = evaluate({ cmd: approveCmd(), ctx: ctx(), role: 'agent-sales' });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('rbac:reglement_non_autorise_pour_role');
  });

  it('2) claim/sinistre not found → deny', () => {
    const r = evaluate({ cmd: approveCmd(), ctx: ctx({ sinistre: null }), role: 'ceo' });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('sinistre:introuvable');
  });

  it('2b) claim/sinistre in a bad state → deny', () => {
    const s: SinistreRow = { id: 'CLM-1', statut: 'regle', montant_eur: 100, compliance_bloque: false };
    const r = evaluate({ cmd: approveCmd(), ctx: ctx({ sinistre: s }), role: 'ceo' });
    expect(r.allow).toBe(false);
    expect(r.reason).toContain('statut_invalide');
  });

  it('3) amount above the requested cap (signed CEO) → deny', () => {
    // Undersized max: max_amount < claim/sinistre amount → deny even for the CEO.
    const s: SinistreRow = { id: 'CLM-1', statut: 'ouvert', montant_eur: 9000, compliance_bloque: false };
    const r = evaluate({ cmd: approveCmd({ max_amount_eur: 4000 }), ctx: ctx({ sinistre: s }), role: 'ceo' });
    expect(r.allow).toBe(false);
    expect(r.reason).toContain('montant');
  });

  it('4) command already consumed (idempotence) → deny', () => {
    const r = evaluate({ cmd: approveCmd(), ctx: ctx({ commandConsumed: true }), role: 'ceo' });
    expect(r.allow).toBe(false);
    expect(r.reason).toContain('commande_deja_consommee');
  });

  it('5) compliance flag on the case → deny', () => {
    const s: SinistreRow = { id: 'CLM-1', statut: 'ouvert', montant_eur: 100, compliance_bloque: true };
    const r = evaluate({ cmd: approveCmd(), ctx: ctx({ sinistre: s }), role: 'ceo' });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('conformite:dossier_bloque');
  });

  it('6) kill-switch active: every autonomous execution is blocked → deny', () => {
    const ks: KillSwitchRow = { id: 1, actif: true, active_par: CEO_HEX, active_le: '2026-08-02T00:00:00Z' };
    const r = evaluate({ cmd: approveCmd(), ctx: ctx({ killSwitch: ks }), role: 'ceo' });
    expect(r.allow).toBe(false);
    expect(r.reason).toContain('killswitch');
  });

  it('6b) kill-switch active: killswitch.deactivate is THE only one to pass', () => {
    const ks: KillSwitchRow = { id: 1, actif: true, active_par: CEO_HEX, active_le: '2026-08-02T00:00:00Z' };
    const deactivate: Command = {
      type: 'agent.killswitch.deactivate',
      approved_by: CEO_HEX,
      reason: 'resume',
      requested_at: '2026-08-02T01:00:00.000Z',
    };
    const r = evaluate({ cmd: deactivate, ctx: ctx({ killSwitch: ks }), role: 'ceo' });
    expect(r.allow).toBe(true);
  });

  it('7) (signature) verified outside evaluate — see pipeline/http; here the "unknown" role is deny', () => {
    // The Nostr signature is verified upstream (BuzzAdapter + POST /commands).
    // evaluate receives a resolved role; an unresolved author (signature KO → undetermined role) is denied.
    const r = evaluate({ cmd: approveCmd(), ctx: ctx(), role: 'inconnu' as Role });
    expect(r.allow).toBe(false);
  });

  it('allow path : CEO + sinistre valide sous plafond → allow', () => {
    const r = evaluate({ cmd: approveCmd(), ctx: ctx(), role: 'ceo' });
    expect(r.allow).toBe(true);
  });

  it('autonomy §6B: agent-sinistres under the threshold → ALLOW (approved_by agent)', () => {
    const cmd = approveCmd({ approved_by: AGENT_HEX, max_amount_eur: 2500 });
    const s: SinistreRow = { id: 'CLM-1', statut: 'ouvert', montant_eur: 2500, compliance_bloque: false };
    const r = evaluate({ cmd, ctx: ctx({ sinistre: s }), role: 'agent-sinistres' });
    expect(r.allow).toBe(true);
  });

  it("autonomy §6B: agent-sinistres ABOVE the threshold → DENY 'rbac:au_dessus_seuil_reserve_CEO'", () => {
    const s: SinistreRow = { id: 'CLM-1', statut: 'ouvert', montant_eur: 9000, compliance_bloque: false };
    const r = evaluate({
      cmd: approveCmd({ approved_by: AGENT_HEX, max_amount_eur: 9000 }),
      ctx: ctx({ sinistre: s }),
      role: 'agent-sinistres',
    });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('rbac:au_dessus_seuil_reserve_CEO');
  });

  it('autonomy §6B: signed CEO ABOVE the threshold (high max) → ALLOW', () => {
    const s: SinistreRow = { id: 'CLM-1', statut: 'ouvert', montant_eur: 9000, compliance_bloque: false };
    // The CEO can settle above: max_amount_eur covers the claim/sinistre.
    const r = evaluate({
      cmd: approveCmd({ max_amount_eur: 12000 }),
      ctx: ctx({ sinistre: s }),
      role: 'ceo',
    });
    expect(r.allow).toBe(true);
  });

  it('policy.pricing.exception.approve requires the CEO', () => {
    const cmd = {
      type: 'policy.pricing.exception.approve',
      contrat_id: 'CT-1',
      new_prime_eur: 450,
      reason: 'r',
      approved_by: AGENT_HEX,
      requested_at: '2026-08-02T01:00:00.000Z',
    } as Command;
    expect(evaluate({ cmd, ctx: ctx(), role: 'agent-sales' }).allow).toBe(false);
    expect(evaluate({ cmd, ctx: ctx(), role: 'agent-sinistres' }).allow).toBe(false);
    expect(evaluate({ cmd, ctx: ctx(), role: 'ceo' }).allow).toBe(true);
  });

  it('finance.report.request: sales denied, finance allowed', () => {
    const cmd = {
      type: 'finance.report.request',
      periode: '2026-07',
      departements: ['auto'],
      approved_by: AGENT_HEX,
      requested_at: '2026-08-02T01:00:00.000Z',
    } as Command;
    expect(evaluate({ cmd, ctx: ctx(), role: 'agent-sales' }).allow).toBe(false);
    expect(evaluate({ cmd, ctx: ctx(), role: 'finance' }).allow).toBe(true);
  });
});
