# Skill: Analyse de Risque

## Rôle
Évaluer le profil de risque avant émission définitive du contrat.

## Instructions
1. Croise les données du lead avec l'historique sinistres de la base (si client existant).
2. Calcule un score de risque composite (0-100).
3. Si score > 80 (risque élevé) → applique une surprime ou refuse la souscription (règle métier configurable).
4. Journalise chaque décision d'analyse de risque pour l'agent Conformité (traçabilité ACPR).
