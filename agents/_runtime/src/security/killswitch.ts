/**
 * Kill-switch global : ligne `kill_switch` (id=1) en base.
 * Pollé avant CHAQUE action autonome/outward ; cache borné à 2 s max.
 * Fail-closed : en cas d'erreur de lecture, l'état précédent est conservé,
 * et s'il n'y en a pas encore, l'action est refusée (état inconnu = prudent).
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
      // Fail-closed : impossible de lire l'état → on conserve le cache ou on refuse.
      return this.cache?.value ?? true;
    }
  }

  /** Vérifie avant une action autonome ; lève KillSwitchActiveError si actif. */
  async assertAllows(action: string): Promise<void> {
    if (await this.isActive()) {
      this.logger.warn({ action }, 'killswitch actif — action autonome refusée');
      throw new KillSwitchActiveError(action);
    }
  }
}

export class KillSwitchActiveError extends Error {
  constructor(public readonly action: string) {
    super(`Kill-switch actif : action autonome refusée (${action})`);
    this.name = 'KillSwitchActiveError';
  }
}
