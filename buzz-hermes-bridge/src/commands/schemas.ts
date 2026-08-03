import AjvNs from 'ajv';
import type { ErrorObject } from 'ajv';
import type { FormatsPlugin } from 'ajv-formats';
import formatsPluginNs from 'ajv-formats';

/**
 * Strict JSON schemas: no free-form command is admitted.
 * additionalProperties:false everywhere, explicit required, checked formats.
 */
export const NPUB_PATTERN = '^(npub1[02-9ac-hj-np-z]+|[0-9a-f]{64})$';
export const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
export const COMMAND_ID_PATTERN = '^[A-Za-z0-9:_-]{1,128}$';

const common = {
  type: { type: 'string' }, // enumerated by command
  required: ['type'] as string[],
};

// claim.settlement.approve — conforms to the brief example.
const claimSettlementApprove = {
  $id: 'claim.settlement.approve',
  type: 'object',
  additionalProperties: false,
  required: ['type', 'claim_id', 'max_amount_eur', 'reason', 'approved_by', 'requested_at'],
  properties: {
    type: { const: 'claim.settlement.approve' },
    claim_id: { type: 'string', minLength: 1, maxLength: 64 },
    // Cap allowed for THIS settlement (policy also bounds it on the global threshold).
    max_amount_eur: { type: 'number', exclusiveMinimum: 0, maximum: 10_000_000 },
    reason: { type: 'string', minLength: 1, maxLength: 500 },
    approved_by: { type: 'string', pattern: NPUB_PATTERN },
    requested_at: { type: 'string', format: 'date-time' },
  },
};

const claimSettlementReject = {
  $id: 'claim.settlement.reject',
  type: 'object',
  additionalProperties: false,
  required: ['type', 'claim_id', 'reason', 'approved_by', 'requested_at'],
  properties: {
    type: { const: 'claim.settlement.reject' },
    claim_id: { type: 'string', minLength: 1, maxLength: 64 },
    reason: { type: 'string', minLength: 1, maxLength: 500 },
    approved_by: { type: 'string', pattern: NPUB_PATTERN },
    requested_at: { type: 'string', format: 'date-time' },
  },
};

const policyPricingExceptionApprove = {
  $id: 'policy.pricing.exception.approve',
  type: 'object',
  additionalProperties: false,
  required: ['type', 'contrat_id', 'new_prime_eur', 'reason', 'approved_by', 'requested_at'],
  properties: {
    type: { const: 'policy.pricing.exception.approve' },
    contrat_id: { type: 'string', minLength: 1, maxLength: 64 },
    new_prime_eur: { type: 'number', exclusiveMinimum: 0, maximum: 10_000_000 },
    reason: { type: 'string', minLength: 1, maxLength: 500 },
    approved_by: { type: 'string', pattern: NPUB_PATTERN },
    requested_at: { type: 'string', format: 'date-time' },
  },
};

const killswitchActivate = {
  $id: 'agent.killswitch.activate',
  type: 'object',
  additionalProperties: false,
  required: ['type', 'approved_by', 'reason', 'requested_at'],
  properties: {
    type: { const: 'agent.killswitch.activate' },
    approved_by: { type: 'string', pattern: NPUB_PATTERN },
    reason: { type: 'string', minLength: 1, maxLength: 500 },
    requested_at: { type: 'string', format: 'date-time' },
  },
};

const killswitchDeactivate = {
  $id: 'agent.killswitch.deactivate',
  type: 'object',
  additionalProperties: false,
  required: ['type', 'approved_by', 'reason', 'requested_at'],
  properties: {
    type: { const: 'agent.killswitch.deactivate' },
    approved_by: { type: 'string', pattern: NPUB_PATTERN },
    reason: { type: 'string', minLength: 1, maxLength: 500 },
    requested_at: { type: 'string', format: 'date-time' },
  },
};

const financeReportRequest = {
  $id: 'finance.report.request',
  type: 'object',
  additionalProperties: false,
  required: ['type', 'periode', 'departements', 'approved_by', 'requested_at'],
  properties: {
    type: { const: 'finance.report.request' },
    periode: { type: 'string', pattern: '^20[0-9]{2}-(0[1-9]|1[0-2])$' }, // YYYY-MM
    departements: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, maxItems: 20 },
    approved_by: { type: 'string', pattern: NPUB_PATTERN },
    requested_at: { type: 'string', format: 'date-time' },
  },
};

export const COMMAND_SCHEMAS = [
  claimSettlementApprove,
  claimSettlementReject,
  policyPricingExceptionApprove,
  killswitchActivate,
  killswitchDeactivate,
  financeReportRequest,
] as const;

export type CommandType =
  | 'claim.settlement.approve'
  | 'claim.settlement.reject'
  | 'policy.pricing.exception.approve'
  | 'agent.killswitch.activate'
  | 'agent.killswitch.deactivate'
  | 'finance.report.request';

export interface ClaimSettlementApproveCommand {
  type: 'claim.settlement.approve';
  /** Deterministic command identifier (correlated on the idempotence side). */
  claim_id: string;
  max_amount_eur: number;
  reason: string;
  approved_by: string;
  requested_at: string;
}

export type Command =
  | ClaimSettlementApproveCommand
  | { type: 'claim.settlement.reject'; claim_id: string; reason: string; approved_by: string; requested_at: string }
  | { type: 'policy.pricing.exception.approve'; contrat_id: string; new_prime_eur: number; reason: string; approved_by: string; requested_at: string }
  | { type: 'agent.killswitch.activate'; approved_by: string; reason: string; requested_at: string }
  | { type: 'agent.killswitch.deactivate'; approved_by: string; reason: string; requested_at: string }
  | { type: 'finance.report.request'; periode: string; departements: string[]; approved_by: string; requested_at: string };

type AjvInstance = InstanceType<typeof AjvNs.Ajv>;
const AjvCtor = AjvNs as unknown as new (o?: import('ajv').Options) => AjvInstance;
const addFormats = formatsPluginNs as unknown as FormatsPlugin;

export function buildAjv(): AjvInstance {
  const ajv = new AjvCtor({ allErrors: true, strict: true });
  addFormats(ajv);
  for (const s of COMMAND_SCHEMAS) {
    ajv.addSchema(s);
  }
  return ajv;
}

export interface ValidationFailure {
  ok: false;
  errors: string[];
}

export interface ValidationSuccess {
  ok: true;
  command: Command;
  /** Stable fingerprint of the command content, used as command_id for idempotence. */
  commandId: string;
}

export function validateCommand(raw: unknown): ValidationSuccess | ValidationFailure {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['Non-object payload: free-form text rejected'] };
  }
  const obj = raw as Record<string, unknown>;
  const type = obj['type'];
  if (typeof type !== 'string') {
    return { ok: false, errors: ["Missing or non-string 'type' field"] };
  }
  const ajv = buildAjv();
  const validate = ajv.getSchema(type);
  if (validate === undefined) {
    return { ok: false, errors: [`Unknown command type: ${type}`] };
  }
  const valid = validate(obj);
  if (valid !== true) {
    const errors = (validate.errors ?? []).map(fmtErr);
    return { ok: false, errors };
  }
  return { ok: true, command: obj as unknown as Command, commandId: commandIdOf(obj as unknown as Command) };
}

function fmtErr(e: ErrorObject): string {
  const path = e.instancePath === '' ? '/' : e.instancePath;
  return `${path} ${e.message ?? e.keyword}`;
}

/** Stable command id: canonical fingerprint of the content (not the transport). */
export function commandIdOf(cmd: Command): string {
  return `${cmd.type}:${stableStringify(cmd)}`;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export { common };
