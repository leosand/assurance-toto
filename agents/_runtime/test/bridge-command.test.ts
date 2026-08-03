/**
 * Test 2: recommander_reglement produces a candidate claim.settlement.approve command
 * which is POSTed to the stubbed bridge, with correlation_id preserved and a body conforming
 * to the bridge's HttpCommandBodySchema / claimSettlementApprove schema.
 */
import { describe, it, expect } from 'vitest';
import { makeHarness } from './helpers.js';

describe('recommander_reglement → commande bridge', () => {
  it('POSTe au bridge {command, author_pubkey, correlation_id} conforme', async () => {
    const { agent, posted } = makeHarness({
      role: 'sinistres-contentieux',
      tools: ['lire_sinistre', 'recommander_reglement'],
      chatResponses: [
        {
          toolCalls: [
            {
              id: 'call-0',
              name: 'recommander_reglement',
              arguments: {
                claim_id: '128',
                montant: 2500,
                raison: 'Proven at-fault collision, body-shop quote 2500 EUR.',
              },
            },
          ],
          text: '',
        },
      ],
    });

    const givenCorrelation = '11111111-2222-4333-8444-555555555555';
    const result = await agent.runTask({
      title: 'Claim/sinistre 128 settlement',
      description: 'Propose a 2500 EUR settlement.',
      correlation_id: givenCorrelation,
    });

    // correlation_id preserved everywhere.
    expect(result.correlation_id).toBe(givenCorrelation);
    expect(posted).toHaveLength(1);
    const post = posted[0];
    expect(post).toBeDefined();
    if (post === undefined) return;
    expect(post.correlation_id).toBe(givenCorrelation);

    // Command body conforming to the bridge claimSettlementApprove schema.
    expect(post.command['type']).toBe('claim.settlement.approve');
    expect(post.command['claim_id']).toBe('128');
    expect(typeof post.command['max_amount_eur']).toBe('number');
    expect(post.command['max_amount_eur']).toBe(2500);
    expect(typeof post.command['reason']).toBe('string');
    // requested_at ISO date-time, approved_by = the AGENT's npub (autonomy §6B).
    expect(String(post.command['requested_at'])).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(post.command['approved_by']).toBe('npub1agenttest');

    // Structured result exposed to the caller.
    expect(result.command?.posted.ok).toBe(true);
    expect(result.command?.posted.httpStatus).toBe(200);

    // The settlement is ONE RECOMMENDATION: the tool result says so, no direct effect.
    const toolRes = result.toolCalls[0]?.result as { recommandation: string; escalation_ceo: boolean };
    expect(toolRes.recommandation).toBe('claim.settlement.approve');
    expect(toolRes.escalation_ceo).toBe(false); // 2500 < 5000
  });

  it('amount > threshold → escalation_ceo true + approval created (NO self-approve)', async () => {
    const { agent, posted, approvals } = makeHarness({
      role: 'sinistres-contentieux',
      tools: ['recommander_reglement'],
      chatResponses: [
        {
          toolCalls: [
            {
              id: 'call-0',
              name: 'recommander_reglement',
              arguments: { claim_id: '200', montant: 9000, raison: 'Total vehicle theft.' },
            },
          ],
          text: '',
        },
      ],
    });

    const givenCorrelation = '22222222-1111-4333-8444-666666666666';
    const result = await agent.runTask({
      title: 't',
      description: 'd',
      correlation_id: givenCorrelation,
    });

    const toolRes = result.toolCalls[0]?.result as {
      recommandation: string;
      escalation_ceo: boolean;
      seuil_eur: number;
    };
    expect(toolRes.escalation_ceo).toBe(true);
    expect(toolRes.seuil_eur).toBe(5000);
    expect(toolRes.recommandation).toBe('approbations.create');

    // No self-settled claim.settlement.approve above the threshold. ...
    expect(posted).toHaveLength(0);
    // ... instead, a 'en_attente' approval created for the CEO.
    expect(approvals).toHaveLength(1);
    const appro = approvals[0] as {
      type: string;
      claim_id: string;
      montant_eur: number;
      correlation_id: string;
      statut: string;
    };
    expect(appro.type).toBe('claim.settlement.approve');
    expect(appro.claim_id).toBe('200');
    expect(appro.montant_eur).toBe(9000);
    // Correlation id propagated up to the escalation.
    expect(appro.correlation_id).toBe(givenCorrelation);
    // The approval request is indeed posted "instead of" the command.
    expect(result.command?.posted.ok).toBe(true);
  });
});
