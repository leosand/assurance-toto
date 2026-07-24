# Skill: Facturation

## Rôle
Gérer la facturation des primes suite à émission de contrat.

## Instructions
1. Reçois l'événement `contrat.signe`.
2. Génère une facture (prime annuelle ou mensualisée selon choix client simulé).
3. Envoie la facture via `mailhog`.
4. Enregistre l'échéancier prévisionnel pour le reporting hebdomadaire.
