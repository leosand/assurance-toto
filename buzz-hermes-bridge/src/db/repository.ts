/**
 * Repository seam: deep module hiding Postgres behind a small interface.
 * Unit tests swap in an in-memory implementation — no Docker/pg required.
 * Toutes les requêtes métier vivent ici, jamais dans la pipeline.
 */
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import type { BridgeConfig } from '../config.js';
import type { Command } from '../commands/schemas.js';
import type { PipelineResult } from '../pipeline.js';

// ---------- domain row types ----------
export interface SinistreRow {
  id: string;
  statut: string;
  montant_eur: number;
  compliance_bloque: boolean;
}

export interface ApprobationRow {
  id: string;
  correlation_id: string;
  type: string;
  claim_id: string | null;
  montant_eur: number | null;
  statut: 'en_attente' | 'approuve' | 'refuse' | 'expire';
  requested_by: string | null;
  decided_by: string | null;
  reason: string | null;
  decided_at: string | null;
  created_at: string;
  /** Résultat de l'exécution après décision 'approuve' (§6B : chaîne apiidecide→claim.settlement.approve). */
  execution?: PipelineResult['outcome'];
}

export interface KillSwitchRow {
  id: number;
  actif: boolean;
  active_par: string | null;
  active_le: string | null;
}

/** Contexte minimal consommé par la politique de décision. */
export interface PolicyContext {
  killSwitch: KillSwitchRow | null;
  sinistre: SinistreRow | null;
  commandConsumed: boolean;
  approbation: ApprobationRow | null;
  thresholdEur: number;
}

export interface Tx {
  query<R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<R>>;
}

/** Effet métier appliqué dans la transaction Postgres. */
export interface Repository {
  ping(): Promise<boolean>;
  findSinistre(claimId: string): Promise<SinistreRow | null>;
  isCommandConsumed(commandId: string): Promise<boolean>;
  getKillSwitch(): Promise<KillSwitchRow | null>;
  appendAudit(correlationId: string, source: string, action: string, payload: unknown, hash: string, prevHash: string): Promise<void>;
  inTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  listApprovals(statut?: ApprobationRow['statut'], limit?: number): Promise<ApprobationRow[]>;
  /** Crée une approbation 'en_attente' (escalade CEO depuis un agent, brief §6B). */
  createApprobation(input: {
    correlationId: string;
    type: string;
    claimId?: string | null;
    montantEur?: number | null;
    reason?: string | null;
    requestedBy?: string | null;
  }): Promise<ApprobationRow>;
  decideApprobation(correlationId: string, decidedBy: string, reason: string, approve: boolean): Promise<ApprobationRow | null>;
  setKillSwitch(actif: boolean, activePar: string): Promise<void>;
  /** Snapshot lecture seule pour le cockpit CEO (ADR-002) — aucune mutation. */
  dashboardSnapshot(): Promise<DashboardSnapshot>;
  close(): Promise<void>;
}

// ---------- types lecture seule du cockpit CEO (/dashboard, ADR-002) ----------
/** Fraîcheur d'une section : date la plus récente observée dans les données sources. */
export interface SectionFreshness {
  latest: string | null;
}

export interface PnlSummary {
  resultat_cumule: number;
  nb_ecritures: number;
  latest: string | null;
}

export interface PnlWeeklyRow {
  semaine_iso: string;
  departement: string;
  resultat_net: number;
}

export interface RatioSinistraliteRow {
  departement: string;
  ratio: number | null;
}

export interface PipelineStats {
  leads: number | null; // null = non dérivable du schéma actuel (pas de table leads)
  contrats: number;
  clients: number;
  latest: string | null;
}

export interface SinistreStatsRow {
  statut: string;
  nb: number;
  montant: number; // Σ COALESCE(montant_regle, montant_estime) par statut
}

export interface SinistresStats {
  rows: SinistreStatsRow[];
  latest: string | null;
}

export interface MacroIndicateurRow {
  indicateur: string;
  valeur: number | null;
  periode: string | null;
  source: string | null;
  created_at: string;
}

export interface AnonymisationStats {
  count: number; // entrées audit_log dont action/payload mentionne l'anonymisation
  tracked: boolean; // false si le comptage n'a pas pu être établi
}

export interface AuditTimelineRow {
  created_at: string;
  source: string;
  action: string;
  correlation_id: string | null;
}

export interface DashboardSnapshot {
  pnl: PnlSummary;
  pnlHebdo: PnlWeeklyRow[];
  ratios: RatioSinistraliteRow[];
  pipeline: PipelineStats;
  sinistres: SinistresStats;
  approbationsEnAttente: ApprobationRow[];
  macro: MacroIndicateurRow[];
  anonymisation: AnonymisationStats;
  killSwitch: KillSwitchRow | null;
  timeline: AuditTimelineRow[];
}

export class FatalRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FatalRepositoryError';
  }
}

export class PgRepository implements Repository {
  private readonly pool: Pool;

  constructor(cfg: BridgeConfig) {
    this.pool = new Pool({ connectionString: cfg.databaseUrl, max: 10 });
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async findSinistre(claimId: string): Promise<SinistreRow | null> {
    const r = await this.pool.query<SinistreRow>(
      'SELECT id::text AS id, statut, montant_eur, compliance_bloque FROM sinistres WHERE id = $1 LIMIT 1',
      [claimId],
    );
    return r.rows[0] ?? null;
  }

  async isCommandConsumed(commandId: string): Promise<boolean> {
    const r = await this.pool.query('SELECT 1 FROM commandes_consommees WHERE command_id = $1 LIMIT 1', [commandId]);
    return r.rowCount !== null && r.rowCount > 0;
  }

  async getKillSwitch(): Promise<KillSwitchRow | null> {
    const r = await this.pool.query<KillSwitchRow>('SELECT id, actif, active_par, active_le::text FROM kill_switch WHERE id = 1');
    return r.rows[0] ?? null;
  }

  async appendAudit(
    correlationId: string,
    source: string,
    action: string,
    payload: unknown,
    hash: string,
    prevHash: string,
  ): Promise<void> {
    await this.pool.query(
      'INSERT INTO audit_log (correlation_id, source, action, payload, prev_hash, hash) VALUES ($1,$2,$3,$4,$5,$6)',
      [correlationId, source, action, JSON.stringify(payload ?? {}), prevHash, hash],
    );
  }

  async inTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn({ query: (t, p) => client.query(t, p) });
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async listApprovals(statut: ApprobationRow['statut'] = 'en_attente', limit = 50): Promise<ApprobationRow[]> {
    const r = await this.pool.query<ApprobationRow>(
      `SELECT id::text, correlation_id::text, type, claim_id, montant_eur, statut,
              requested_by, decided_by, reason, decided_at::text, created_at::text
         FROM approbations
        WHERE statut = $1
        ORDER BY created_at ASC
        LIMIT $2`,
      [statut, limit],
    );
    return r.rows;
  }

  async createApprobation(input: {
    correlationId: string;
    type: string;
    claimId?: string | null;
    montantEur?: number | null;
    reason?: string | null;
    requestedBy?: string | null;
  }): Promise<ApprobationRow> {
    const r = await this.pool.query<ApprobationRow>(
      `INSERT INTO approbations (correlation_id, type, claim_id, montant_eur, statut, reason, requested_by)
       VALUES ($1, $2, $3, $4, 'en_attente', $5, $6)
       ON CONFLICT (correlation_id) DO NOTHING
       RETURNING id::text, correlation_id::text, type, claim_id, montant_eur, statut, requested_by, decided_by, reason, decided_at::text, created_at::text`,
      [input.correlationId, input.type, input.claimId ?? null, input.montantEur ?? null, input.reason ?? null, input.requestedBy ?? null],
    );
    return r.rows[0] as ApprobationRow;
  }

  async decideApprobation(correlationId: string, decidedBy: string, reason: string, approve: boolean): Promise<ApprobationRow | null> {
    const r = await this.pool.query<ApprobationRow>(
      `UPDATE approbations
          SET statut = $2, decided_by = $3, reason = $4, decided_at = NOW()
        WHERE correlation_id = $1 AND statut = 'en_attente'
        RETURNING id::text, correlation_id::text, type, claim_id, montant_eur, statut, requested_by, decided_by, reason, decided_at::text, created_at::text`,
      [correlationId, approve ? 'approuve' : 'refuse', decidedBy, reason],
    );
    return r.rows[0] ?? null;
  }

  async setKillSwitch(actif: boolean, activePar: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO kill_switch (id, actif, active_par, active_le) VALUES (1, $1, $2, NOW())
       ON CONFLICT (id) DO UPDATE SET actif = $1, active_par = $2, active_le = NOW()`,
      [actif, activePar],
    );
  }

  /**
   * Cockpit CEO (ADR-002, option cockpit lean) : snapshot 100 % lecture seule.
   * Requêtes indépendantes exécutées en parallèle ; chaque section rapporte sa
   * fraîcheur (MAX(created_at)) pour que la page affiche l'âge des données.
   */
  async dashboardSnapshot(): Promise<DashboardSnapshot> {
    const num = (v: unknown): number => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    const pnlP = this.pool.query<{ resultat_cumule: string | null; nb_ecritures: string; latest: string | null }>(
      'SELECT SUM(montant)::text AS resultat_cumule, COUNT(*)::text AS nb_ecritures, MAX(created_at)::text AS latest FROM pnl_ledger',
    );
    const hebdoP = this.pool.query<{ semaine_iso: string; departement: string; resultat_net: string | null }>(
      'SELECT semaine_iso::text, departement, resultat_net::text FROM v_pnl_hebdo ORDER BY semaine_iso DESC, departement LIMIT 48',
    );
    const ratiosP = this.pool.query<{ departement: string; ratio_sinistralite: string | null }>(
      'SELECT departement, ratio_sinistralite::text FROM v_ratio_sinistralite ORDER BY departement',
    );
    // Pas de table leads dans le schéma actuel → leads: null (non inventé).
    const pipelineP = this.pool.query<{ clients: string; contrats: string; latest: string | null }>(
      `SELECT (SELECT COUNT(*) FROM clients)::text AS clients,
              (SELECT COUNT(*) FROM contrats)::text AS contrats,
              GREATEST((SELECT MAX(created_at) FROM clients), (SELECT MAX(created_at) FROM contrats))::text AS latest`,
    );
    // montant_eur est inexistant sur sinistres : on somme montant_regle s'il est
    // renseigné, sinon montant_estime (montant provisionné pour les ouverts).
    const sinistresP = this.pool.query<{ statut: string; nb: string; montant: string | null; latest: string | null }>(
      `SELECT statut, COUNT(*)::text AS nb,
              SUM(COALESCE(montant_regle, montant_estime))::text AS montant,
              MAX(created_at)::text AS latest
         FROM sinistres GROUP BY statut ORDER BY statut`,
    );
    const approbationsP = this.listApprovals('en_attente', 100);
    const macroP = this.pool.query<{
      indicateur: string;
      valeur: string | null;
      periode: string | null;
      source: string | null;
      created_at: string;
    }>(
      `SELECT DISTINCT ON (indicateur) indicateur, valeur::text, periode, source, created_at::text
         FROM macro_indicateurs ORDER BY indicateur, created_at DESC`,
    );
    // Traçabilité anonymisation : détection souple - action ILIKE '%anonym%'
    // ou payload JSONB contenant un marqueur (anonymized / anonymise / anonymisation).
    const anonymP = this.pool.query<{ nb: string }>(
      `SELECT COUNT(*)::text AS nb FROM audit_log
        WHERE action ILIKE '%anonym%'
           OR payload::text ILIKE '%anonym%'`,
    );
    const killP = this.getKillSwitch();
    const timelineP = this.pool.query<{ created_at: string; source: string; action: string; correlation_id: string | null }>(
      `SELECT created_at::text, source, action, correlation_id::text
         FROM audit_log ORDER BY seq DESC LIMIT 25`,
    );

    const [pnl, hebdo, ratios, pipeline, sinistres, approbationsEnAttente, macro, anonym, killSwitch, timeline] =
      await Promise.all([pnlP, hebdoP, ratiosP, pipelineP, sinistresP, approbationsP, macroP, anonymP, killP, timelineP]);

    const sinLatest = sinistres.rows.map((r) => r.latest).filter((v): v is string => v !== null).sort().at(-1) ?? null;

    return {
      pnl: {
        resultat_cumule: num(pnl.rows[0]?.resultat_cumule),
        nb_ecritures: num(pnl.rows[0]?.nb_ecritures),
        latest: pnl.rows[0]?.latest ?? null,
      },
      pnlHebdo: hebdo.rows.map((r) => ({
        semaine_iso: r.semaine_iso,
        departement: r.departement,
        resultat_net: num(r.resultat_net),
      })),
      ratios: ratios.rows.map((r) => ({
        departement: r.departement,
        ratio: r.ratio_sinistralite === null ? null : num(r.ratio_sinistralite),
      })),
      pipeline: {
        leads: null,
        contrats: num(pipeline.rows[0]?.contrats),
        clients: num(pipeline.rows[0]?.clients),
        latest: pipeline.rows[0]?.latest ?? null,
      },
      sinistres: {
        rows: sinistres.rows.map((r) => ({ statut: r.statut, nb: num(r.nb), montant: num(r.montant) })),
        latest: sinLatest,
      },
      approbationsEnAttente,
      macro: macro.rows.map((r) => ({
        indicateur: r.indicateur,
        valeur: r.valeur === null ? null : num(r.valeur),
        periode: r.periode,
        source: r.source,
        created_at: r.created_at,
      })),
      anonymisation: { count: num(anonym.rows[0]?.nb), tracked: true },
      killSwitch,
      timeline: timeline.rows,
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// ---------- in-memory implementation (tests + demo) ----------
export function makeMemoryRepository(opts?: {
  sinistres?: SinistreRow[];
  killSwitch?: KillSwitchRow | null;
  consumed?: string[];
  macro?: Omit<MacroIndicateurRow, 'created_at'>[];
}): { repo: Repository; state: MemoryState } {
  const state: MemoryState = {
    sinistres: new Map((opts?.sinistres ?? []).map((s) => [s.id, { ...s }])),
    killSwitch:
      opts && 'killSwitch' in opts ? (opts.killSwitch ?? null) : { id: 1, actif: false, active_par: null, active_le: null },
    consumed: new Set(opts?.consumed ?? []),
    audit: [],
    pnl: [],
    pnlCreatedAt: new Map(),
    pnlLatest: null,
    macro: (opts?.macro ?? []).map((m) => ({ ...m, created_at: new Date().toISOString() })),
    approbations: new Map(),
  };

  const repo: Repository = {
    async ping() {
      return true;
    },
    async findSinistre(claimId) {
      return state.sinistres.get(claimId) ?? null;
    },
    async isCommandConsumed(commandId) {
      return state.consumed.has(commandId);
    },
    async getKillSwitch() {
      return state.killSwitch;
    },
    async appendAudit(correlationId, source, action, payload, hash, prevHash) {
      state.audit.push({
        seq: state.audit.length + 1,
        correlation_id: correlationId,
        source,
        action,
        payload: JSON.stringify(payload ?? {}),
        prev_hash: prevHash,
        hash,
        created_at: new Date().toISOString(),
      });
    },
    async inTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      let nextId = state.pnl.length + 1;
      const tx: Tx = {
        async query<R extends QueryResultRow>(text: string, params: unknown[] = []): Promise<QueryResult<R>> {
          return memoryQuery(state, text, params, () => nextId++) as QueryResult<R>;
        },
      };
      return fn(tx);
    },
    async listApprovals(statut = 'en_attente', limit = 50) {
      return [...state.approbations.values()].filter((a) => a.statut === statut).slice(0, limit);
    },
    async createApprobation(input) {
      if (state.approbations.has(input.correlationId)) {
        return state.approbations.get(input.correlationId)!;
      }
      const row: ApprobationRow = {
        id: input.correlationId,
        correlation_id: input.correlationId,
        type: input.type,
        claim_id: input.claimId ?? null,
        montant_eur: input.montantEur ?? null,
        statut: 'en_attente',
        requested_by: input.requestedBy ?? null,
        decided_by: null,
        reason: null,
        decided_at: null,
        created_at: new Date().toISOString(),
      };
      state.approbations.set(input.correlationId, row);
      return row;
    },
    async decideApprobation(correlationId, decidedBy, reason, approve) {
      const a = state.approbations.get(correlationId);
      if (a === undefined || a.statut !== 'en_attente') return null;
      a.statut = approve ? 'approuve' : 'refuse';
      a.decided_by = decidedBy;
      a.reason = reason;
      a.decided_at = new Date().toISOString();
      return a;
    },
    async setKillSwitch(actif, activePar) {
      state.killSwitch = { id: 1, actif, active_par: activePar, active_le: actif ? new Date().toISOString() : null };
    },
    // Snapshot lecture seule dérivé de l'état en mémoire (miroir des vues SQL).
    async dashboardSnapshot(): Promise<DashboardSnapshot> {
      // Σ ledger (résultat cumulé) + P&L hebdo agrégé par semaine ISO / département.
      const byWeekDept = new Map<string, PnlWeeklyRow>();
      for (const e of state.pnl) {
        // Seeds sans created_at : la semaine dérive du timestamp connu à l'INSERT, sinon 'n-d'.
        const sem = isoWeekOf(state.pnlCreatedAt.get(e.id) ?? null);
        const key = `${sem}|${e.departement}`;
        const row = byWeekDept.get(key) ?? { semaine_iso: sem, departement: e.departement, resultat_net: 0 };
        row.resultat_net += e.montant;
        byWeekDept.set(key, row);
      }
      const pnlHebdo = [...byWeekDept.values()].sort((a, b) =>
        a.semaine_iso === b.semaine_iso
          ? a.departement.localeCompare(b.departement)
          : b.semaine_iso.localeCompare(a.semaine_iso),
      );

      // Ratio de sinistralité par département : |charges| / primes (miroir v_ratio_sinistralite).
      const primesBy = new Map<string, number>();
      const chargesBy = new Map<string, number>();
      for (const e of state.pnl) {
        if (e.categorie === 'prime') primesBy.set(e.departement, (primesBy.get(e.departement) ?? 0) + e.montant);
        if (e.categorie === 'reglement' || e.categorie === 'provision') {
          chargesBy.set(e.departement, (chargesBy.get(e.departement) ?? 0) + Math.abs(e.montant));
        }
      }
      const depts = new Set([...primesBy.keys(), ...chargesBy.keys()]);
      const ratios: RatioSinistraliteRow[] = [...depts].sort().map((dep) => {
        const primes = primesBy.get(dep) ?? 0;
        return { departement: dep, ratio: primes > 0 ? (chargesBy.get(dep) ?? 0) / primes : null };
      });

      return {
        pnl: {
          resultat_cumule: state.pnl.reduce((s, e) => s + e.montant, 0),
          nb_ecritures: state.pnl.length,
          latest: state.pnlLatest ?? null,
        },
        pnlHebdo,
        ratios,
        pipeline: { leads: null, contrats: 0, clients: 0, latest: null },
        sinistres: {
          rows: [...state.sinistres.values()].map((s) => ({ statut: s.statut, nb: 1, montant: s.montant_eur })),
          latest: null,
        },
        approbationsEnAttente: [...state.approbations.values()].filter((a) => a.statut === 'en_attente'),
        macro: state.macro.map((m) => ({ ...m, created_at: new Date().toISOString() })),
        anonymisation: {
          count: state.audit.filter(
            (a) => /anonym/i.test(a.action) || /anonym/i.test(a.payload),
          ).length,
          tracked: true,
        },
        killSwitch: state.killSwitch,
        timeline: state.audit
          .slice()
          .reverse()
          .slice(0, 25)
          .map((a) => ({ created_at: a.created_at, source: a.source, action: a.action, correlation_id: a.correlation_id })),
      };
    },
    async close() {
      return Promise.resolve();
    },
  };
  return { repo, state };
}

/** Semaine ISO dérivable d'un timestamp connu, sinon 'n-d'. */
function isoWeekOf(iso: string | null): string {
  if (iso === null) return 'n-d';
  const d = new Date(iso);
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

export interface MemoryState {
  sinistres: Map<string, SinistreRow>;
  killSwitch: KillSwitchRow | null;
  consumed: Set<string>;
  audit: MemoryAuditRow[];
  pnl: MemoryPnlRow[];
  /** created_at ISO connu à l'INSERT (stubs memoryQuery sans paramètre date). */
  pnlCreatedAt: Map<number, string>;
  /** Fraîcheur P&L seedée directement par les tests, sinon déduite de pnlCreatedAt. */
  pnlLatest: string | null;
  macro: MacroIndicateurRow[];
  approbations: Map<string, ApprobationRow>;
}

export interface MemoryPnlRow {
  id: number;
  correlation_id: string;
  departement: string;
  categorie: string;
  montant: number;
  description: string;
}

export interface MemoryAuditRow {
  seq: number;
  correlation_id: string;
  source: string;
  action: string;
  payload: string;
  prev_hash: string;
  hash: string;
  created_at: string;
}

/** Effet métier minimal : la pipeline appelle ces méthodes dans la transaction. */
export async function settleClaimEffect(
  tx: Tx,
  cmd: Extract<Command, { type: 'claim.settlement.approve' }>,
  correlationId: string,
  thresholdEur: number,
): Promise<{ pnlRowId: number; montant: number }> {
  // Montant effectif du règlement = min(montant autorisé max, plafond global).
  // Dans la vraie boucle il viendrait du sinistre ; la politique a déjà plafonné.
  const montant = -Math.abs(Math.min(cmd.max_amount_eur, thresholdEur));
  const r = await tx.query<{ id: string }>(
    'INSERT INTO pnl_ledger (correlation_id, departement, categorie, montant, description) VALUES ($1,$2,$3,$4,$5) RETURNING id::text',
    [correlationId, 'auto', 'reglement', montant, `Settlement claim ${cmd.claim_id}`],
  );
  const pnlRowId = Number(r.rows[0]?.id ?? '0');
  await tx.query("UPDATE sinistres SET statut = 'regle' WHERE id = $1", [cmd.claim_id]);
  await tx.query(
    `UPDATE approbations SET statut = 'approuve', decided_at = NOW() WHERE correlation_id = $1 AND statut = 'en_attente'`,
    [correlationId],
  );
  return { pnlRowId, montant };
}

/** Query dispatch minimal pour le repo en mémoire (tests uniquement). */
function memoryQuery(
  state: MemoryState,
  text: string,
  params: unknown[],
  nextId: () => number,
): QueryResult<QueryResultRow> {
  if (text.includes('INSERT INTO commandes_consommees')) {
    const commandId = String(params[0] ?? '');
    const inserted = !state.consumed.has(commandId);
    if (inserted) state.consumed.add(commandId);
    return result([{ n: inserted ? '1' : '0' }], inserted ? 1 : 0);
  }
  if (text.includes('SELECT hash FROM audit_log')) {
    const last = state.audit[state.audit.length - 1];
    return result(last === undefined ? [] : [{ hash: last.hash }], last === undefined ? 0 : 1);
  }
  if (text.includes('FROM audit_log ORDER BY seq ASC')) {
    const rows = state.audit.map((a) => ({
      seq: String(a.seq),
      prev_hash: a.prev_hash,
      hash: a.hash,
      payload: a.payload,
    }));
    return result(rows, rows.length);
  }
  if (text.includes('INSERT INTO kill_switch') && text.includes('ON CONFLICT')) {
    const actif = text.includes('actif=true') || text.includes('(1, true') || text.includes('(1, $1');
    state.killSwitch = {
      id: 1,
      actif: actif && !text.includes("actif=false"),
      active_par: String(params[0] ?? ''),
      active_le: new Date().toISOString(),
    };
    return result([], 1);
  }
  if (text.includes('UPDATE kill_switch')) {
    const actif = !/false/i.test(text);
    state.killSwitch = {
      id: 1,
      actif,
      active_par: String(params[0] ?? ''),
      active_le: new Date().toISOString(),
    };
    return result([], 1);
  }
  if (text.includes('INSERT INTO pnl_ledger')) {
    const row = {
      id: nextId(),
      correlation_id: String(params[0] ?? ''),
      departement: String(params[1] ?? ''),
      categorie: String(params[2] ?? ''),
      montant: Number(params[3] ?? 0),
      description: String(params[4] ?? ''),
    };
    state.pnl.push(row);
    // Stub SQL sans paramètre de date : horodatage à l INSERT (tests uniquement).
    const insertedAt = new Date().toISOString();
    state.pnlCreatedAt.set(row.id, insertedAt);
    state.pnlLatest = insertedAt;
    return result([{ id: String(row.id) }], 1);
  }
  if (text.includes('INSERT INTO approbations')) {
    const correlationId = String(params[0] ?? '');
    const inserted = !state.approbations.has(correlationId);
    if (inserted) {
      state.approbations.set(correlationId, {
        id: correlationId,
        correlation_id: correlationId,
        type: String(params[1] ?? ''),
        claim_id: params[2] === null ? null : String(params[2]),
        montant_eur: params[3] === null || params[3] === undefined ? null : Number(params[3]),
        statut: 'en_attente',
        requested_by: params[4] === undefined ? null : String(params[4]),
        decided_by: null,
        reason: null,
        decided_at: null,
        created_at: new Date().toISOString(),
      });
    }
    return result([], inserted ? 1 : 0);
  }
  if (text.includes('UPDATE sinistres')) {
    const s = state.sinistres.get(String(params[0] ?? ''));
    if (s !== undefined) s.statut = 'regle';
    return result([], s === undefined ? 0 : 1);
  }
  if (text.includes('UPDATE approbations')) {
    const a = state.approbations.get(String(params[0] ?? ''));
    if (a !== undefined && a.statut === 'en_attente') {
      a.statut = 'approuve';
      a.decided_at = new Date().toISOString();
    }
    return result([], a !== undefined ? 1 : 0);
  }
  return result([], 0);
}

function result(rows: QueryResultRow[], rowCount: number): QueryResult<QueryResultRow> {
  return { rows, rowCount, command: 'OK', oid: 0, fields: [] };
}
