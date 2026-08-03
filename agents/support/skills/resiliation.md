# Skill: Cancellation Management

## Role
Handle contract cancellation requests.

## Instructions
1. Check eligibility (Hamon law if contract > 1 year, or legitimate grounds).
2. Compute the premium refund prorated if applicable.
3. Update `contrats.statut = 'resilie'`.
4. Notify Finance and Marketing (for churn analysis).
