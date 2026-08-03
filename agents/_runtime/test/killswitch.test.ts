/**
 * Test 4: kill-switch active → the autonomous action is cleanly denied.
 * Couvre aussi le cache du kill-switch (fail-closed sur erreur de lecture).
 */
import { describe, it, expect } from 'vitest';
import { makeHarness, makeMemoryDb, silentLogger } from './helpers.js';
import { KillSwitch } from '../src/security/killswitch.js';

describe('kill-switch', () => {
  it('active → runTask denied, no tool call, no bridge POST', async () => {
    const { agent, posted, memoire } = makeHarness({
      role: 'sinistres-contentieux',
      tools: ['recommander_reglement'],
      killSwitchActive: true,
      chatResponses: [
        {
          toolCalls: [
            {
              id: 'call-0',
              name: 'recommander_reglement',
              arguments: { claim_id: '1', montant: 500, raison: 'test' },
            },
          ],
          text: '',
        },
      ],
    });

    const result = await agent.runTask({ title: 't', description: 'd' });

    expect(result.stoppedByKillSwitch).toBe(true);
    expect(result.toolCalls).toHaveLength(0);
    expect(result.summary).toMatch(/kill-switch/i);
    expect(posted).toHaveLength(0);
    expect(memoire).toHaveLength(0); // pas d'apprentissage
  });

  it('fail-closed: read error without cache → considered active', async () => {
    const { db } = makeMemoryDb({ killSwitchActive: false });
    // Sabotage the read: systematic throw.
    db.query = () => Promise.reject(new Error('pg down'));
    const ks = new KillSwitch(db, silentLogger());
    expect(await ks.isActive()).toBe(true);
  });

  it("the cache bounds polling to 2s", async () => {
    let reads = 0;
    const { db } = makeMemoryDb({ killSwitchActive: false });
    const baseQuery = db.query.bind(db);
    db.query = (sql, params) => {
      if (sql.includes('kill_switch')) reads += 1;
      return baseQuery(sql, params);
    };
    let fakeNow = 1_000;
    const ks = new KillSwitch(db, silentLogger(), 2_000, () => fakeNow);

    expect(await ks.isActive()).toBe(false);
    expect(await ks.isActive()).toBe(false);
    expect(reads).toBe(1); // served from cache

    fakeNow += 2_500; // cache expired (> 2s)
    expect(await ks.isActive()).toBe(false);
    expect(reads).toBe(2);
  });
});
