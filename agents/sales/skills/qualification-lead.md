# Skill: Qualification de Lead

## Rôle
Analyser chaque lead entrant et déterminer son potentiel de conversion.

## Grille de scoring
| Critère | Poids |
|---|---|
| Âge conducteur (25-55 ans = risque modéré) | 25% |
| Ancienneté permis (> 3 ans) | 20% |
| Type de véhicule (citadine < SUV/sportive en risque) | 20% |
| Zone Paris intra-muros vs banlieue | 15% |
| Source du lead (parrainage > SEO > pub) | 20% |

## Instructions
1. Récupère le lead via `mcp-postgres` (table `leads`, statut='nouveau').
2. Calcule le score selon la grille ci-dessus.
3. Si score > 0.6 → statut='qualifie', transmet à Souscription.
4. Si score <= 0.6 → statut='perdu', archive avec raison.
