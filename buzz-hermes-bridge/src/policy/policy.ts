/**
 * Politique de décision pure : pas d'accès DB ici, tout vient du PolicyContext.
 * Les règles métier restent lisibles côté métier (codes stables bilingues dans les reasons).
 */
import type { Command } from '../commands/schemas.js';
import type { PolicyContext, SinistreRow } from '../db/repository.js';

export type Role = 'ceo' | 'conformite' | 'finance' | 'agent-sales' | 'agent-souscription' | 'agent-sinistres' | 'inconnu';

export interface PolicyDecision {
  allow: boolean;
  reason: string; // code stable (lisible logs/audit)
}

const ALLOW: PolicyDecision = { allow: true, reason: 'allow' };
const DENY = (reason: string): PolicyDecision => ({ allow: false, reason });

/** Contexte enrichi : le pipeline y injecte le rôle résolu de l'auteur Nostr. */
export interface PolicyEvaluationInput {
  cmd: Command;
  ctx: PolicyContext;
  /** Rôle déjà résolu (npubs CEO en config, map RBAC optionnelle). */
  role: Role;
}

/** Ordre d'évaluation : du bloquant systémique au spécifique métier. */
export function evaluate(input: PolicyEvaluationInput): PolicyDecision {
  const { cmd, ctx, role } = input;
  if (typeof cmd !== 'object' || cmd === null) return DENY('schema.invalid:payload_non_objet');

  // Kill-switch : bloque tout sauf la désactivation explicite.
  if (ctx.killSwitch !== null && ctx.killSwitch.actif && cmd.type !== 'agent.killswitch.deactivate') {
    return DENY('killswitch.actif:execution_autonome_bloquee');
  }

  // Idempotence : même commande déjà consommée.
  if (ctx.commandConsumed) return DENY('idempotence:commande_deja_consommee');

  switch (cmd.type) {
    case 'claim.settlement.approve':
      return evaluateClaimApprove(cmd, ctx, role);
    case 'claim.settlement.reject':
      return evaluateClaimReject(cmd, ctx, role);
    case 'policy.pricing.exception.approve':
      return evaluatePricingException(cmd, role);
    case 'agent.killswitch.activate':
      return evaluateKillswitchActivate(ctx, role);
    case 'agent.killswitch.deactivate':
      return evaluateKillswitchDeactivate(ctx, role);
    case 'finance.report.request':
      return evaluateFinanceRequest(role);
    default: {
      // Exhaustif côté TS ; fallback défensif pour un type non couvert.
      const _never: never = cmd;
      return DENY(`schema.invalid:type_inconnu:${String(_never)}`);
    }
  }
}

function evaluateClaimApprove(
  cmd: Extract<Command, { type: 'claim.settlement.approve' }>,
  ctx: PolicyContext,
  role: Role,
): PolicyDecision {
  // Rôles autorisés à soumettre un règlement : CEO et agent sinistres uniquement.
  const isSinistresAgent = role === 'agent-sinistres';
  if (role !== 'ceo' && !isSinistresAgent) return DENY('rbac:reglement_non_autorise_pour_role');
  const s = ctx.sinistre;
  if (s === null) return DENY('sinistre:introuvable');
  if (s.statut !== 'ouvert' && s.statut !== 'en_traitement') {
    return DENY(`sinistre:statut_invalide:${s.statut}`);
  }
  // Au-dessus du seuil global : décision réservée au CEO (un agent doit créer
  // une approbation 'en_attente' plutôt que de s'auto-régler, cf. brief §6B).
  if (isSinistresAgent && s.montant_eur > ctx.thresholdEur) {
    return DENY('rbac:au_dessus_seuil_reserve_CEO');
  }
  // Plafond effectif : agent → moindre du plafond demandé et du seuil global ;
  // CEO signé → plafond demandé (le CEO peut régler au-dessus du seuil).
  const plafond = role === 'ceo' ? cmd.max_amount_eur : Math.min(cmd.max_amount_eur, ctx.thresholdEur);
  if (s.montant_eur > plafond) return DENY(`montant:sinistre_depasse_plafond:${s.montant_eur}>${plafond}`);
  if (s.compliance_bloque) return DENY('conformite:dossier_bloque');
  return ALLOW;
}

function evaluateClaimReject(
  cmd: Extract<Command, { type: 'claim.settlement.reject' }>,
  ctx: PolicyContext,
  role: Role,
): PolicyDecision {
  void cmd;
  if (role !== 'ceo') return DENY('rbac:refus_reglement_reserve_au_CEO');
  const s = ctx.sinistre;
  if (s === null) return DENY('sinistre:introuvable');
  if (s.statut === 'regle' || s.statut === 'cloture') return DENY(`sinistre:statut_invalide:${s.statut}`);
  return ALLOW;
}

function evaluatePricingException(cmd: Extract<Command, { type: 'policy.pricing.exception.approve' }>, role: Role): PolicyDecision {
  if (role !== 'ceo') return DENY('rbac:exception_tarifaire_reservee_au_CEO');
  if (cmd.new_prime_eur <= 0) return DENY('montant:prime_invalide');
  return ALLOW;
}

function evaluateKillswitchActivate(ctx: PolicyContext, role: Role): PolicyDecision {
  if (role !== 'ceo') return DENY('rbac:killswitch_reserve_au_CEO');
  if (ctx.killSwitch !== null && ctx.killSwitch.actif) return DENY('killswitch:deja_actif');
  return ALLOW;
}

function evaluateKillswitchDeactivate(ctx: PolicyContext, role: Role): PolicyDecision {
  if (role !== 'ceo') return DENY('rbac:killswitch_reserve_au_CEO');
  if (ctx.killSwitch === null || !ctx.killSwitch.actif) return DENY('killswitch:deja_inactif');
  return ALLOW;
}

function evaluateFinanceRequest(role: Role): PolicyDecision {
  if (role === 'ceo' || role === 'finance' || role === 'conformite') return ALLOW;
  return DENY('rbac:rapport_pnl_reserve_ceo_finance_conformite');
}

/** Actions exigeant le rôle CEO (doc + garde-fou réutilisable côté pipeline).
 *  NB : claim.settlement.approve n'y figure plus — en dessous du seuil global,
 *  un agent sinistres signé/allowlisté peut aussi se régler (brief §6B). */
export function requiresCeo(type: Command['type']): boolean {
  return (
    type === 'claim.settlement.reject' ||
    type === 'policy.pricing.exception.approve' ||
    type === 'agent.killswitch.activate' ||
    type === 'agent.killswitch.deactivate'
  );
}

export function describeSinistre(s: SinistreRow | null): string {
  if (s === null) return 'introuvable';
  return `${s.id} statut=${s.statut} montant=${s.montant_eur} compliance=${s.compliance_bloque}`;
}
