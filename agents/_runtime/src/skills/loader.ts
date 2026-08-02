/**
 * Chargeur de skills : fichiers `*.md` dans SKILLS_DIR.
 *
 * Format : frontmatter YAML minimal entre `---` (clés simples `nom: valeur`,
 * listes en ligne `[a, b]` ou à puces) puis le corps = instruction injectée
 * dans le prompt système. Le parsing est volontairement simple et robuste :
 * un skill mal formé est ignoré avec un warn, jamais un crash au démarrage.
 *
 * Placeholders `${NOM_ENV}` remplacés depuis process.env.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from 'pino';

export interface Skill {
  name: string;
  description: string;
  /** Corps du skill (instructions métier) injecté dans le prompt système. */
  systemTemplate: string;
  /** Outils Hermes que ce skill est censé mobiliser (informatif). */
  toolsAllowed: string[];
}

function parseInlineList(value: string): string[] {
  const trimmed = value.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter((s) => s.length > 0);
  }
  return [];
}

interface ParsedFrontmatter {
  data: Record<string, string | string[]>;
  body: string;
}

export function parseSkillMarkdown(raw: string): ParsedFrontmatter {
  const text = raw.replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) {
    return { data: {}, body: text.trim() };
  }
  const end = text.indexOf('\n---', 4);
  if (end === -1) {
    return { data: {}, body: text.trim() };
  }
  const frontmatter = text.slice(4, end);
  const body = text.slice(end + 4).trim();

  const data: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  for (const line of frontmatter.split('\n')) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (kv !== null) {
      const key = kv[1] as string;
      const value = (kv[2] ?? '').trim();
      if (value === '') {
        // Peut être le début d'une liste à puces.
        listKey = key;
        data[key] = [];
      } else if (value.startsWith('[')) {
        data[key] = parseInlineList(value);
        listKey = null;
      } else {
        data[key] = value;
        listKey = null;
      }
      continue;
    }
    const bullet = /^\s*-\s+(.+)$/.exec(line);
    if (bullet !== null && listKey !== null) {
      const existing = data[listKey];
      if (Array.isArray(existing)) existing.push((bullet[1] as string).trim());
    }
  }
  return { data, body };
}

function toSkill(filename: string, parsed: ParsedFrontmatter): Skill {
  const data = parsed.data;
  const asString = (k: string): string => {
    const v = data[k];
    return typeof v === 'string' ? v : '';
  };
  const asList = (k: string): string[] => {
    const v = data[k];
    return Array.isArray(v) ? v : parseInlineList(String(v ?? ''));
  };
  const fallbackName = filename.replace(/\.md$/i, '');
  return {
    name: asString('name') || fallbackName,
    description: asString('description') || asString('role') || '',
    systemTemplate: parsed.body,
    toolsAllowed: asList('tools'),
  };
}

function interpolateEnv(text: string): string {
  return text.replace(/\$\{([A-Z0-9_]+)\}/g, (_m, name: string) => process.env[name] ?? '');
}

/** Charge tous les skills d'un répertoire. Répertoire absent/fichier illisible → ignoré. */
export async function loadSkills(dir: string, logger: Logger): Promise<Skill[]> {
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith('.md'));
  } catch {
    logger.warn({ action: 'skills.dir_missing', dir }, 'SKILLS_DIR introuvable — aucun skill chargé');
    return [];
  }
  const skills: Skill[] = [];
  for (const f of files.sort()) {
    try {
      const raw = interpolateEnv(await readFile(join(dir, f), 'utf8'));
      skills.push(toSkill(f, parseSkillMarkdown(raw)));
    } catch {
      logger.warn({ action: 'skills.unreadable', file: f }, 'skill illisible — ignoré');
    }
  }
  logger.info({ action: 'skills.loaded', count: skills.length, dir }, 'skills chargés');
  return skills;
}
