/**
 * Test 6 : le LLM n'émet aucun tool call (texte libre) → fallback structuré gracieux,
 * aucun crash, aucun POST bridge, apprentissage mémoire quand même écrit.
 */
import { describe, it, expect } from 'vitest';
import { makeHarness } from './helpers.js';

describe('fallback structuré sans tool calls', () => {
  it('aucun tool_calls → TaskResult propre avec fallbackText, pas de crash', async () => {
    const { agent, posted, memoire } = makeHarness({
      role: 'sales',
      tools: ['qualifier_lead'],
      chatResponses: [{ toolCalls: [], text: 'Aucune action pertinente pour cette tâche.' }],
    });

    const result = await agent.runTask({
      title: 'Question générale',
      description: 'Quel est le plafond d’escalade ?',
    });

    expect(result.stoppedByKillSwitch).toBe(false);
    expect(result.toolCalls).toHaveLength(0);
    expect(result.fallbackText).toBe('Aucune action pertinente pour cette tâche.');
    expect(result.summary).toMatch(/fallback/i);
    expect(result.command).toBeUndefined();
    expect(posted).toHaveLength(0);
    // L'apprentissage est écrit (mémoire_agents) même sans outil.
    expect(memoire).toHaveLength(1);
    expect(memoire[0]?.nature).toBe('apprentissage_tache');
    expect(memoire[0]?.departement).toBe('sales');
  });

  it('texte vide ET aucun tool call → toujours pas de crash', async () => {
    const { agent } = makeHarness({
      role: 'orchestrateur',
      tools: ['requeter_pnl'],
      chatResponses: [{ toolCalls: [], text: '' }],
    });
    const result = await agent.runTask({ title: 't', description: 'd' });
    expect(result.toolCalls).toHaveLength(0);
    expect(result.fallbackText).toBeUndefined();
    expect(result.summary.length).toBeGreaterThan(0);
  });
});
