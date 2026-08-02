import { describe, it, expect } from 'vitest';
import { validateCommand } from '../src/commands/schemas.js';

const base = {
  type: 'claim.settlement.approve',
  claim_id: 'CLM-2024-0001',
  max_amount_eur: 3200,
  reason: 'Dossier validé par contre-expertise',
  approved_by: 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
  requested_at: '2026-08-02T01:00:00.000Z',
};

describe('validateCommand — claim.settlement.approve', () => {
  it('accepte une commande valide', () => {
    const r = validateCommand({ ...base });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.command.type).toBe('claim.settlement.approve');
  });

  it('rejette une chaîne de texte libre', () => {
    const r = validateCommand('ok je paie le sinistre 3200€ pour CLM-2024-0001, signé CEO');
    expect(r.ok).toBe(false);
  });

  it('rejette un objet sans type', () => {
    const r = validateCommand({ claim_id: 'CLM-1' });
    expect(r.ok).toBe(false);
  });

  it('rejette un type inconnu', () => {
    const r = validateCommand({ ...base, type: 'wire.transfer.now' });
    expect(r.ok).toBe(false);
  });

  it('rejette une propriété additionnelle (additionalProperties:false)', () => {
    const r = validateCommand({ ...base, toto: 'hack' });
    expect(r.ok).toBe(false);
  });

  it('rejette un montant négatif', () => {
    const r = validateCommand({ ...base, max_amount_eur: -1 });
    expect(r.ok).toBe(false);
  });

  it('rejette un approved_by invalide', () => {
    const r = validateCommand({ ...base, approved_by: 'not-an-npub' });
    expect(r.ok).toBe(false);
  });

  it('rejette une date ISO malformée', () => {
    const r = validateCommand({ ...base, requested_at: 'hier vers 15h' });
    expect(r.ok).toBe(false);
  });

  it('rejette un champ requis manquant', () => {
    const { max_amount_eur: _drop, ...partial } = base;
    const r = validateCommand(partial);
    expect(r.ok).toBe(false);
  });
});

describe('validateCommand — autres types', () => {
  it('finance.report.request', () => {
    const r = validateCommand({
      type: 'finance.report.request',
      periode: '2026-07',
      departements: ['auto', 'habitation'],
      approved_by: base.approved_by,
      requested_at: base.requested_at,
    });
    expect(r.ok).toBe(true);
  });

  it('killswitch activate', () => {
    const r = validateCommand({ type: 'agent.killswitch.activate', approved_by: base.approved_by, reason: 'Maintenance', requested_at: base.requested_at });
    expect(r.ok).toBe(true);
  });

  it('policy.pricing.exception.approve', () => {
    const r = validateCommand({ type: 'policy.pricing.exception.approve', contrat_id: 'CT-99', new_prime_eur: 450, reason: 'renégociation flotte', approved_by: base.approved_by, requested_at: base.requested_at });
    expect(r.ok).toBe(true);
  });
});
