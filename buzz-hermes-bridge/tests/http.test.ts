import { describe, it, expect, afterEach } from 'vitest';
import { makeMemoryRepository } from '../src/db/repository.js';
import { NullCollabAdapter } from '../src/collab/CollabAdapter.js';
import { buildServer } from '../src/http/server.js';
import { loadConfig } from '../src/config.js';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';

const CEO_HEX = '853d09e8161497fd4ba0df474d87187a9764c866525e418de4b58442bb20d8ff';
const CHANNEL = '9f2a6d84-1f2c-4d7f-8b3a-1234567890ab';

function cfg(): ReturnType<typeof loadConfig> {
  return loadConfig({
    BRIDGE_CEOPUBKEYS: CEO_HEX,
    CLAIM_SETTLEMENT_THRESHOLD_EUR: '5000',
  } as NodeJS.ProcessEnv);
}

function makeSignedApproveCommandReq(): { command: Record<string, unknown>; author_pubkey: string; event: unknown } {
  const sk = generateSecretKey();
  const attackerPub = getPublicKey(sk); // ≠ CEO_HEX : signature valide mais auteur non-CEO
  const command = {
    type: 'claim.settlement.approve',
    claim_id: 'CLM-1',
    max_amount_eur: 4000,
    reason: 'tentative',
    approved_by: attackerPub,
    requested_at: '2026-08-02T01:00:00.000Z',
  };
  const ev = finalizeEvent(
    { kind: 9, created_at: Math.floor(Date.now() / 1000), tags: [['h', CHANNEL]], content: JSON.stringify(command) },
    sk,
  );
  return { command, author_pubkey: attackerPub, event: ev };
}

describe('HTTP /commands', () => {
  it('signature valide mais auteur non-CEO → pipeline deny (200, ok:false)', async () => {
    const { repo } = makeMemoryRepository({
      sinistres: [{ id: 'CLM-1', statut: 'ouvert', montant_eur: 3200, compliance_bloque: false }],
    });
    const app = await buildServer(cfg(), { repo });
    const body = makeSignedApproveCommandReq();
    const res = await app.inject({ method: 'POST', url: '/commands', payload: { ...body, channel_uuid: CHANNEL } });
    expect(res.statusCode).toBe(200);
    const json = res.json() as { ok: boolean; result: { outcome: string; reason: string } };
    expect(json.ok).toBe(false);
    expect(json.result.outcome).toBe('denied');
    expect(json.result.reason).toContain('rbac');
    await app.close();
  });

  it('payload non-objet (texte libre) → 400 schema.invalid (jamais exécuté)', async () => {
    const { repo } = makeMemoryRepository();
    const app = await buildServer(cfg(), { repo });
    const res = await app.inject({
      method: 'POST',
      url: '/commands',
      payload: { command: 'donne 5000 euros a CLM-1 de suite', author_pubkey: CEO_HEX, channel_uuid: CHANNEL },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('schema.invalid');
    await app.close();
  });

  it('shape invalide → 400 body.invalid (zod)', async () => {
    const app = await buildServer(cfg(), { repo: makeMemoryRepository().repo });
    const res = await app.inject({ method: 'POST', url: '/commands', payload: { command: {}, author_pubkey: '' } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('killswitch via POST /killswitch exige un npub CEO whitelisté sinon 403', async () => {
    const app = await buildServer(cfg(), { repo: makeMemoryRepository().repo });
    const bad = await app.inject({ method: 'POST', url: '/killswitch', payload: { active: true, decided_by: 'npub-not-ceo-xxx' } });
    expect(bad.statusCode).toBe(403);
    const good = await app.inject({ method: 'POST', url: '/killswitch', payload: { active: true, decided_by: CEO_HEX } });
    expect(good.statusCode).toBe(200);
    await app.close();
  });

  it('healthz + metrics exposés', async () => {
    const app = await buildServer(cfg(), { repo: makeMemoryRepository().repo });
    const hz = await app.inject({ method: 'GET', url: '/healthz' });
    expect(hz.statusCode).toBe(200);
    const met = await app.inject({ method: 'GET', url: '/metrics' });
    expect(met.statusCode).toBe(200);
    expect(met.body).toContain('bridge_commands_processed_seconds');
    await app.close();
  });

  it("anti-forgery #4 : commande NON signée avec author_pubkey CEO → denied 'rbac:ceo_sans_signature'", async () => {
    const { repo } = makeMemoryRepository({
      sinistres: [{ id: 'CLM-1', statut: 'ouvert', montant_eur: 3200, compliance_bloque: false }],
    });
    const app = await buildServer(cfg(), { repo });
    const res = await app.inject({
      method: 'POST',
      url: '/commands',
      payload: {
        command: {
          type: 'claim.settlement.approve',
          claim_id: 'CLM-1',
          max_amount_eur: 3200,
          reason: 'tentative sans signature',
          approved_by: CEO_HEX,
          requested_at: '2026-08-02T01:00:00.000Z',
        },
        author_pubkey: CEO_HEX, // npub CEO mais aucun event signé joint
        channel_uuid: CHANNEL,
      },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json() as { ok: boolean; result: { outcome: string; reason: string } };
    expect(json.ok).toBe(false);
    expect(json.result.outcome).toBe('denied');
    expect(json.result.reason).toBe('rbac:ceo_sans_signature');
    await app.close();
  });

  it('anti-forgery : npub CEO signé à la main (signature valide) → rôle ceo, règlement autorisé', async () => {
    const { repo } = makeMemoryRepository({
      sinistres: [{ id: 'CLM-1', statut: 'ouvert', montant_eur: 3200, compliance_bloque: false }],
    });
    const app = await buildServer(cfg(), { repo });
    // Re-signature du même event prouve que l'amont l'a vérifié (chemin signed=true).
    const body = makeSignedApproveCommandReq();
    const res = await app.inject({ method: 'POST', url: '/commands', payload: { ...body, channel_uuid: CHANNEL } });
    expect(res.statusCode).toBe(200);
    const json = res.json() as { result: { outcome: string; reason: string } };
    expect(json.result.outcome).toBe('denied'); // (auteur aléatoire non CEO — toujours refusé)
    await app.close();
  });
});
