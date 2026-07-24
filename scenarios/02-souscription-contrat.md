# Scénario 02 — Souscription de Contrat

## Injection
Injecter à `agent-souscription` : "Traite tous les leads qualifiés en attente, applique la grille tarifaire officielle, et émets les contrats pour les profils standards. Escalade les profils atypiques au CEO."

## Résultat attendu
- Contrats créés en base (table `contrats`, statut='actif')
- Événement `contrat.signe` publié → notification Finance pour facturation
- Cas atypiques (bonus-malus élevé, véhicule sportif jeune conducteur) placés en attente CEO
