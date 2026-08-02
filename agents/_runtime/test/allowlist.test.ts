/**
 * Test 3 : l'allowlist bloque (deny-by-default) un outil non autorisé demandé par le LLM.
 */
import { describe, it, expect } from 'vitest';
import { makeHarness } from './helpers.js';
import { assertAllowed, createAllowlist, EMPTY_ALLOWLIST } from '../src/security/allowlist.js';

describe('allowlist deny-by-default', () => {
  it('assertAllowed lève sur un outil non listé', () => {
    const al = createAllowlist({ tools: ['lire_client'] });
    expect(() => assertAllowed(al, 'lire_client')).not.toThrow();
    expect(() => assertAllowed(al, 'ecrire_contrat')).toThrow(/allowlist/i);
    expect(() => assertAllowed(EMPTY_ALLOWLIST, 'lire_client')).toThrow(/allowlist/i);
  });

  it("le LLM demande un outil interdit → refusé, jamais exécuté", async () => {
    // Agent sales SANS 'recommander_reglement' dans son allowlist.
    const { agent, posted } = makeHarness({
      role: 'sales',
      tools: ['qualifier_lead', 'lire_client'],
      chatResponses: [
        {
          // Itération 1 : tente un outil interdit...
          toolCalls: [
            {
              id: 'call-0',
              name: 'recommander_reglement',
              arguments: { claim_id: '1', montant: 10, raison: 'x' },
            },
          ],
          text: '',
        },
        {
          // Itération 2 : le stub rejouerait le même essai → fallback texte pour finir.
          toolCalls: [],
          text: 'Je ne peux pas recommander de règlement.',
        },
      ],
    });

    const result = await agent.runTask({ title: 't', description: 'd' });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.name).toBe('recommander_reglement');
    expect(result.toolCalls[0]?.ok).toBe(false);
    const r = result.toolCalls[0]?.result as { error: string };
    expect(r.error).toMatch(/non autorisé/i);
    // RIEN n'a été posté au bridge.
    expect(posted).toHaveLength(0);
  });
});
