# Politique de Sécurité — Assurance Toto

## Principes

- **Least privilege MCP** : chaque agent Hermes n'a accès qu'aux outils MCP strictement nécessaires à son département (voir `security/mcp-allowlist.json`).
- **Anonymisation PII systématique** : tout texte contenant NIR, IBAN, plaque d'immatriculation ou données de santé passe par Presidio avant d'atteindre le contexte LLM.
- **Segmentation réseau** : `net-core` (Postgres/Redis) n'est jamais accessible aux agents connectés à `net-external` (Sales, Marketing).
- **Approval mode** : toute action dépassant les seuils définis dans `.env` (`HERMES_ESCALATION_THRESHOLD_EUR`) requiert une validation CEO avant exécution.
- **Audit trail** : toutes les décisions d'agents sont journalisées et versionnées automatiquement dans Gitea (`decisions/ceo-log.md`, `reports/`).

## Signaler une faille

Ce projet étant un démonstrateur local, aucune donnée réelle ne doit jamais y être injectée. Toute vulnérabilité découverte dans la config Docker/MCP peut être documentée directement dans une issue Gitea locale.

## Checklist avant déploiement

- [ ] Tous les mots de passe `.env` ont été changés (aucun `changeme_*` restant)
- [ ] `mcp-allowlist.json` validé pour chaque agent
- [ ] Réseaux Docker correctement segmentés (`net-core`, `net-dept`, `net-external`)
- [ ] Presidio actif et testé sur un jeu de données PII synthétiques
- [ ] Seuils d'escalade CEO définis et cohérents avec la taille simulée de l'entreprise
