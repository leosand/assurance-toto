/**
 * Bonus: the loader actually parses the skills of the 4 departments
 * (frontmatter + body, interpolated ${ENV} placeholders). File reads only.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import pino from 'pino';
import { loadSkills, parseSkillMarkdown } from '../src/skills/loader.js';

const silent = pino({ level: 'silent' });
const AGENTS_DIR = join(__dirname, '..', '..');

describe('skills loader', () => {
  it('parse un frontmatter + corps minimal', () => {
    const raw = `---\nname: demo\ndescription: test\ntools: [lire_client, calculer_prime]\n---\n\n# Corps\nInstructions.`;
    const parsed = parseSkillMarkdown(raw);
    expect(parsed.data['name']).toBe('demo');
    expect(parsed.data['tools']).toEqual(['lire_client', 'calculer_prime']);
    expect(parsed.body).toContain('# Corps');
  });

  it('loads the real skills of the 4 departments', async () => {
    process.env['HERMES_ESCALATION_THRESHOLD_EUR'] = '5000';
    for (const dept of ['orchestrateur', 'sales', 'souscription', 'sinistres-contentieux']) {
      const skills = await loadSkills(join(AGENTS_DIR, dept, 'skills'), silent);
      expect(skills.length).toBeGreaterThanOrEqual(1);
      for (const s of skills) {
        expect(s.name.length).toBeGreaterThan(0);
        expect(s.systemTemplate.length).toBeGreaterThan(0);
        expect(Array.isArray(s.toolsAllowed)).toBe(true);
      }
    }
    // Checks the expected content on a known case.
    const sin = await loadSkills(join(AGENTS_DIR, 'sinistres-contentieux', 'skills'), silent);
    const neg = sin.find((s) => s.name === 'negociation-reglement');
    expect(neg).toBeDefined();
    expect(neg?.toolsAllowed).toContain('recommander_reglement');
    expect(neg?.systemTemplate).toContain('5000'); // interpolated ${HERMES_ESCALATION_THRESHOLD_EUR}
  });

  it('a missing directory returns [] without crashing', async () => {
    const skills = await loadSkills('/nope/does-not-exist', silent);
    expect(skills).toEqual([]);
  });
});
