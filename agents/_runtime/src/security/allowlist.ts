/**
 * Per-agent tool allowlist: deny-by-default.
 * Source: per-department JSON file (`mcp-allowlist.json`), whose path is
 * passed to the runtime via `HERMES_ALLOWLIST_PATH` (default `./mcp-allowlist.json`).
 * An agent without an allowlist file = no authorized tool.
 */
import { readFile } from 'node:fs/promises';

export interface AllowlistFile {
  /** Authorized internal Hermes tools (registry tools). */
  tools?: string[];
  /** Accessible MCP servers (usage via the gateway). */
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

/** Loads the allowlist from a JSON path; missing file = deny-all. */
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

/** Deny-by-default: unlisted tool = denied (never executed). */
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
    super(`Tool denied by allowlist: ${toolName}`);
    this.name = 'ToolNotAllowedError';
  }
}
