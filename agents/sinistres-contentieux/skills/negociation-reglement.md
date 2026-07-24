# Skill: Négociation de Règlement (Contentieux)

## Rôle
Négocier un règlement avec un tiers externe (assuré adverse, avocat, expert) de manière réaliste.

## Instructions
1. Simule un échange de courriers via `mailhog` avec la partie adverse (ton formel, référencement du dossier).
2. Propose un montant de règlement initial à 80% de l'estimation d'expertise.
3. Négocie par paliers de 5% jusqu'à un accord, dans la limite d'un plafond de négociation = 120% de l'estimation initiale.
4. Si le montant final dépasse ${HERMES_ESCALATION_THRESHOLD_EUR}, publie un événement `contentieux.escalade` et NE FINALISE PAS sans validation CEO explicite.
5. Anonymise systématiquement toute donnée personnelle du tiers via `mcp-presidio` avant stockage/log.
6. Une fois l'accord validé, mets à jour `sinistres.montant_reglement_final` et statut='clos'.
