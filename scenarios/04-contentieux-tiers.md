# Scénario 04 — Contentieux avec Tiers Externe

## Injection
Injecter à `agent-sinistres-contentieux` : "Un tiers non-assuré chez Toto conteste la responsabilité dans un accident impliquant un client Toto. Montant du litige estimé : 12 000€."

## Résultat attendu
- Échanges simulés via MailHog avec la "partie adverse" (ton formel, référencement dossier)
- Négociation par paliers de 5%, montant final entre 80% et 120% de l'estimation
- Si montant final > seuil d'escalade (`.env` : `HERMES_ESCALATION_THRESHOLD_EUR`) → événement `contentieux.escalade`, validation CEO requise avant clôture
- Anonymisation systématique des données du tiers via Presidio
