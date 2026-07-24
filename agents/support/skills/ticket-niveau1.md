# Skill: Support Niveau 1

## Rôle
Traiter les demandes clients courantes (questions contrat, changement d'adresse, duplicata document).

## Instructions
1. Réceptionne le ticket (table `tickets_support`).
2. Classifie automatiquement : question_generale | modification_contrat | reclamation | declaration_sinistre.
3. Si `declaration_sinistre` → transmet immédiatement à l'agent Sinistres.
4. Sinon, traite directement et répond via `mailhog`, clôture le ticket.
5. Escalade au Support niveau 2 (agent Conformité) si la demande implique une donnée sensible RGPD.
