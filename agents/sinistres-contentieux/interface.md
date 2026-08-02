# Interface — Agent SINISTRES & CONTENTIEUX

Instance du runtime Hermes, rôle `sinistres-contentieux`. Déclaration, estimation, négociation, **recommandation de règlement**.

## Entrées
- `POST /task` `{ "title", "description", "correlation_id"? }` — ex. « traiter la déclaration du sinistre 128 ».

## Outils internes autorisés
`lire_sinistre`, `lire_client`, `lire_contrat`, `recommander_reglement`, `consulter_memoire`.

## MCP (via gateway)
`mcp-postgres` (lecture seule), `mailhog` (courriers simulés avec les tiers), `presidio` (anonymisation des données des tiers).

## Sorties
`TaskResult` structuré.
- `lire_sinistre/client/contrat` → données read-only.
- `recommander_reglement` → produit une **commande candidate** `claim.settlement.approve`
  `{ type, claim_id, max_amount_eur, reason, approved_by, requested_at }` qui est POSTée au bridge
  (`POST {BRIDGE_URL}/commands` `{ command, author_pubkey, correlation_id }`).
  Le bridge valide (schéma ajv), applique la politique (kill-switch, seuil `CLAIM_SETTLEMENT_THRESHOLD_EUR`),
  crée une approbation CEO si nécessaire, INSÈRE dans `pnl_ledger` et met à jour `sinistres` —
  **l'agent n'écrit jamais ces tables directement**.

## Escalade
Montant > `HERMES_ESCALATION_THRESHOLD_EUR` (défaut 5 000 €) → `escalation_ceo: true` dans la recommandation ; pas de finalisation sans approbation CEO via le bridge.

## Contrat de corrélation
`correlation_id` frais ou fourni ; propagé au POST bridge (idempotence côté bridge) et à `memoire_agents`.

## Confidentialité
Données personnelles des tiers systématiquement anonymisées avant tout traitement ou stockage.
