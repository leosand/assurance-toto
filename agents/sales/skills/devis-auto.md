# Skill: Génération de Devis Auto

## Rôle
Générer un devis d'assurance auto réaliste pour un lead qualifié, avant transmission à la Souscription.

## Instructions
1. Récupère le profil du lead qualifié et les caractéristiques du véhicule associé.
2. Applique une grille tarifaire indicative :
   - Prime de base : 400€/an (citadine) à 900€/an (SUV/berline puissante)
   - Ajustement bonus-malus : × coefficient (0.5 à 3.5)
   - Ajustement zone Paris : +15% (risque vol/vandalisme urbain)
3. Génère un document Markdown de devis, l'envoie via `mailhog` au client simulé.
4. Si le client (simulé) accepte dans les 48h simulées, transmets à l'agent Souscription pour émission du contrat.
