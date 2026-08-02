/**
 * Anonymisation PII avant tout texte envoyé au LLM ou renvoyé vers l'extérieur.
 *
 * Chemin nominal : Presidio (`POST /analyze` puis `POST /anonymize` sur l'anonymizer
 * dérivé de PRESIDIO_URL, ou `PRESIDIO_ANONYMIZER_URL` si défini).
 * Fallback : stub regex local (email, téléphones FR/intl, IBAN, NIR sécu FR) —
 * utilisé si Presidio est injoignable, avec un `warn` structuré.
 *
 * AUCUN contenu brut n'est journalisé (risque PII) : seuls compteurs et warnings.
 */
import type { Logger } from 'pino';

interface PresidioEntity {
  entity_type: string;
  start: number;
  end: number;
  score: number;
}

export interface Anonymizer {
  anonymize(text: string): Promise<string>;
}

export interface AnonymizerDeps {
  presidioUrl: string;
  logger: Logger;
  fetch?: typeof fetch;
}

const ANALYZER_PORT_FROM = ':3000';
const ANONYMIZER_PORT_TO = ':3001';

/** Regex locales (fallback) — ordre : le plus spécifique d'abord (IBAN/NIR avant téléphone). */
const PII_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /\b[A-Z]{2}\d{2}(?:[ ]?\d{4}){3,6}\b/g, label: 'IBAN' },
  { re: /\b[12][ .]?\d{2}[ .]?(?:0[1-9]|1[0-2])[ .]?\d{2}[ .]?\d{3}[ .]?\d{3}(?:[ .]?\d{2})?\b/g, label: 'NIR' },
  { re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, label: 'EMAIL' },
  { re: /(?:\+33 ?|0033 ?|0)[1-9](?:[ .-]?\d{2}){4}(?!\d)/g, label: 'PHONE' },
];

export function fallbackMask(text: string): { text: string; redactions: number } {
  let out = text;
  let redactions = 0;
  for (const { re, label } of PII_PATTERNS) {
    out = out.replace(re, () => {
      redactions += 1;
      return `[${label}]`;
    });
  }
  return { text: out, redactions };
}

export function createAnonymizer(deps: AnonymizerDeps): Anonymizer {
  const fetchFn = deps.fetch ?? fetch;
  const analyzerUrl = deps.presidioUrl.replace(/\/$/, '');
  const anonymizerUrl =
    (process.env['PRESIDIO_ANONYMIZER_URL'] ?? '').replace(/\/$/, '') !== ''
      ? (process.env['PRESIDIO_ANONYMIZER_URL'] as string).replace(/\/$/, '')
      : analyzerUrl.includes(ANALYZER_PORT_FROM)
        ? analyzerUrl.replace(ANALYZER_PORT_FROM, ANONYMIZER_PORT_TO)
        : analyzerUrl;

  async function viaPresidio(text: string): Promise<string> {
    const analyzeResp = await fetchFn(`${analyzerUrl}/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, language: 'fr' }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!analyzeResp.ok) throw new Error(`presidio analyze HTTP ${analyzeResp.status}`);
    const entities = (await analyzeResp.json()) as PresidioEntity[];
    if (!Array.isArray(entities) || entities.length === 0) return text;

    const anonymizeResp = await fetchFn(`${anonymizerUrl}/anonymize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        analyzer_results: entities,
        anonymizers: { DEFAULT: { type: 'mask', masking_char: '*', chars_to_mask: 8 } },
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!anonymizeResp.ok) throw new Error(`presidio anonymize HTTP ${anonymizeResp.status}`);
    const result = (await anonymizeResp.json()) as { text?: string };
    if (typeof result.text !== 'string') throw new Error('presidio anonymize: réponse invalide');
    return result.text;
  }

  return {
    async anonymize(text: string): Promise<string> {
      try {
        return await viaPresidio(text);
      } catch {
        // Fallback local : critique si la donnée irait au LLM sans anonymisation.
        const { text: masked, redactions } = fallbackMask(text);
        deps.logger.warn(
          { action: 'anonymize.fallback_regex', redactions },
          'Presidio injoignable — anonymisation regex de secours',
        );
        return masked;
      }
    },
  };
}

/**
 * Garde-fou : détecte des PII résiduelles (email/téléphone/IBAN/NIR) dans un
 * texte sur le point d'être expédié. Ne lève pas — le runtime applique un
 * dernier masquage de secours à la place.
 */
export function assertNoPii(text: string): boolean {
  return PII_PATTERNS.some(({ re }) => new RegExp(re.source, re.flags).test(text));
}

/** Dernier rideau : masque tout ce qui reste avant sortie. */
export function finalScrub(text: string): string {
  return fallbackMask(text).text;
}
