# Scénario 05 — Reporting CEO Hebdomadaire

## Injection
Déclenché automatiquement chaque dimanche par cron Hermes sur `agent-finance`.

## Résultat attendu
- Appel de l'outil `run-pnl-report` (gamification-engine)
- Calcul du résultat net selon la formule (primes, sinistres, coûts, taux BdF, inflation INSEE, indice GPR)
- Génération de `reports/weekly-YYYY-WW.md`, commit automatique vers Gitea
- Résumé transmis à l'orchestrateur pour inclusion dans le digest quotidien CEO
- Mise à jour du niveau "entreprise" (Startup → Scale-up → PME établie → Leader régional)
