/**
 * Global kill-switch: `kill_switch` row (id=1) in the database.
 * Polled before EVERY autonomous/outward action; cache bounded to 2 s max.
 * Fail-closed: on read error, the previous state is kept,
 * and if there is none yet, the action is denied (unknown state = cautious).
 */
import type { Logger } from 'pino';
import type { DbClient } from '../db/client.js';

export const KILL_SWITCH_CACHE_MS = 2_000;

interface CacheEntry {
  value: boolean;
  at: number;
}

export class KillSwitch {
  private cache: CacheEntry | null = null;

  constructor(
    private readonly db: DbClient,
    private readonly logger: Logger,
    private readonly cacheMs: number = KILL_SWITCH_CACHE_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async isActive(): Promise<boolean> {
    const now = this.now();
    if (this.cache !== null && now - this.cache.at < this.cacheMs) {
      return this.cache.value;
    }
    try {
      const r = await this.db.query<{ actif: boolean }>(
        'SELECT actif FROM kill_switch WHERE id = 1',
      );
      const value = r.rows[0]?.actif === true;
      this.cache = { value, at: now };
      return value;
    } catch {
      // Fail-closed: cannot read the state → keep the cache or deny.
      return this.cache?.value ?? true;
    }
  }

  /** Checks before an autonomous action; throws KillSwitchActiveError if active. */
  async assertAllows(action: string): Promise<void> {
    if (await this.isActive()) {
      this.logger.warn({ action }, 'killswitch active — autonomous action denied');
      throw new KillSwitchActiveError(action);
    }
  }
}

export class KillSwitchActiveError extends Error {
  constructor(public readonly action: string) {
    super(`Kill-switch active: autonomous action denied (${action})`);
    this.name = 'KillSwitchActiveError';
  }
}
