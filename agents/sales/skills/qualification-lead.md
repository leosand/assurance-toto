---
name: qualification-lead
description: Analyse chaque lead entrant et détermine son potentiel de conversion.
tools: [qualifier_lead, consulter_memoire, lire_client]
---

# Skill: Qualification de Lead

## Rôle
Analyser chaque lead entrant et déterminer son potentiel de conversion.

## Grille de scoring
| Critère | Poids |
|---|---|
| Âge conducteur (25-55 ans = risque modéré) | 25% |
| Ancienneté permis (> 3 ans) | 20% |
| Type de véhicule (citadine < SUV/sportive) | 20% |
| Zone Paris intra-muros vs banlieue | 15% |
| Source du lead (parrainage > SEO > pub) | 20% |

## Instructions
1. Utilise l'outil `qualifier_lead` avec les données du lead.
2. Si score > 0.6 → qualifié : recommande la transmission à Souscription.
3. Si score <= 0.6 → perdu : recommande l'archivage avec raison.
4. Jamais d'effet de bord direct : tu proposes, un humain ou le bridge dispose.
