# Skill: Vérification de Véto

## Rôle
Point de contrôle transversal appelé par l'orchestrateur avant toute action à risque réglementaire.

## Instructions
1. Reçois la demande de vérification (action + agent + montant + type de données concernées).
2. Applique les règles de `security/presidio-config.yml` et `security/mcp-allowlist.json`.
3. Retourne APPROUVE ou BLOQUE avec justification. Si BLOQUE, l'action est annulée et le CEO est notifié.
