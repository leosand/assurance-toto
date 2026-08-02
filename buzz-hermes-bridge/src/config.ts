/**
 * Central config: every tunable comes from env with sane local defaults.
 * Never logged (secrets are redacted in `redacted()`).
 */
export interface BridgeConfig {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  buzzRelayUrl: string;
  /** nsec/hex secret for the bridge's Nostr identity (undefined → NullCollabAdapter). */
  buzzPrivateKey?: string;
  /** npubs allowed to act as CEO (comma-separated). */
  bridgeCeoPubkeys: string[];
  /** Plafond autorisé pour un règlement direct, en EUR. */
  claimSettlementThresholdEur: number;
  /** Anti-forgery : exiger un event Nostr signé sur /commands (PRODUCTION = true). */
  requireSignedCommands: boolean;
  /** npub/hex allowlistés sans signature (agents Hermes ; JAMAIS le CEO). */
  allowedUnsignedRoles: string[];
  /** TTL des approbations en attente, en minutes. */
  approvalTtlMinutes: number;
  /** Nombre maximal de tentatives avant DLQ. */
  dlqMaxAttempts: number;
}

function readEnv(source: NodeJS.ProcessEnv, name: string): string | undefined {
  const v = source[name];
  return v === undefined || v === '' ? undefined : v;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const buzzPrivateKey = readEnv(source, 'BUZZ_PRIVATE_KEY');
  const cfg: BridgeConfig = {
    port: Number(source['PORT'] ?? '3100'),
    databaseUrl: source['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5432/assurance_toto',
    redisUrl: source['REDIS_URL'] ?? 'redis://localhost:6379',
    buzzRelayUrl: source['BUZZ_RELAY_URL'] ?? 'http://localhost:3000',
    ...(buzzPrivateKey !== undefined ? { buzzPrivateKey } : {}),
    bridgeCeoPubkeys: (source['BRIDGE_CEOPUBKEYS'] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    claimSettlementThresholdEur: Number(source['CLAIM_SETTLEMENT_THRESHOLD_EUR'] ?? '5000'),
    // Anti-forgery (brief §6A) : en production, OBLIGATOIRE à true — toute commande
    // à effet CEO irréversible doit arriver avec un event Nostr vérifié (kind 9).
    // false ne sert qu'à garder la démo locale utilisable sans WS Nostr en Phase 1.
    requireSignedCommands: (readEnv(source, 'BRIDGE_REQUIRE_SIGNED_COMMANDS') ?? 'false') === 'true',
    // Allowlist des npub/hex d'AGENTS acceptés SANS signature (Phase 1 démo).
    // Un npub présent dans BRIDGE_CEOPUBKEYS n'y a jamais droit (sinon forge CEO).
    allowedUnsignedRoles: (source['BRIDGE_ALLOWED_UNSIGNED_ROLES'] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    approvalTtlMinutes: Number(source['APPROVAL_TTL_MINUTES'] ?? '10080'),
    dlqMaxAttempts: Number(source['DLQ_MAX_ATTEMPTS'] ?? '3'),
  };
  if (cfg.buzzPrivateKey !== undefined && !/^(nsec1[02-9ac-hj-np-z]+|[0-9a-f]{64})$/.test(cfg.buzzPrivateKey)) {
    throw new Error('BUZZ_PRIVATE_KEY doit être un nsec1… ou un hex 64 chars');
  }
  return cfg;
}

/** Config sans secrets — sûre pour les logs de démarrage. */
export function safeConfig(cfg: BridgeConfig): Record<string, unknown> {
  return {
    port: cfg.port,
    databaseUrl: maskUrl(cfg.databaseUrl),
    redisUrl: maskUrl(cfg.redisUrl),
    buzzRelayUrl: cfg.buzzRelayUrl,
    buzzPrivateKey: cfg.buzzPrivateKey !== undefined ? '***present***' : 'absent',
    bridgeCeoPubkeys: cfg.bridgeCeoPubkeys,
    claimSettlementThresholdEur: cfg.claimSettlementThresholdEur,
    requireSignedCommands: cfg.requireSignedCommands,
    allowedUnsignedRoles: cfg.allowedUnsignedRoles,
    approvalTtlMinutes: cfg.approvalTtlMinutes,
    dlqMaxAttempts: cfg.dlqMaxAttempts,
    buzzConfigured: cfg.buzzPrivateKey !== undefined,
  };
}

function maskUrl(url: string): string {
  return url.replace(/:\/\/[^@/]+@/, '://***@');
}

export const buzzConfigured = (cfg: BridgeConfig): boolean => cfg.buzzPrivateKey !== undefined && cfg.buzzPrivateKey.length > 0;
