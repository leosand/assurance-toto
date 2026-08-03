/**
 * Test 1: the LLM emits a qualifier_lead tool call → it is parsed and executed.
 * (The brief mentions "score_lead"; the actual registry tool is qualifier_lead —
 * same mechanics: strict parsing of native tool_calls then execution.)
 */
import { describe, it, expect } from 'vitest';
import { makeHarness } from './helpers.js';

describe('agent loop — tool call parsing and execution', () => {
  it('parses and executes qualifier_lead with the scoring result', async () => {
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
      title: 'Qualify lead #42',
      description: 'Lead auto : homme 34 ans, citadine, banlieue, parrainage.',
    });

    expect(result.stoppedByKillSwitch).toBe(false);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.name).toBe('qualifier_lead');
    expect(result.toolCalls[0]?.ok).toBe(true);
    const r = result.toolCalls[0]?.result as { score: number; decision: string };
    expect(typeof r.score).toBe('number');
    expect(['qualifie', 'perdu']).toContain(r.decision);
    expect(r.score).toBeGreaterThan(0.6); // favorable profile → qualified
    // No candidate command → nothing posted to the bridge.
    expect(posted).toHaveLength(0);
    expect(result.summary).toContain('qualifier_lead');
  });
});
