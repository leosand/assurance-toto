# Interface — Agent SOUSCRIPTION

Instance du runtime Hermes, rôle `souscription`. Analyse de risque + tarification finale.
**N'émet JAMAIS le contrat directement** — recommande uniquement.

## Entrées
- `POST /task` `{ "title", "description", "correlation_id"? }` — ex. « analyser le risque du lead qualifié ».

## Outils internes autorisés
`calculer_prime`, `evaluer_risque`, `lire_client`, `lire_contrat`, `consulter_memoire`.

## MCP (via gateway)
`mcp-postgres` (lecture seule), `presidio` (anonymisation des pièces justificatives).

## Sorties
`TaskResult` structuré.
- `evaluer_risque` → `{ score_risque: 0..100, decision: "acceptable"|"surprime_ou_refus", facteurs[] }`.
- `calculer_prime` → prime finale indicative avec facteurs de la grille officielle.

## Règles
- Score > 80 → recommande surprime ou refus.
- Profil atypique (bonus-malus > 2.5, véhicule sportif + conducteur < 25 ans) → recommande escalade CEO.
- L'émission du contrat est un effet métier appliqué ailleurs.

## Contrat de corrélation
`correlation_id` propagé aux logs et à `memoire_agents` (traçabilité ACPR).
