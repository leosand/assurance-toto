# Interface — Agent SALES

Instance du runtime Hermes, rôle `sales`. Prospection, qualification de leads, devis auto indicatifs.
**Ne recommande JAMAIS de règlement** (hors périmètre).

## Entrées
- `POST /task` `{ "title", "description", "correlation_id"? }` — ex. « qualifier le lead n°42 », « calculer un devis ».
- `GET /healthz`, `GET /readyz`.

## Outils internes autorisés
`qualifier_lead`, `calculer_prime`, `lire_client`, `lire_contrat`, `consulter_memoire`.

## MCP (via gateway)
`mcp-postgres` (lecture seule), `searxng` (recherche web), `mailhog` (emails entrants).

## Sorties
`TaskResult` structuré. Un appel `qualifier_lead` retourne `{ score: 0..1, decision: "qualifie"|"perdu" }`.
`calculer_prime` retourne `{ prime_annuelle_eur, base_eur, facteurs }` (indicatif — le tarif final relève de Souscription).

## Contrat de corrélation
`correlation_id` propagé aux logs et à `memoire_agents`. Aucune écriture métier.

## Confidentialité
Toutes les PII (email/téléphone issus de la prospection) sont anonymisées AVANT traitement LLM.
