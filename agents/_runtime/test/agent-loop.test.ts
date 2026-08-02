/**
 * Test 1 : le LLM émet un tool call qualifier_lead → il est parsé et exécuté.
 * (Le brief mentionne "score_lead" ; l'outil réel du registre est qualifier_lead —
 * même mécanique : parsing strict des tool_calls natifs puis exécution.)
 */
import { describe, it, expect } from 'vitest';
import { makeHarness } from './helpers.js';

describe('agent loop — tool call parsing et exécution', () => {
  it('parse et exécute qualifier_lead avec le résultat de scoring', async () => {
    const { agent, posted } = makeHarness({
      role: 'sales',
      tools: ['qualifier_lead'],
      chatResponses: [
        {
          toolCalls: [
            {
              id: 'call-0',
              name: 'qualifier_lead',
              arguments: {
                age_conducteur: 34,
                bonus_malus: 0.8,
                type_vehicule: 'citadine',
                zone: 'banlieue',
                source: 'parrainage',
              },
            },
          ],
          text: '',
        },
      ],
    });

    const result = await agent.runTask({
      title: 'Qualifier le lead n°42',
      description: 'Lead auto : homme 34 ans, citadine, banlieue, parrainage.',
    });

    expect(result.stoppedByKillSwitch).toBe(false);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.name).toBe('qualifier_lead');
    expect(result.toolCalls[0]?.ok).toBe(true);
    const r = result.toolCalls[0]?.result as { score: number; decision: string };
    expect(typeof r.score).toBe('number');
    expect(['qualifie', 'perdu']).toContain(r.decision);
    expect(r.score).toBeGreaterThan(0.6); // profil favorable → qualifié
    // Aucune commande candidate → rien posté au bridge.
    expect(posted).toHaveLength(0);
    expect(result.summary).toContain('qualifier_lead');
  });
});
