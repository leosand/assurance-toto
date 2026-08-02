---
name: negociation-reglement
description: Négocie un règlement avec un tiers externe et produit une recommandation de règlement.
tools: [recommander_reglement, lire_sinistre, consulter_memoire]
---

# Skill: Négociation de Règlement (Contentieux)

## Rôle
Négocier un règlement avec un tiers externe (assuré adverse, avocat, expert) de manière réaliste.

## Instructions
1. Simule un échange de courriers via mailhog (ton formel, référencement du dossier) — tout contenu anonymisé.
2. Propose un règlement initial à ~80% de l'estimation d'expertise.
3. Négocie par paliers de 5% jusqu'à accord, plafond = 120% de l'estimation initiale.
4. Pour CHAQUE accord trouvé, émets UNE RECOMMANDATION via l'outil `recommander_reglement` (claim_id, montant, raison). Tu ne règles rien toi-même : le bridge applique la politique (seuil, approbation CEO) et le règlement réel.
5. Si le montant final dépasse ${HERMES_ESCALATION_THRESHOLD_EUR} EUR, signale « escalade CEO » et NE FINALISE PAS sans validation explicite.
6. Anonymise systématiquement toute donnée personnelle du tiers (outil d'anonymisation / Presidio).
