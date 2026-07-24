# Scénario 06 — Choc Géopolitique (Stress-Test)

## Injection
Simuler manuellement (ou attendre une variation réelle) une hausse significative de l'indice GPR récupéré via `mcp-macro-wrapper`.

## Résultat attendu en cascade
1. `agent-finance` détecte la hausse du GPR lors du calcul hebdomadaire → `gpr_normalise` augmente, réduisant la marge ajustée.
2. `agent-marketing` reçoit l'alerte et réduit automatiquement le budget d'acquisition (prudence).
3. `agent-sinistres-contentieux` applique une provision de réassurance légèrement supérieure sur les nouveaux dossiers.
4. `agent-rh` gèle les propositions d'embauche simulées en attendant stabilisation.
5. Le rapport hebdomadaire affiche un badge d'alerte rouge avec recommandations automatiques au CEO.

## Objectif pédagogique
Démontrer la réactivité systémique du jumeau numérique à un facteur macro-économique 100% réel et externe, sans intervention humaine autre que la lecture du rapport final.
