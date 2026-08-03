/**
 * Test 6: the LLM emits no tool call (free text) → graceful structured fallback,
 * no crash, no bridge POST, memory learning written anyway.
 */
import { describe, it, expect } from 'vitest';
import { makeHarness } from './helpers.js';

describe('structured fallback without tool calls', () => {
  it('no tool_calls → clean TaskResult with fallbackText, no crash', async () => {
    const { agent, posted, memoire } = makeHarness({
      role: 'sales',
      tools: ['qualifier_lead'],
      chatResponses: [{ toolCalls: [], text: 'No relevant action for this task.' }],
    });

    const result = await agent.runTask({
      title: 'General question',
      description: 'What is the escalation cap?',
    });

    expect(result.stoppedByKillSwitch).toBe(false);
    expect(result.toolCalls).toHaveLength(0);
    expect(result.fallbackText).toBe('No relevant action for this task.');
    expect(result.summary).toMatch(/fallback/i);
    expect(result.command).toBeUndefined();
    expect(posted).toHaveLength(0);
    // Learning is written (memoire_agents) even without a tool.
    expect(memoire).toHaveLength(1);
    expect(memoire[0]?.nature).toBe('apprentissage_tache');
    expect(memoire[0]?.departement).toBe('sales');
  });

  it('empty text AND no tool call → still no crash', async () => {
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
