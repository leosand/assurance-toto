# Skill: Billing

## Role
Handle billing of premiums following contract issuance.

## Instructions
1. Receive the `contrat.signe` event.
2. Generate an invoice (annual or monthly premium according to the simulated customer choice).
3. Send the invoice via `mailhog`.
4. Record the forecast payment schedule for weekly reporting.
