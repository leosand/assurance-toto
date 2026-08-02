/**
 * Test 2 : recommander_reglement produit une candidate command claim.settlement.approve
 * qui est POSTée au bridge stubbé, avec correlation_id préservé et corps conforme
 * au schéma HttpCommandBodySchema / claimSettlementApprove du bridge.
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
                raison: 'Collision responsable prouvée, devis carrossier 2500 EUR.',
              },
            },
          ],
          text: '',
        },
      ],
    });

    const givenCorrelation = '11111111-2222-4333-8444-555555555555';
    const result = await agent.runTask({
      title: 'Règlement sinistre 128',
      description: 'Proposer un règlement de 2500 EUR.',
      correlation_id: givenCorrelation,
    });

    // Correlation_id préservé partout.
    expect(result.correlation_id).toBe(givenCorrelation);
    expect(posted).toHaveLength(1);
    const post = posted[0];
    expect(post).toBeDefined();
    if (post === undefined) return;
    expect(post.correlation_id).toBe(givenCorrelation);

    // Corps commande conforme au schéma claimSettlementApprove du bridge.
    expect(post.command['type']).toBe('claim.settlement.approve');
    expect(post.command['claim_id']).toBe('128');
    expect(typeof post.command['max_amount_eur']).toBe('number');
    expect(post.command['max_amount_eur']).toBe(2500);
    expect(typeof post.command['reason']).toBe('string');
    // requested_at date-time ISO, approved_by = npub de l'AGENT (autonomie §6B).
    expect(String(post.command['requested_at'])).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(post.command['approved_by']).toBe('npub1agenttest');

    // Résultat structuré exposé à l'appelant.
    expect(result.command?.posted.ok).toBe(true);
    expect(result.command?.posted.httpStatus).toBe(200);

    // Le règlement est UNE RECOMMANDATION : le résultat d'outil le signale, pas d'effet direct.
    const toolRes = result.toolCalls[0]?.result as { recommandation: string; escalation_ceo: boolean };
    expect(toolRes.recommandation).toBe('claim.settlement.approve');
    expect(toolRes.escalation_ceo).toBe(false); // 2500 < 5000
  });

  it('montant > seuil → escalation_ceo true + approbation créée (AUCUN self-approve)', async () => {
    const { agent, posted, approvals } = makeHarness({
      role: 'sinistres-contentieux',
      tools: ['recommander_reglement'],
      chatResponses: [
        {
          toolCalls: [
            {
              id: 'call-0',
              name: 'recommander_reglement',
              arguments: { claim_id: '200', montant: 9000, raison: 'Vol total véhicule.' },
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

    // Pas de claim.settlement.approve auto-réglé au-dessus du seuil. ...
    expect(posted).toHaveLength(0);
    // ... à la place, une approbation 'en_attente' créée pour le CEO.
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
    // Correlation id propagate jusqu'à l'escalade.
    expect(appro.correlation_id).toBe(givenCorrelation);
    // La requête d'approbation est bien postée “à la place” de la commande.
    expect(result.command?.posted.ok).toBe(true);
  });
});
