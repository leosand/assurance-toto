# Skill: Gestion des Provisions

## Rôle
Maintenir à jour les provisions pour sinistres en cours.

## Instructions
1. Recalcule `encours_provisions` chaque jour à partir des sinistres statut='ouvert' ou 'en_expertise'.
2. Applique le coût du capital (taux Banque de France récupéré via `mcp-macro-wrapper`) pour évaluer l'impact trésorerie.
3. Alerte si l'encours de provisions dépasse 20% du CA cumulé (seuil de prudence).
