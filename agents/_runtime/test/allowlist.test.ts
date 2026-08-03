/**
 * Test 3: the allowlist blocks (deny-by-default) an unauthorized tool requested by the LLM.
 */
import { describe, it, expect } from 'vitest';
import { makeHarness } from './helpers.js';
import { assertAllowed, createAllowlist, EMPTY_ALLOWLIST } from '../src/security/allowlist.js';

describe('allowlist deny-by-default', () => {
  it('assertAllowed throws on an unlisted tool', () => {
    const al = createAllowlist({ tools: ['lire_client'] });
    expect(() => assertAllowed(al, 'lire_client')).not.toThrow();
    expect(() => assertAllowed(al, 'ecrire_contrat')).toThrow(/allowlist/i);
    expect(() => assertAllowed(EMPTY_ALLOWLIST, 'lire_client')).toThrow(/allowlist/i);
  });

  it("the LLM requests a forbidden tool → denied, never executed", async () => {
    // Sales agent WITHOUT 'recommander_reglement' in its allowlist.
    const { agent, posted } = makeHarness({
      role: 'sales',
      tools: ['qualifier_lead', 'lire_client'],
      chatResponses: [
        {
          // Iteration 1: tries a forbidden tool...
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
          // Iteration 2: the stub would replay the same attempt → text fallback to finish.
          toolCalls: [],
          text: 'I cannot recommend a settlement.',
        },
      ],
    });

    const result = await agent.runTask({ title: 't', description: 'd' });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.name).toBe('recommander_reglement');
    expect(result.toolCalls[0]?.ok).toBe(false);
    const r = result.toolCalls[0]?.result as { error: string };
    expect(r.error).toMatch(/not allowed|denied/i);
    // NOTHING was posted to the bridge.
    expect(posted).toHaveLength(0);
  });
});
