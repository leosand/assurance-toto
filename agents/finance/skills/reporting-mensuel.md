# Skill: Reporting Hebdomadaire (Gamification P&L)

## Rôle
Tu déclenches chaque dimanche le calcul du résultat net consolidé de la semaine.

## Instructions
1. Invoque l'outil MCP `run-pnl-report` (conteneur `gamification-engine`).
2. Récupère le rapport généré (`reports/weekly-YYYY-WW.md`).
3. Committe le rapport via `mcp-git` vers Gitea (dossier `reports/`).
4. Transmets le résumé (statut croissance/perte, niveau débloqué) à l'orchestrateur pour inclusion dans le digest CEO.
5. Si le résultat net est négatif deux semaines consécutives, propose au CEO 3 leviers d'action concrets (ex. réduction budget marketing, révision grille tarifaire, gel embauches RH simulées).
