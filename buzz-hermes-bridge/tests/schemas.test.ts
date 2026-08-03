import { describe, it, expect } from 'vitest';
import { validateCommand } from '../src/commands/schemas.js';

const base = {
  type: 'claim.settlement.approve',
  claim_id: 'CLM-2024-0001',
  max_amount_eur: 3200,
  reason: 'Case validated by counter-expertise',
  approved_by: 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
  requested_at: '2026-08-02T01:00:00.000Z',
};

describe('validateCommand — claim.settlement.approve', () => {
  it('accepts a valid command', () => {
    const r = validateCommand({ ...base });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.command.type).toBe('claim.settlement.approve');
  });

  it('rejects a free-text string', () => {
    const r = validateCommand('ok I pay the claim/sinistre 3200 EUR for CLM-2024-0001, signed CEO');
    expect(r.ok).toBe(false);
  });

  it('rejects an object without type', () => {
    const r = validateCommand({ claim_id: 'CLM-1' });
    expect(r.ok).toBe(false);
  });

  it('rejects an unknown type', () => {
    const r = validateCommand({ ...base, type: 'wire.transfer.now' });
    expect(r.ok).toBe(false);
  });

  it('rejects an additional property (additionalProperties:false)', () => {
    const r = validateCommand({ ...base, toto: 'hack' });
    expect(r.ok).toBe(false);
  });

  it('rejects a negative amount', () => {
    const r = validateCommand({ ...base, max_amount_eur: -1 });
    expect(r.ok).toBe(false);
  });

  it('rejette un approved_by invalide', () => {
    const r = validateCommand({ ...base, approved_by: 'not-an-npub' });
    expect(r.ok).toBe(false);
  });

  it('rejects a malformed ISO date', () => {
    const r = validateCommand({ ...base, requested_at: 'hier vers 15h' });
    expect(r.ok).toBe(false);
  });

  it('rejette un champ requis manquant', () => {
    const { max_amount_eur: _drop, ...partial } = base;
    const r = validateCommand(partial);
    expect(r.ok).toBe(false);
  });
});

describe('validateCommand — other types', () => {
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
    const r = validateCommand({ type: 'policy.pricing.exception.approve', contrat_id: 'CT-99', new_prime_eur: 450, reason: 'fleet renegotiation', approved_by: base.approved_by, requested_at: base.requested_at });
    expect(r.ok).toBe(true);
  });
});
