/**
 * Registre d'outils Hermes : schémas JSON rigides (énumérations string) exposés
 * au LLM local, et handlers qui LISENT la base (read-only) ou produisent une
 * COMMANDE CANDIDATE pour le bridge. Aucune écriture métier directe ici.
 *
 * RÈGLEMENT (brief §6B) : en dessous du seuil `HERMES_ESCALATION_THRESHOLD_EUR`
 * `recommander_reglement` produit une `candidateCommand` (claim.settlement.approve,
 * approved_by = npub de l'agent) postée au bridge (POST /commands) — le bridge
 * autorise alors le self-settlement d'un agent sinistres. Au-dessus du seuil,
 * l'agent ne s'auto-règle JAMAIS : il produit une `pendingApproval` postée au
 * bridge (POST /approvals → approbation 'en_attente' pour le CEO).
 */
import { randomInt, randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { DbClient, MemoireEntry } from '../db/client.js';
import type { OllamaClient, OllamaTool } from '../llm/ollama.js';
import type { BridgeCommand, ApprobationInput } from '../bridge/client.js';
import { buildSettlementCommand } from '../bridge/client.js';

/** Input d'escalade fourni par l'outil (correlation_id fixé par le runtime). */
export type BridgeApprobationInput = Omit<ApprobationInput, 'correlation_id'>;
import type { Allowlist } from '../security/allowlist.js';
import { isAllowed } from '../security/allowlist.js';
import { assertNoPii, finalScrub, type Anonymizer } from '../privacy/anonymize.js';

// ---------- types publics ----------

export interface ToolExecution {
  tool: string;
  ok: boolean;
  result: unknown;
  /** Commande typée prête à être POSTée au bridge (après kill-switch/anonymisation). */
  candidateCommand?: BridgeCommand;
  /** Escalade CEO : demande d'approbation 'en_attente' à créer côté bridge (§6B). */
  pendingApproval?: BridgeApprobationInput;
}

export interface RecommanderReglementInput {
  claim_id: unknown;
  montant: unknown;
  raison: unknown;
}

export interface ToolDeps {
  db: DbClient;
  ollama: OllamaClient;
  anonymizer: Anonymizer;
  logger: Logger;
  departement: string;
  agentNpub: string;
  escalationThresholdEur: number;
}

type JsonSchema = Record<string, unknown>;

interface ToolDef {
  name: string;
  description: string;
  parameters: JsonSchema;
  execute(args: Record<string, unknown>, deps: ToolDeps): Promise<ToolExecution>;
}

// ---------- validation d'arguments (chaînes sûres, jamais d'injection) ----------

function reqString(args: Record<string, unknown>, key: string, max = 200): string {
  const v = args[key];
  if (typeof v !== 'string' || v.trim().length === 0) {
    throw new ToolArgumentError(`argument '${key}' manquant ou invalide`);
  }
  return v.trim().slice(0, max);
}

function optNumber(args: Record<string, unknown>, key: string): number | null {
  const v = args[key];
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export class ToolArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolArgumentError';
  }
}

// ---------- SQL read-only (conforme init.sql / schema_v2.sql) ----------

async function lireSinistre(deps: ToolDeps, claimRef: string): Promise<unknown> {
  const numeric = /^\d+$/.test(claimRef) ? Number(claimRef) : null;
  const r =
    numeric !== null
      ? await deps.db.query(
          `SELECT s.id, s.contrat_id, s.date_sinistre::text, s.description, s.montant_estime,
                  s.montant_regle, s.statut, s.created_at::text
           FROM sinistres s WHERE s.id = $1`,
          [numeric],
        )
      : await deps.db.query(
          `SELECT s.id, s.contrat_id, s.date_sinistre::text, s.description, s.montant_estime,
                  s.montant_regle, s.statut, s.created_at::text
           FROM sinistres s WHERE s.id::text = $1`,
          [claimRef],
        );
  return { rows: r.rows, count: r.rowCount };
}

async function lireClient(deps: ToolDeps, clientRef: string): Promise<unknown> {
  const numeric = /^\d+$/.test(clientRef) ? Number(clientRef) : null;
  const sql =
    numeric !== null
      ? `SELECT id, nom, prenom, email, telephone, date_naissance::text, created_at::text
         FROM clients WHERE id = $1 OR email = $2`
      : `SELECT id, nom, prenom, email, telephone, date_naissance::text, created_at::text
         FROM clients WHERE email = $1`;
  const r = await deps.db.query(sql, numeric !== null ? [numeric, clientRef] : [clientRef]);
  return { rows: r.rows, count: r.rowCount };
}

async function lireContrat(deps: ToolDeps, contratRef: string): Promise<unknown> {
  const numeric = /^\d+$/.test(contratRef) ? Number(contratRef) : null;
  const r =
    numeric !== null
      ? await deps.db.query(
          `SELECT id, client_id, type_contrat, numero, date_debut::text, date_fin::text,
                  prime_annuelle, statut, created_at::text
           FROM contrats WHERE id = $1`,
          [numeric],
        )
      : await deps.db.query(
          `SELECT id, client_id, type_contrat, numero, date_debut::text, date_fin::text,
                  prime_annuelle, statut, created_at::text
           FROM contrats WHERE numero = $1`,
          [contratRef],
        );
  return { rows: r.rows, count: r.rowCount };
}

// ---------- logique tarifaire (grille officielle — cf. skills souscription) ----------

interface DonneesRisque {
  age_conducteur: number | null;
  bonus_malus: number | null;
  type_vehicule: string;
  zone: string;
  formule: string;
  age_vehicule: number | null;
  source: string;
}

function lireDonneesRisque(args: Record<string, unknown>): DonneesRisque | null {
  const dr = args['donnees_risque'];
  if (typeof dr !== 'object' || dr === null || Array.isArray(dr)) return null;
  const o = dr as Record<string, unknown>;
  const str = (k: string, def: string): string => {
    const v = o[k];
    return typeof v === 'string' && v.length > 0 ? v : def;
  };
  return {
    age_conducteur: optNumber(o, 'age_conducteur'),
    bonus_malus: optNumber(o, 'bonus_malus'),
    type_vehicule: str('type_vehicule', 'citadine'),
    zone: str('zone', 'autre'),
    formule: str('formule', 'tiers'),
    age_vehicule: optNumber(o, 'age_vehicule'),
    source: str('source', 'autre'),
  };
}

const BASE_PRIME_EUR = 400;

function grillePrime(dr: DonneesRisque): { prime: number; facteurs: Record<string, number> } {
  const facteurs: Record<string, number> = { base: BASE_PRIME_EUR };

  const age = dr.age_conducteur ?? 40;
  facteurs['age'] = age < 25 ? 1.5 : age <= 55 ? 1.0 : 1.15;

  const bm = dr.bonus_malus ?? 1;
  facteurs['bonus_malus'] = Math.min(Math.max(bm, 0.5), 3.5);

  facteurs['type_vehicule'] =
    dr.type_vehicule === 'sportive' ? 1.6 : dr.type_vehicule === 'suv' ? 1.25 : 1.0;

  const ageV = dr.age_vehicule ?? 3;
  facteurs['age_vehicule'] = ageV > 10 ? 1.1 : 1.0;

  facteurs['zone'] = dr.zone === 'paris' ? 1.15 : dr.zone === 'banlieue' ? 1.05 : 1.0;
  facteurs['formule'] = dr.formule === 'tous_risques' ? 1.8 : 1.0;

  const coefficients = Object.entries(facteurs)
    .filter(([k]) => k !== 'base')
    .map(([, v]) => v);
  const prime = BASE_PRIME_EUR * coefficients.reduce((acc, v) => acc * v, 1);
  return { prime: Math.round(prime * 100) / 100, facteurs };
}

function scoreDeRisque(dr: DonneesRisque): { score: number; facteurs: string[] } {
  let score = 30; // socle
  const raisons: string[] = [];
  const add = (pts: number, raison: string): void => {
    score += pts;
    raisons.push(raison);
  };

  const age = dr.age_conducteur ?? 40;
  if (age < 25) add(25, 'conducteur de moins de 25 ans');
  else if (age > 65) add(10, 'conducteur de plus de 65 ans');

  const bm = dr.bonus_malus ?? 1;
  if (bm > 2.5) add(30, 'bonus-malus > 2.5 (profil atypique)');
  else if (bm > 1.25) add(15, 'bonus-malus élevé');
  else if (bm < 0.9) add(-10, 'bonus fidélité');

  if (dr.type_vehicule === 'sportive') add(20, 'véhicule sportif');
  else if (dr.type_vehicule === 'suv') add(8, 'SUV');

  if ((dr.age_vehicule ?? 0) > 10) add(7, 'véhicule de plus de 10 ans');
  if (dr.zone === 'paris') add(10, 'zone Paris intra-muros');

  const clamped = Math.min(Math.max(Math.round(score), 0), 100);
  return {
    score: clamped,
    facteurs: raisons,
  };
}

function qualificationLead(dr: DonneesRisque): { score: number; decision: string } {
  let score = 0;
  const age = dr.age_conducteur ?? 40;
  score += age >= 25 && age <= 55 ? 0.25 : age < 25 ? 0.08 : 0.15;
  const bm = dr.bonus_malus ?? 1;
  score += bm < 1 ? 0.2 : bm <= 1.25 ? 0.12 : 0.04;
  score += dr.type_vehicule === 'citadine' ? 0.2 : dr.type_vehicule === 'suv' ? 0.12 : 0.06;
  score += dr.zone === 'banlieue' ? 0.15 : dr.zone === 'paris' ? 0.1 : 0.13;
  score += dr.source === 'parrainage' ? 0.2 : dr.source === 'seo' ? 0.14 : dr.source === 'pub' ? 0.08 : 0.1;
  const arr = Math.round(score * 100) / 100;
  return { score: arr, decision: arr > 0.6 ? 'qualifie' : 'perdu' };
}

// ---------- registre ----------

export interface ToolRegistry {
  /** Schémas OpenAI-style filtrés par l'allowlist de l'agent. */
  schemasFor(allowlist: Allowlist): OllamaTool[];
  /** Exécute un outil nommé (allowlist déjà vérifiée par le runtime). */
  execute(name: string, args: Record<string, unknown>): Promise<ToolExecution>;
  has(name: string): boolean;
  listNames(): string[];
}

const TYPE_VEHICULE = ['citadine', 'suv', 'sportive', 'utilitaire'];
const ZONE = ['paris', 'banlieue', 'autre'];
const FORMULE = ['tiers', 'tiers_etendu', 'tous_risques'];
const SOURCE_LEAD = ['parrainage', 'seo', 'pub', 'autre'];
const PERIODE_KIND = ['mois', 'hebdo'];

const RISQUE_PROPS: JsonSchema = {
  type: 'object',
  properties: {
    age_conducteur: { type: 'integer' },
    bonus_malus: { type: 'number' },
    type_vehicule: { type: 'string', enum: TYPE_VEHICULE },
    zone: { type: 'string', enum: ZONE },
    formule: { type: 'string', enum: FORMULE },
    age_vehicule: { type: 'integer' },
    source: { type: 'string', enum: SOURCE_LEAD },
  },
  additionalProperties: false,
};

function makeRegistry(): ToolDef[] {
  return [
    {
      name: 'lire_sinistre',
      description: "Lit un sinistre par id (lecture seule).",
      parameters: {
        type: 'object',
        properties: { sinistre_id: { type: 'string', description: 'Identifiant du sinistre' } },
        required: ['sinistre_id'],
        additionalProperties: false,
      },
      async execute(args, deps) {
        const ref = reqString(args, 'sinistre_id', 64);
        return { tool: 'lire_sinistre', ok: true, result: await lireSinistre(deps, ref) };
      },
    },
    {
      name: 'lire_client',
      description: 'Lit un client par id ou email (lecture seule).',
      parameters: {
        type: 'object',
        properties: { client_ref: { type: 'string', description: 'ID numérique ou email' } },
        required: ['client_ref'],
        additionalProperties: false,
      },
      async execute(args, deps) {
        const ref = reqString(args, 'client_ref', 120);
        return { tool: 'lire_client', ok: true, result: await lireClient(deps, ref) };
      },
    },
    {
      name: 'lire_contrat',
      description: 'Lit un contrat par id ou numéro (lecture seule).',
      parameters: {
        type: 'object',
        properties: { contrat_ref: { type: 'string', description: 'ID numérique ou numéro de contrat' } },
        required: ['contrat_ref'],
        additionalProperties: false,
      },
      async execute(args, deps) {
        const ref = reqString(args, 'contrat_ref', 64);
        return { tool: 'lire_contrat', ok: true, result: await lireContrat(deps, ref) };
      },
    },
    {
      name: 'calculer_prime',
      description:
        "Calcule la prime annuelle indicative selon la grille tarifaire officielle (bonus-malus, zone, formule, âge, véhicule).",
      parameters: {
        type: 'object',
        properties: { donnees_risque: RISQUE_PROPS },
        required: ['donnees_risque'],
        additionalProperties: false,
      },
      async execute(args) {
        const dr = lireDonneesRisque(args);
        if (dr === null) throw new ToolArgumentError("'donnees_risque' invalide");
        const { prime, facteurs } = grillePrime(dr);
        return {
          tool: 'calculer_prime',
          ok: true,
          result: { prime_annuelle_eur: prime, base_eur: BASE_PRIME_EUR, facteurs },
        };
      },
    },
    {
      name: 'evaluer_risque',
      description:
        'Score de risque composite 0-100 pour la souscription. >80 = risque élevé (surprime ou refus).',
      parameters: {
        type: 'object',
        properties: {
          age: { type: 'integer' },
          bonus_malus: { type: 'number' },
          type_vehicule: { type: 'string', enum: TYPE_VEHICULE },
          zone: { type: 'string', enum: ZONE },
          age_vehicule: { type: 'integer' },
        },
        additionalProperties: false,
      },
      async execute(args) {
        const dr: DonneesRisque = {
          age_conducteur: optNumber(args, 'age'),
          bonus_malus: optNumber(args, 'bonus_malus'),
          type_vehicule: typeof args['type_vehicule'] === 'string' ? (args['type_vehicule'] as string) : 'citadine',
          zone: typeof args['zone'] === 'string' ? (args['zone'] as string) : 'autre',
          formule: 'tiers',
          age_vehicule: optNumber(args, 'age_vehicule'),
          source: 'autre',
        };
        const { score, facteurs } = scoreDeRisque(dr);
        return {
          tool: 'evaluer_risque',
          ok: true,
          result: {
            score_risque: score,
            decision: score > 80 ? 'surprime_ou_refus' : 'acceptable',
            facteurs,
          },
        };
      },
    },
    {
      name: 'qualifier_lead',
      description:
        "Score un lead sortant (0-1) selon la grille de qualification Sales. >0.6 = 'qualifie', sinon 'perdu'.",
      parameters: {
        type: 'object',
        properties: {
          age_conducteur: { type: 'integer' },
          bonus_malus: { type: 'number' },
          type_vehicule: { type: 'string', enum: TYPE_VEHICULE },
          zone: { type: 'string', enum: ZONE },
          source: { type: 'string', enum: SOURCE_LEAD },
        },
        additionalProperties: false,
      },
      async execute(args) {
        const dr: DonneesRisque = {
          age_conducteur: optNumber(args, 'age_conducteur'),
          bonus_malus: optNumber(args, 'bonus_malus'),
          type_vehicule: typeof args['type_vehicule'] === 'string' ? (args['type_vehicule'] as string) : 'citadine',
          zone: typeof args['zone'] === 'string' ? (args['zone'] as string) : 'autre',
          formule: 'tiers',
          age_vehicule: null,
          source: typeof args['source'] === 'string' ? (args['source'] as string) : 'autre',
        };
        return { tool: 'qualifier_lead', ok: true, result: qualificationLead(dr) };
      },
    },
    {
      name: 'recommander_reglement',
      description:
        "Émet UNE RECOMMANDATION de règlement d'un sinistre. Ne règle rien : produit une commande candidate claim.settlement.approve envoyée au bridge (policy + approbation).",
      parameters: {
        type: 'object',
        properties: {
          claim_id: { type: 'string', description: 'Identifiant du sinistre (claim)' },
          montant: { type: 'number', description: 'Montant de règlement proposé en EUR (>0)' },
          raison: { type: 'string', description: 'Justification métier (sans PII)' },
        },
        required: ['claim_id', 'montant', 'raison'],
        additionalProperties: false,
      },
      async execute(args, deps): Promise<ToolExecution> {
        const claimId = reqString(args, 'claim_id', 64);
        const montant = optNumber(args, 'montant');
        const raison = reqString(args, 'raison', 500);
        if (montant === null || montant <= 0) {
          throw new ToolArgumentError("'montant' doit être un nombre strictement positif");
        }
        const escalade = montant > deps.escalationThresholdEur;
        if (escalade) {
          // Au-dessus du seuil : JAMAIS d'auto-règlement. L'agent crée une demande
          // d'approbation 'en_attente' pour le CEO (POST /approvals côté bridge).
          return {
            tool: 'recommander_reglement',
            ok: true,
            result: {
              recommandation: 'approbations.create',
              claim_id: claimId,
              montant_eur: montant,
              escalation_ceo: true,
              seuil_eur: deps.escalationThresholdEur,
            },
            pendingApproval: {
              type: 'claim.settlement.approve',
              claim_id: claimId,
              montant_eur: montant,
              reason: raison,
              requested_by: deps.agentNpub,
            },
          };
        }
        const command = buildSettlementCommand({
          claim_id: claimId,
          montant,
          raison,
          approved_by: deps.agentNpub,
        });
        if (command === null) {
          throw new ToolArgumentError('commande claim.settlement.approve invalide');
        }
        return {
          tool: 'recommander_reglement',
          ok: true,
          result: {
            recommandation: 'claim.settlement.approve',
            claim_id: claimId,
            montant_eur: montant,
            escalation_ceo: false,
            seuil_eur: deps.escalationThresholdEur,
          },
          candidateCommand: command,
        };
      },
    },
    {
      name: 'requeter_pnl',
      description:
        "Lit le P&L (append-only, montants signés : recettes+/charges-). periode ' YYYY-MM' ou 'semaine' pour la vue hebdo.",
      parameters: {
        type: 'object',
        properties: {
          periode: { type: 'string', description: "'YYYY-MM' OU 'semaine' (vue hebdo)" },
          kind: { type: 'string', enum: PERIODE_KIND },
        },
        required: ['periode'],
        additionalProperties: false,
      },
      async execute(args, deps) {
        const periode = reqString(args, 'periode', 16);
        if (periode === 'semaine' || args['kind'] === 'hebdo') {
          const r = await deps.db.query(
            `SELECT semaine_iso::text, departement, primes, reglements, provisions, frais, marketing, resultat_net
             FROM v_pnl_hebdo ORDER BY semaine_iso DESC, departement LIMIT 100`,
          );
          return { tool: 'requeter_pnl', ok: true, result: { vue: 'v_pnl_hebdo', rows: r.rows } };
        }
        if (!/^\d{4}-\d{2}$/.test(periode)) {
          throw new ToolArgumentError("periode doit être 'YYYY-MM' ou 'semaine'");
        }
        const r = await deps.db.query(
          `SELECT departement, categorie, SUM(montant) AS montant, COUNT(*) AS lignes
           FROM pnl_ledger
           WHERE to_char(created_at, 'YYYY-MM') = $1
           GROUP BY departement, categorie
           ORDER BY departement, categorie`,
          [periode],
        );
        return { tool: 'requeter_pnl', ok: true, result: { periode, rows: r.rows } };
      },
    },
    {
      name: 'consulter_memoire',
      description:
        'Recherche sémantique (pgvector) dans la mémoire du département + mémoire partagée.',
      parameters: {
        type: 'object',
        properties: {
          requete: { type: 'string', description: 'Question / mots-clés de recherche' },
          limite: { type: 'integer', description: 'Nb max de résultats (défaut 5)' },
        },
        required: ['requete'],
        additionalProperties: false,
      },
      async execute(args, deps) {
        const requete = reqString(args, 'requete', 500);
        const limiteRaw = optNumber(args, 'limite');
        const limite = limiteRaw === null ? 5 : Math.min(Math.max(Math.round(limiteRaw), 1), 20);
        const embedding = await deps.ollama.embed(requete);
        if (embedding === null) {
          return {
            tool: 'consulter_memoire',
            ok: true,
            result: { entries: [] as MemoireEntry[], note: 'embeddings indisponibles' },
          };
        }
        const entries = await deps.db.searchMemoire(deps.departement, embedding, limite);
        const cleaned = entries.map((e) => ({
          ...e,
          contenu: assertNoPii(e.contenu) ? finalScrub(e.contenu) : e.contenu,
        }));
        return { tool: 'consulter_memoire', ok: true, result: { entries: cleaned } };
      },
    },
  ];
}

export function createToolRegistry(deps: ToolDeps): ToolRegistry {
  const defs = makeRegistry();
  const byName = new Map<string, ToolDef>(defs.map((d) => [d.name, d]));

  return {
    schemasFor(allowlist: Allowlist): OllamaTool[] {
      return defs
        .filter((d) => isAllowed(allowlist, d.name))
        .map((d) => ({
          type: 'function',
          function: { name: d.name, description: d.description, parameters: d.parameters },
        }));
    },

    async execute(name: string, args: Record<string, unknown>): Promise<ToolExecution> {
      const def = byName.get(name);
      if (def === undefined) {
        return { tool: name, ok: false, result: { error: `outil inconnu: ${name}` } };
      }
      try {
        return await def.execute(args, deps);
      } catch (err) {
        const msg = err instanceof ToolArgumentError ? err.message : 'erreur interne outil';
        deps.logger.warn({ action: 'tool.error', tool: name }, msg);
        return { tool: name, ok: false, result: { error: msg } };
      }
    },

    has: (name) => byName.has(name),
    listNames: () => defs.map((d) => d.name),
  };
}

/** ID aléatoire court (corrélation interne, pas le correlation_id global). */
export function newLocalId(): string {
  return `${randomInt(1_000_000)}-${randomUUID().slice(0, 8)}`;
}
