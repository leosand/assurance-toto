import { describe, it, expect } from 'vitest';
import { makeMemoryRepository, type Repository } from '../src/db/repository.js';
import { buildServer } from '../src/http/server.js';
import { loadConfig } from '../src/config.js';

const CEO_HEX = '853d09e8161497fd4ba0df474d87187a9764c866525e418de4b58442bb20d8ff';

function cfg(): ReturnType<typeof loadConfig> {
  return loadConfig({
    BRIDGE_CEOPUBKEYS: CEO_HEX,
    CLAIM_SETTLEMENT_THRESHOLD_EUR: '5000',
  } as NodeJS.ProcessEnv);
}

describe('GET /dashboard (cockpit CEO, ADR-002)', () => {
  it('retourne 200 HTML avec les libellés clés (FR) et le badge DÉMO', async () => {
    const { repo } = makeMemoryRepository();
    const app = await buildServer(cfg(), { repo });
    const res = await app.inject({ method: 'GET', url: '/dashboard' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    const html = res.body;
    expect(html).toContain('Assurance Toto');
    expect(html).toContain('Cockpit CEO');
    expect(html).toContain('DÉMO');
    expect(html).toContain('P&amp;L');
    expect(html).toContain('Pipeline commercial');
    expect(html).toContain('Sinistres');
    expect(html).toContain('Approbations CEO');
    expect(html).toContain('anonymisation');
    expect(html).toContain('kill-switch');
    expect(html).toContain('Timeline audit');
    expect(html).toContain('http-equiv="refresh"');
    await app.close();
  });

  it('affiche les approbations en attente seedées (avec correlation_id et montant)', async () => {
    const { repo } = makeMemoryRepository();
    await repo.createApprobation({
      correlationId: 'a3f1c2d4-0000-4000-8000-0000000000aa',
      type: 'claim.settlement.approve',
      claimId: 'CLM-42',
      montantEur: 7200,
      requestedBy: 'agent-sinistres',
    });
    await repo.createApprobation({
      correlationId: 'a3f1c2d4-0000-4000-8000-0000000000bb',
      type: 'claim.settlement.approve',
      claimId: 'CLM-77',
      montantEur: 15000,
      requestedBy: 'agent-sinistres',
    });
    const app = await buildServer(cfg(), { repo });
    const res = await app.inject({ method: 'GET', url: '/dashboard' });
    expect(res.statusCode).toBe(200);
    const html = res.body;
    expect(html).toContain('a3f1c2d4-0000-4000-8000-0000000000aa');
    expect(html).toContain('a3f1c2d4-0000-4000-8000-0000000000bb');
    expect(html).toContain('CLM-42');
    // Compteur « en attente » proéminent
    expect(html).toMatch(/class="count-big bad">2</);
    // Les formulaires de décision pointent vers l'endpoint existant avec le npub CEO de config
    expect(html).toContain('/approvals/a3f1c2d4-0000-4000-8000-0000000000aa/decide');
    expect(html).toContain(CEO_HEX);
    await app.close();
  });

  it('rend l’état kill-switch (banner rouge quand actif)', async () => {
    const { repo } = makeMemoryRepository({ killSwitch: { id: 1, actif: true, active_par: CEO_HEX, active_le: new Date().toISOString() } });
    const app = await buildServer(cfg(), { repo });
    const res = await app.inject({ method: 'GET', url: '/dashboard' });
    expect(res.body).toContain('KILL-SWITCH ACTIF');
    expect(res.body).toContain('ks-on');
    await app.close();
  });

  it('rend l’état kill-switch inactif (état PASS vert)', async () => {
    const { repo } = makeMemoryRepository({ killSwitch: { id: 1, actif: false, active_par: null, active_le: null } });
    const app = await buildServer(cfg(), { repo });
    const res = await app.inject({ method: 'GET', url: '/dashboard' });
    expect(res.body).toContain('kill-switch inactif');
    expect(res.body).toContain('ks-ok');
    await app.close();
  });

  it('P&L et audit seedés dans le repo en mémoire sont rendus (résultat, ratio, timeline)', async () => {
    const { repo } = makeMemoryRepository();
    await repo.inTransaction(async (tx) => {
      await tx.query(
        'INSERT INTO pnl_ledger (correlation_id, departement, categorie, montant, description) VALUES ($1,$2,$3,$4,$5)',
        ['b1b1b1b1-0000-4000-8000-000000000001', 'auto', 'prime', 12000, 'primes auto'],
      );
      await tx.query(
        'INSERT INTO pnl_ledger (correlation_id, departement, categorie, montant, description) VALUES ($1,$2,$3,$4,$5)',
        ['b1b1b1b1-0000-4000-8000-000000000002', 'auto', 'reglement', -4500, 'règlement sinistre'],
      );
    });
    await repo.appendAudit('b1b1b1b1-0000-4000-8000-000000000001', 'hermes', 'anonymisation.pseudo', { ok: true }, 'h1', 'h0');
    const app = await buildServer(cfg(), { repo });
    const res = await app.inject({ url: '/dashboard' });
    const html = res.body;
    // 12 000 − 4 500 = 7 500 € cumulé
    expect(html).toContain('7');
    expect(html).toMatch(/37[,.]5\s?%/); // ratio sinistralité auto = 4500/12000
    expect(html).toContain('anonymisation.pseudo');
    expect(html).toContain('b1b1b1b1-0000-4000-8000-000000000001');
    // Le compteur conformité remonte l'événement d'anonymisation
    expect(html).toMatch(/<strong>1<\/strong> événement/);
    await app.close();
  });

  it('surligne la ligne correspondant à ?correlation_id=', async () => {
    const { repo } = makeMemoryRepository();
    await repo.createApprobation({
      correlationId: 'c9c9c9c9-0000-4000-8000-0000000000cc',
      type: 'claim.settlement.approve',
      claimId: 'CLM-9',
      montantEur: 900,
      requestedBy: 'agent-x',
    });
    const app = await buildServer(cfg(), { repo });
    const res = await app.inject({ url: '/dashboard?correlation_id=c9c9c9c9-0000-4000-8000-0000000000cc' });
    expect(res.body).toContain('<tr class="hl">');
    await app.close();
  });

  it('section en erreur → "indisponible", la page ne 500 pas', async () => {
    const { repo } = makeMemoryRepository();
    const broken: Repository = {
      ...repo,
      dashboardSnapshot: () => Promise.reject(new Error('pg down')),
    };
    const app = await buildServer(cfg(), { repo: broken });
    const res = await app.inject({ url: '/dashboard' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('indisponible');
    await app.close();
  });

  it('le formulaire CEO poste sur /decide (html form-urlencoded) → redirect vers /dashboard', async () => {
    const { repo } = makeMemoryRepository();
    await repo.createApprobation({
      correlationId: 'd7d7d7d7-0000-4000-8000-0000000000dd',
      type: 'claim.settlement.approve',
      claimId: 'CLM-99',
      montantEur: 9000,
      requestedBy: 'agent-sinistres',
    });
    const app = await buildServer(cfg(), { repo });
    const res = await app.inject({
      method: 'POST',
      url: '/approvals/d7d7d7d7-0000-4000-8000-0000000000dd/decide',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
      payload: `approve=true&reason=${encodeURIComponent('ok démo')}&decided_by=${CEO_HEX}`,
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('/dashboard');
    const decided = (await repo.listApprovals('approuve')).find((a) => a.correlation_id === 'd7d7d7d7-0000-4000-8000-0000000000dd');
    expect(decided).toBeDefined();
    expect(decided?.decided_by).toBe(CEO_HEX);
    await app.close();
  });

  it('POST /decide avec un npub non-CEO reste refusé (whitelist)', async () => {
    const { repo } = makeMemoryRepository();
    await repo.createApprobation({
      correlationId: 'e3e3e3e3-0000-4000-8000-0000000000ee',
      type: 'claim.settlement.approve',
      claimId: 'CLM-1',
      montantEur: 100,
      requestedBy: 'agent-x',
    });
    const app = await buildServer(cfg(), { repo });
    const res = await app.inject({
      method: 'POST',
      url: '/approvals/e3e3e3e3-0000-4000-8000-0000000000ee/decide',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
      payload: 'approve=true&reason=tentative&decided_by=deadbeef',
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
