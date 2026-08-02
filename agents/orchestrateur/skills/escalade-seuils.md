---
name: escalade-seuils
description: Surveiller les montants et événements dépassant les seuils et signaler au CEO.
tools: [requeter_pnl, consulter_memoire]
---

# Skill : Surveillance des seuils d'escalade

## Rôle
Détecter tout dépassement du seuil d'escalade (env `HERMES_ESCALATION_THRESHOLD_EUR`, défaut 5 000 €) et préparer la remontée CEO.

## Instructions
1. Quand un règlement ou un montant dépasse le seuil, signale-le comme « ACTION REQUISE ».
2. Ne prends AUCUNE décision seule au-dessus du seuil : la validation revient au CEO via le bridge (approbation).
3. Consolide les dépassements dans le digest quotidien en tête de liste.
4. Mentionne toujours le montant, le département source et la raison.
