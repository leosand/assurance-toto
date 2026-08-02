/**
 * Cockpit CEO (ADR-002, option cockpit lean) : page HTML auto-suffisante
 * rendue côté serveur, 100 % lecture seule sur Postgres via le Repository.
 * Aucune dépendance front, aucun CDN : CSS inline + barres CSS générées ici,
 * pour rester utilisable en démo sans réseau.
 *
 * Chaque section rapporte sa fraîcheur (MAX(created_at) des données sources)
 * et, en cas d'erreur de sa requête, s'affiche « indisponible » au lieu de 500.
 */
import type { DashboardSnapshot, PnlWeeklyRow } from '../db/repository.js';

export interface DashboardParams {
  snapshot: () => Promise<DashboardSnapshot>;
  /** npub/hex CEO injecté dans les formulaires (whitelist vérifiée côté POST). */
  ceoPubkey: string;
  /** correlation_id à surligner (paramètre ?correlation_id=). */
  highlight?: string;
  /** Message affiché après une action (ex. ?decided=12345). */
  notice?: string;
  generatedAt?: Date;
}

const esc = (s: unknown): string =>
  String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const fmtEur = (n: number): string => eur.format(n);
const fmtDate = (iso: string | null | undefined): string => {
  if (iso === null || iso === undefined || iso === '') return 'n-d';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? esc(iso) : d.toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' });
};
const signed = (n: number): string => (n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero');
const cls = (n: number): string => (n > 0 ? 'good' : n < 0 ? 'bad' : 'muted');

const UNAVAILABLE = `
  <div class="unavailable">
    <strong>Section indisponible</strong>
    <p>La source de données n'a pas répondu. Le reste du cockpit reste consultable.</p>
  </div>`;

async function section<T>(load: () => Promise<T>, renderFn: (d: T) => string): Promise<string> {
  try {
    return renderFn(await load());
  } catch {
    return UNAVAILABLE;
  }
}

function freshness(latest: string | null): string {
  return `<span class="freshness">fraîcheur : ${esc(fmtDate(latest))}</span>`;
}

function card(titre: string, inner: string): string {
  return `<section class="card"><div class="card-head"><h2>${titre}</h2></div>${inner}</section>`;
}

/** Barres de tendance CSS-only : dernières semaines, résultat net agrégé. */
function trendBars(rows: PnlWeeklyRow[]): string {
  const weeks = new Map<string, number>();
  for (const r of rows) weeks.set(r.semaine_iso, (weeks.get(r.semaine_iso) ?? 0) + r.resultat_net);
  const series = [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-8);
  if (series.length === 0) return '<p class="muted">Aucune écriture P&amp;L hebdomadaire.</p>';
  const maxAbs = Math.max(...series.map(([, v]) => Math.abs(v)), 1);
  const bars = series
    .map(([week, v]) => {
      const h = Math.round((Math.abs(v) / maxAbs) * 100);
      const label = esc(week.slice(5)); // MM-JJ
      return `<div class="bar-col" title="${esc(week)} : ${esc(fmtEur(v))}">
        <div class="bar-wrap"><div class="bar ${signed(v)}" style="height:${Math.max(h, 3)}%"></div></div>
        <div class="bar-label mono">${label}</div>
      </div>`;
    })
    .join('');
  return `<div class="trend">${bars}</div>`;
}

const CSS = `
:root{--bg:#0e1116;--panel:#161b23;--panel2:#1c232e;--border:#2a3342;--text:#dbe2ec;--muted:#8b96a6;
--good:#37c978;--bad:#e5534b;--accent:#d4a94e;--chip:#212a37}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px}
.mono,code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}
header.hero{margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid var(--border)}
h1{font-size:22px;letter-spacing:.4px}
.sub{color:var(--muted);margin-top:4px}
.badge-demo{display:inline-block;background:var(--chip);border:1px solid var(--border);border-radius:999px;
padding:2px 12px;font-size:12px;color:var(--muted);margin-top:8px}
.notice{background:#123520;border:1px solid var(--good);color:var(--good);border-radius:8px;padding:10px 14px;margin:12px 0}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(340px,1fr))}
.wide{grid-column:1/-1}
.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:14px 16px}
.card-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:10px}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:600}
.kpis{display:flex;gap:22px;flex-wrap:wrap}
.kpi .v{font-size:22px;font-weight:700}
.kpi .l{color:var(--muted);font-size:12px}
.good{color:var(--good)} .bad{color:var(--bad)} .muted{color:var(--muted)}
.good{color:var(--good)} .bad{color:var(--bad)}
.freshness{color:var(--muted);font-size:11px;font-style:italic}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em;
border-bottom:1px solid var(--border);padding:4px 6px}
td{padding:5px 6px;border-bottom:1px solid #202834}
tr.hl{background:#2b2410;outline:1px solid var(--accent)}
.pill{display:inline-block;border:1px solid var(--border);background:var(--chip);border-radius:6px;padding:0 8px;font-size:12px}
.trend{display:flex;gap:6px;align-items:flex-end;height:120px;margin-top:8px}
.bar-col{display:flex;flex-direction:column;align-items:center;flex:1;height:100%}
.bar-wrap{flex:1;width:100%;display:flex;align-items:flex-end;background:var(--panel2);border-radius:4px 4px 0 0;overflow:hidden}
.bar{width:100%} .bar.pos{background:var(--good)} .bar.neg{background:var(--bad)} .bar.zero{background:var(--muted)}
.bar-label{font-size:10px;color:var(--muted);margin-top:4px}
.ks-banner{border-radius:8px;padding:10px 14px;font-weight:600;margin-bottom:10px}
.ks-ok{background:#123520;border:1px solid var(--good);color:var(--good)}
.ks-on{background:#3d1715;border:1px solid var(--bad);color:#ff9d97}
form.inline{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap}
input[type=text]{background:var(--panel2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 8px;font:inherit;font-size:12px;min-width:200px}
button{background:var(--accent);color:#14100a;border:0;border-radius:6px;padding:6px 14px;font-weight:700;cursor:pointer}
button.refuse{background:var(--panel2);color:var(--bad);border:1px solid var(--bad)}
.unavailable{border:1px dashed var(--bad);border-radius:8px;padding:12px;color:var(--muted)}
.unavailable strong{color:var(--bad)}
.count-big{font-size:34px;font-weight:800}
.scroll{max-height:280px;overflow:auto}
footer{color:var(--muted);font-size:12px;margin-top:18px;border-top:1px solid var(--border);padding-top:10px}
`;

export async function renderDashboard(p: DashboardParams): Promise<string> {
  const generatedAt = p.generatedAt ?? new Date();
  const hl = p.highlight ?? '';

  // Une seule passe de lecture ; une section en échec n'emporte pas les autres.
  const snap = await p.snapshot().catch(() => null);
  const failFast = UNAVAILABLE;

  // --- P&L ---
  const pnlSection = snap === null ? failFast : await section(
    () => Promise.resolve(snap),
    (s) => {
      // Résultat net hebdo toutes directions : Σ de la semaine la plus récente.
      const byWeek = new Map<string, number>();
      for (const r of s.pnlHebdo) byWeek.set(r.semaine_iso, (byWeek.get(r.semaine_iso) ?? 0) + r.resultat_net);
      const recentWeeks = [...byWeek.entries()].filter(([w]) => w !== 'n-d').sort((a, b) => b[0].localeCompare(a[0]));
      const lastWeek: number | null = recentWeeks.length > 0 ? (recentWeeks[0]?.[1] ?? null) : null;
      const ratioRows = s.ratios
        .map((r) => `<tr><td>${esc(r.departement)}</td><td class="mono">${r.ratio === null ? 'n-d' : (r.ratio * 100).toFixed(1) + ' %'}</td></tr>`)
        .join('');
      return card('P&amp;L', `
        <div class="kpis">
          <div class="kpi"><div class="v ${cls(s.pnl.resultat_cumule)}">${esc(fmtEur(s.pnl.resultat_cumule))}</div><div class="l">Résultat net cumulé (${s.pnl.nb_ecritures} écritures)</div></div>
          ${lastWeek === null ? '' : `<div class="kpi"><div class="v ${cls(lastWeek)}">${esc(fmtEur(lastWeek))}</div><div class="l">Résultat net — dernière semaine (tous départements)</div></div>`}
        </div>
        ${ratioRows === '' ? '<p class="muted">Aucun ratio de sinistralité.</p>' : `<table><thead><tr><th>Département</th><th>Ratio sinistres/primes</th></tr></thead><tbody>${ratioRows}</tbody></table>`}
        ${trendBars(s.pnlHebdo)}
        ${freshness(s.pnl.latest)}
      `);
    },
  );

  // --- Pipeline commercial ---
  const pipelineSection = snap === null ? failFast : await section(
    () => Promise.resolve(snap),
    (s) => {
      const conv = s.pipeline.contrats > 0 || s.pipeline.clients > 0
        ? (s.pipeline.clients > 0 ? ((s.pipeline.contrats / s.pipeline.clients) * 100).toFixed(1) + ' %' : 'n-d')
        : 'n-d';
      return card('Pipeline commercial', `
        <div class="kpis">
          <div class="kpi"><div class="v">${s.pipeline.clients}</div><div class="l">Clients</div></div>
          <div class="kpi"><div class="v">${s.pipeline.contrats}</div><div class="l">Contrats</div></div>
          <div class="kpi"><div class="v">${esc(conv)}</div><div class="l">Contrats / client</div></div>
          <div class="kpi"><div class="v muted">n-d</div><div class="l">Leads (non dérivable du schéma actuel)</div></div>
        </div>
        ${freshness(s.pipeline.latest)}
      `);
    },
  );

  // --- Sinistres ---
  const sinistresSection = snap === null ? failFast : await section(
    () => Promise.resolve(snap),
    (s) => {
      const order = ['ouvert', 'en_cours', 'contentieux', 'regle', 'refuse'];
      const rows = [...s.sinistres.rows].sort((a, b) => order.indexOf(a.statut) - order.indexOf(b.statut));
      const totalProvisionne = rows.filter((r) => r.statut !== 'regle' && r.statut !== 'refuse').reduce((a, r) => a + r.montant, 0);
      const totalRegle = rows.find((r) => r.statut === 'regle')?.montant ?? 0;
      const bodyRows = rows
        .map((r) => `<tr><td><span class="pill">${esc(r.statut)}</span></td><td class="mono">${r.nb}</td><td class="mono">${esc(fmtEur(r.montant))}</td></tr>`)
        .join('');
      return card('Sinistres', `
        <div class="kpis">
          <div class="kpi"><div class="v">${esc(fmtEur(totalProvisionne))}</div><div class="l">Provisionné (ouvert/en cours/contentieux)</div></div>
          <div class="kpi"><div class="v">${esc(fmtEur(totalRegle))}</div><div class="l">Réglé</div></div>
        </div>
        ${bodyRows === '' ? '<p class="muted">Aucun sinistre en base.</p>' : `<table><thead><tr><th>Statut</th><th>Nb</th><th>Montant</th></tr></thead><tbody>${bodyRows}</tbody></table>`}
        ${freshness(s.sinistres.latest)}
      `);
    },
  );

  // --- Approbations CEO ---
  const approSection = snap === null ? failFast : await section(
    () => Promise.resolve(snap),
    (s) => {
      const rows = s.approbationsEnAttente.map((a) => {
        const isHl = hl !== '' && a.correlation_id === hl;
        return `<tr class="${isHl ? 'hl' : ''}">
          <td class="mono">${esc(a.correlation_id)}</td>
          <td>${esc(a.type)}</td>
          <td class="mono">${esc(a.claim_id ?? '—')}</td>
          <td class="mono">${a.montant_eur === null ? '—' : esc(fmtEur(a.montant_eur))}</td>
          <td class="mono">${esc((a.requested_by ?? '—').slice(0, 16))}…</td>
          <td>
            <form class="inline" method="post" action="/approvals/${esc(a.correlation_id)}/decide">
              <input type="hidden" name="decided_by" value="${esc(p.ceoPubkey)}">
              <input type="hidden" name="reason" value="decision CEO via cockpit (démo)">
              <button type="submit" name="approve" value="true">Approuver</button>
              <button class="refuse" type="submit" name="approve" value="false">Refuser</button>
            </form>
          </td>
        </tr>`;
      }).join('');
      return card('Approbations CEO', `
        <div class="kpis"><div class="kpi"><div class="count-big ${s.approbationsEnAttente.length > 0 ? 'bad' : 'good'}">${s.approbationsEnAttente.length}</div><div class="l">en attente</div></div></div>
        ${rows === '' ? '<p class="muted">Aucune demande en attente.</p>' : `<div class="scroll"><table><thead><tr><th>correlation_id</th><th>Type</th><th>Claim</th><th>Montant</th><th>Demandeur</th><th>Décision</th></tr></thead><tbody>${rows}</tbody></table></div>`}
        <p class="muted">Surface de décision DÉMO — en production, chaque décision doit être signée Nostr (event kind 9 vérifié par l'endpoint).</p>
        ${freshness(s.approbationsEnAttente[0]?.created_at ?? null)}
      `);
    },
  );

  // --- Conformité / macro ---
  const conformiteSection = snap === null ? failFast : await section(
    () => Promise.resolve(snap),
    (s) => {
      const macroRows = s.macro
        .map((m) => `<tr><td>${esc(m.indicateur)}</td><td class="mono">${m.valeur === null ? 'n-d' : String(m.valeur)}</td><td>${esc(m.periode ?? '—')}</td><td>${esc(m.source ?? '—')}</td></tr>`)
        .join('');
      return card('Conformité &amp; contexte macro', `
        <p>${s.anonymisation.tracked ? `<strong>${s.anonymisation.count}</strong> événement(s) d'audit référençant l'anonymisation (pseudo-anonymisation avant stockage, principe RGPD appliqué aux payloads).` : `Traçabilité d'anonymisation non dénombrable sur ce schéma — principe appliqué : pseudo-anonymisation avant stockage (RGPD).`}</p>
        ${macroRows === '' ? '<p class="muted">Aucun macro-indicateur.</p>' : `<table><thead><tr><th>Indicateur</th><th>Valeur</th><th>Période</th><th>Source</th></tr></thead><tbody>${macroRows}</tbody></table>`}
        ${freshness(s.macro[0]?.created_at ?? null)}
      `);
    },
  );

  // --- Kill-switch ---
  const ksSection = snap === null ? failFast : await section(
    () => Promise.resolve(snap),
    (s) => {
      const ks = s.killSwitch;
      const actif = ks?.actif === true;
      const banner = actif
        ? `<div class="ks-banner ks-on">KILL-SWITCH ACTIF — pipeline suspendu${ks?.active_par ? ` (par <span class="mono">${esc(ks.active_par.slice(0, 20))}…</span> le ${esc(fmtDate(ks.active_le))})` : ''}</div>`
        : `<div class="ks-banner ks-ok">Agents opérationnels — kill-switch inactif</div>`;
      return card('État agents &amp; kill-switch', `
        ${banner}
        <form class="inline" method="post" action="/killswitch">
          <input type="hidden" name="decided_by" value="${esc(p.ceoPubkey)}">
          <input type="hidden" name="reason" value="action cockpit CEO (démo)">
          <button type="submit" name="active" value="${actif ? 'false' : 'true'}">${actif ? 'Désactiver le kill-switch' : 'ACTIVER LE KILL-SWITCH'}</button>
        </form>
        <p class="muted">DÉMO : authentification par npub CEO en configuration. Production : exiger un event Nostr signé.</p>
      `);
    },
  );

  // --- Timeline audit ---
  const timelineSection = snap === null ? failFast : await section(
    () => Promise.resolve(snap),
    (s) => {
      const rows = s.timeline.map((t) => {
        const isHl = hl !== '' && t.correlation_id === hl;
        return `<tr class="${isHl ? 'hl' : ''}"><td class="mono">${esc(fmtDate(t.created_at))}</td><td>${esc(t.source)}</td><td>${esc(t.action)}</td><td class="mono">${esc(t.correlation_id ?? '—')}</td></tr>`;
      }).join('');
      return card('Timeline audit (25 derniers événements)', `
        ${rows === '' ? '<p class="muted">Journal vide.</p>' : `<div class="scroll"><table><thead><tr><th>Horodatage</th><th>Source</th><th>Action</th><th>correlation_id</th></tr></thead><tbody>${rows}</tbody></table></div>`}
        <p class="muted">Chaînage hash-to-hash vérifiable via <code>GET /audit/verify</code> — preuve de corrélation bout-en-bout.</p>
      `);
    },
  );

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>Assurance Toto — Cockpit CEO</title>
<style>${CSS}</style>
</head>
<body>
<header class="hero">
  <h1>Assurance Toto — Cockpit CEO</h1>
  <p class="sub">Environnement DÉMO · données 100 % synthétiques · généré le ${esc(fmtDate(generatedAt.toISOString()))} (auto-refresh 30 s)</p>
  <span class="badge-demo">DÉMO — aucune donnée réelle</span>
</header>
${p.notice !== undefined && p.notice !== '' ? `<div class="notice">${esc(p.notice)}</div>` : ''}
<div class="grid">
  <div class="wide">${ksSection}</div>
  ${pnlSection}
  ${pipelineSection}
  ${sinistresSection}
  ${conformiteSection}
  <div class="wide">${approSection}</div>
  <div class="wide">${timelineSection}</div>
</div>
<footer>
  Lecture seule sur Postgres (vues <code>v_pnl_hebdo</code>, <code>v_ratio_sinistralite</code>, tables <code>pnl_ledger</code>, <code>sinistres</code>, <code>contrats</code>, <code>clients</code>, <code>approbations</code>, <code>audit_log</code>, <code>macro_indicateurs</code>, <code>kill_switch</code>).
  Aucune écriture depuis cette page ; les décisions passent par les endpoints existants, protégés par la whitelist CEO.
</footer>
</body>
</html>`;
}
