/**
 * Pure decision policy: no DB access here, everything comes from PolicyContext.
 * Business rules stay readable on the business side (stable bilingual codes in reasons).
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

/** Enriched context: the pipeline injects the resolved role of the Nostr author. */
export interface PolicyEvaluationInput {
  cmd: Command;
  ctx: PolicyContext;
  /** Already resolved role (config CEO npubs, optional RBAC map). */
  role: Role;
}

/** Evaluation order: from the systemic blocker to business-specific checks. */
export function evaluate(input: PolicyEvaluationInput): PolicyDecision {
  const { cmd, ctx, role } = input;
  if (typeof cmd !== 'object' || cmd === null) return DENY('schema.invalid:payload_non_objet');

  // Kill-switch: blocks everything except explicit deactivation.
  if (ctx.killSwitch !== null && ctx.killSwitch.actif && cmd.type !== 'agent.killswitch.deactivate') {
    return DENY('killswitch.actif:execution_autonome_bloquee');
  }

  // Idempotence: same command already consumed.
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
      // TS-exhaustive; defensive fallback for an uncovered type.
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
  // Roles allowed to file a settlement: CEO and claims agent only.
  const isSinistresAgent = role === 'agent-sinistres';
  if (role !== 'ceo' && !isSinistresAgent) return DENY('rbac:reglement_non_autorise_pour_role');
  const s = ctx.sinistre;
  if (s === null) return DENY('sinistre:introuvable');
  if (s.statut !== 'ouvert' && s.statut !== 'en_traitement') {
    return DENY(`sinistre:statut_invalide:${s.statut}`);
  }
  // Above the global threshold: decision reserved to the CEO (an agent must create
  // an 'en_attente' approval rather than self-settling, cf. brief §6B).
  if (isSinistresAgent && s.montant_eur > ctx.thresholdEur) {
    return DENY('rbac:au_dessus_seuil_reserve_CEO');
  }
  // Effective cap: agent → lesser of the requested cap and the global threshold;
  // signed CEO → requested cap (the CEO can settle above the threshold).
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

/** Actions requiring the CEO role (doc + guard reusable on the pipeline side).
 *  NB: claim.settlement.approve is no longer among them — below the global
 *  threshold, a signed/allowlisted claims agent can also settle (brief §6B). */
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
