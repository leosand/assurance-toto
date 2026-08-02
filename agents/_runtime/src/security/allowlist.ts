/**
 * Allowlist d'outils par agent : deny-by-default.
 * Source : fichier JSON par département (`mcp-allowlist.json`), dont le chemin
 * est passé au runtime via `HERMES_ALLOWLIST_PATH` (défaut `./mcp-allowlist.json`).
 * Un agent sans fichier d'allowlist = aucun outil autorisé.
 */
import { readFile } from 'node:fs/promises';

export interface AllowlistFile {
  /** Outils internes Hermes autorisés (registry tools). */
  tools?: string[];
  /** Serveurs MCP accessibles (usage via la gateway). */
  mcp_servers?: string[];
}

export interface Allowlist {
  tools: ReadonlySet<string>;
  mcpServers: ReadonlySet<string>;
}

export const EMPTY_ALLOWLIST: Allowlist = Object.freeze({
  tools: new Set<string>(),
  mcpServers: new Set<string>(),
});

export function createAllowlist(file: AllowlistFile | null): Allowlist {
  if (file === null) return { tools: new Set(), mcpServers: new Set() };
  return {
    tools: new Set(Array.isArray(file.tools) ? file.tools : []),
    mcpServers: new Set(Array.isArray(file.mcp_servers) ? file.mcp_servers : []),
  };
}

/** Charge l'allowlist depuis un chemin JSON ; absence du fichier = deny-all. */
export async function loadAllowlist(path: string): Promise<Allowlist> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return EMPTY_ALLOWLIST;
    }
    return createAllowlist(raw as AllowlistFile);
  } catch {
    return EMPTY_ALLOWLIST;
  }
}

/** Deny-by-default : outil non listé = refusé (jamais exécuté). */
export function assertAllowed(allowlist: Allowlist, toolName: string): void {
  if (!allowlist.tools.has(toolName)) {
    throw new ToolNotAllowedError(toolName);
  }
}

export function isAllowed(allowlist: Allowlist, toolName: string): boolean {
  return allowlist.tools.has(toolName);
}

export class ToolNotAllowedError extends Error {
  constructor(public readonly toolName: string) {
    super(`Outil refusé par l'allowlist : ${toolName}`);
    this.name = 'ToolNotAllowedError';
  }
}
