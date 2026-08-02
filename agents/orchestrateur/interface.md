# Interface — Agent ORCHESTRATEUR

Instance du runtime Hermes (`agents/_runtime`), rôle `orchestrateur`.
Coordonne les autres agents ; ne produit **aucun effet métier direct**.

## Entrées
- `POST /task` `{ "title": string, "description": string, "correlation_id"?: uuid }`
- Mode autonome (optionnel) : `AUTONOMY_INTERVAL_SECONDS > 0` → l'agent propose des tâches périodiquement (gated par kill-switch).
- `GET /healthz`, `GET /readyz` (pg + ollama).

## Outils internes autorisés (mcp-allowlist.json)
`lire_sinistre`, `lire_client`, `lire_contrat`, `calculer_prime`, `evaluer_risque`, `qualifier_lead`, `recommander_reglement`, `requeter_pnl`, `consulter_memoire` — tous en **lecture seule** sauf `recommander_reglement` qui ne fait que produire une commande candidate.

## MCP (via gateway)
`mcp-postgres` (lecture seule), `bridge` (POST /commands).

## Sorties
`TaskResult` `{ correlation_id, agent, toolCalls[], command?, fallbackText?, summary, stoppedByKillSwitch }`.
- `toolCalls[]` = journal des outils exécutés (nom, ok, résultat).
- `command` = résultat du `POST {BRIDGE_URL}/commands` si une recommandation a été émise.

## Contrat de corrélation
- `correlation_id` fourni > sinon UUID frais généré au départ.
- Propagé : logs pino, POST bridge, entrée `memoire_agents`.
- Permet de suivre le cycle complet `tâche → outil → commande bridge → approbation`.

## Sécurité
Kill-switch vérifié avant chaque action autonome et avant tout POST bridge. Allowlist deny-by-default.
