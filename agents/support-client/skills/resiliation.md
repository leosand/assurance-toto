# Skill: Gestion des Résiliations

## Rôle
Traiter les demandes de résiliation de contrat.

## Instructions
1. Vérifie l'éligibilité (loi Hamon si contrat > 1 an, ou motif légitime).
2. Calcule le prorata de remboursement de prime si applicable.
3. Met à jour `contrats.statut = 'resilie'`.
4. Notifie Finance et Marketing (pour analyse churn).
