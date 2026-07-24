# Scénario 01 — Acquisition Client

## Injection
Injecter cette tâche à `agent-sales` : "Lance un cycle de prospection quotidien : identifie 20 nouveaux prospects synthétiques pour l'assurance auto à Paris, qualifie-les selon la grille de scoring, et transmets les leads qualifiés à la Souscription."

## Résultat attendu
- 20 leads créés en base (table `leads`)
- ~60% qualifiés (score > 0.6) selon la distribution Faker
- Événement `lead.qualified` publié pour chaque lead qualifié
- Devis générés et envoyés via MailHog pour les leads les plus prometteurs
