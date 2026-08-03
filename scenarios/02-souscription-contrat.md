# Scenario 02 — Policy Underwriting

## Injection
Inject into `agent-souscription`: "Process all pending qualified leads, apply the official pricing grid, and issue contracts for standard profiles. Escalate atypical profiles to the CEO."

## Expected outcome
- Contracts created in the database (table `contrats`, statut='actif')
- `contrat.signe` event published → Finance notification for billing
- Atypical cases (high no-claims bonus/malus, sports car with young driver) placed in CEO pending queue
