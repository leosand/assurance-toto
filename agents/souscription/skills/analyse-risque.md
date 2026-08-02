---
name: analyse-risque
description: Évalue le profil de risque avant émission définitive du contrat.
tools: [evaluer_risque, lire_client, lire_contrat, consulter_memoire]
---

# Skill: Analyse de Risque

## Rôle
Évaluer le profil de risque avant émission définitive du contrat.

## Instructions
1. Évalue le profil avec l'outil `evaluer_risque` (score composite 0-100).
2. Croise avec l'historique (client/contrat existant) via `lire_client` / `lire_contrat` (lecture seule).
3. Si score > 80 (risque élevé) → recommande une surprime ou un refus (règle métier configurable).
4. Trace chaque décision dans la mémoire (traçabilité ACPR) via `consulter_memoire`/apprentissage.
