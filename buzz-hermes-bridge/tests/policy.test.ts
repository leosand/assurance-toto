import { describe, it, expect, beforeEach } from 'vitest';
import { evaluate, type Role } from '../src/policy/policy.js';
import type { PolicyContext, SinistreRow, KillSwitchRow } from '../src/db/repository.js';
import type { Command } from '../src/commands/schemas.js';

// Clés synthétiques (jamais réutilisées ailleurs). CEO hex autorisé par la config.
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

describe('policy.evaluate — 7 règles de déni + allow (autonomie agent §6B)', () => {
  it("1) rôle non autorisé (sales) → deny 'rbac:reglement_non_autorise_pour_role'", () => {
    const r = evaluate({ cmd: approveCmd(), ctx: ctx(), role: 'agent-sales' });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('rbac:reglement_non_autorise_pour_role');
  });

  it('2) sinistre introuvable → deny', () => {
    const r = evaluate({ cmd: approveCmd(), ctx: ctx({ sinistre: null }), role: 'ceo' });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('sinistre:introuvable');
  });

  it('2b) sinistre dans un mauvais état → deny', () => {
    const s: SinistreRow = { id: 'CLM-1', statut: 'regle', montant_eur: 100, compliance_bloque: false };
    const r = evaluate({ cmd: approveCmd(), ctx: ctx({ sinistre: s }), role: 'ceo' });
    expect(r.allow).toBe(false);
    expect(r.reason).toContain('statut_invalide');
  });

  it('3) montant supérieur au plafond demandé (CEO signé) → deny', () => {
    // Sous-dimensionnement du max : max_amount < montant du sinistre → deny même CEO.
    const s: SinistreRow = { id: 'CLM-1', statut: 'ouvert', montant_eur: 9000, compliance_bloque: false };
    const r = evaluate({ cmd: approveCmd({ max_amount_eur: 4000 }), ctx: ctx({ sinistre: s }), role: 'ceo' });
    expect(r.allow).toBe(false);
    expect(r.reason).toContain('montant');
  });

  it('4) commande déjà consommée (idempotence) → deny', () => {
    const r = evaluate({ cmd: approveCmd(), ctx: ctx({ commandConsumed: true }), role: 'ceo' });
    expect(r.allow).toBe(false);
    expect(r.reason).toContain('commande_deja_consommee');
  });

  it('5) flag conformité sur le dossier → deny', () => {
    const s: SinistreRow = { id: 'CLM-1', statut: 'ouvert', montant_eur: 100, compliance_bloque: true };
    const r = evaluate({ cmd: approveCmd(), ctx: ctx({ sinistre: s }), role: 'ceo' });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('conformite:dossier_bloque');
  });

  it('6) kill-switch actif : toute exécution autonome est bloquée → deny', () => {
    const ks: KillSwitchRow = { id: 1, actif: true, active_par: CEO_HEX, active_le: '2026-08-02T00:00:00Z' };
    const r = evaluate({ cmd: approveCmd(), ctx: ctx({ killSwitch: ks }), role: 'ceo' });
    expect(r.allow).toBe(false);
    expect(r.reason).toContain('killswitch');
  });

  it('6b) kill-switch actif : killswitch.deactivate est LE seul à passer', () => {
    const ks: KillSwitchRow = { id: 1, actif: true, active_par: CEO_HEX, active_le: '2026-08-02T00:00:00Z' };
    const deactivate: Command = {
      type: 'agent.killswitch.deactivate',
      approved_by: CEO_HEX,
      reason: 'reprise',
      requested_at: '2026-08-02T01:00:00.000Z',
    };
    const r = evaluate({ cmd: deactivate, ctx: ctx({ killSwitch: ks }), role: 'ceo' });
    expect(r.allow).toBe(true);
  });

  it('7) (signature) vérifiée hors evaluate — voir pipeline/http; ici le rôle "inconnu" est deny', () => {
    // La signature Nostr est vérifiée en amont (BuzzAdapter + POST /commands).
    // evaluate reçoit un rôle résolu ; un auteur non résolu (signature KO → rôle indéterminé) est deny.
    const r = evaluate({ cmd: approveCmd(), ctx: ctx(), role: 'inconnu' as Role });
    expect(r.allow).toBe(false);
  });

  it('allow path : CEO + sinistre valide sous plafond → allow', () => {
    const r = evaluate({ cmd: approveCmd(), ctx: ctx(), role: 'ceo' });
    expect(r.allow).toBe(true);
  });

  it('autonomie §6B : agent-sinistres sous le seuil → ALLOW (approved_by agent)', () => {
    const cmd = approveCmd({ approved_by: AGENT_HEX, max_amount_eur: 2500 });
    const s: SinistreRow = { id: 'CLM-1', statut: 'ouvert', montant_eur: 2500, compliance_bloque: false };
    const r = evaluate({ cmd, ctx: ctx({ sinistre: s }), role: 'agent-sinistres' });
    expect(r.allow).toBe(true);
  });

  it("autonomie §6B : agent-sinistres AU-DESSUS du seuil → DENY 'rbac:au_dessus_seuil_reserve_CEO'", () => {
    const s: SinistreRow = { id: 'CLM-1', statut: 'ouvert', montant_eur: 9000, compliance_bloque: false };
    const r = evaluate({
      cmd: approveCmd({ approved_by: AGENT_HEX, max_amount_eur: 9000 }),
      ctx: ctx({ sinistre: s }),
      role: 'agent-sinistres',
    });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('rbac:au_dessus_seuil_reserve_CEO');
  });

  it('autonomie §6B : CEO signé AU-DESSUS du seuil (max élevé) → ALLOW', () => {
    const s: SinistreRow = { id: 'CLM-1', statut: 'ouvert', montant_eur: 9000, compliance_bloque: false };
    // Le CEO peut régler au-dessus : max_amount_eur couvre le sinistre.
    const r = evaluate({
      cmd: approveCmd({ max_amount_eur: 12000 }),
      ctx: ctx({ sinistre: s }),
      role: 'ceo',
    });
    expect(r.allow).toBe(true);
  });

  it('policy.pricing.exception.approve exige CEO', () => {
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

  it('finance.report.request : sales refusé, finance autorisé', () => {
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
