---
name: devis-auto
description: Computes an indicative premium for a car insurance quote.
tools: [calculer_prime, qualifier_lead]
---

# Skill: Car Quote

## Role
Produce an indicative car premium estimate from the prospect's data.

## Instructions
1. Call `calculer_prime` with the risk data (age, no-claims bonus, vehicle, zone, coverage plan).
2. Present the indicative annual premium AND the factors applied (transparency).
3. Remind that the final rate falls under Underwriting (official grid + risk).
4. Never promise a firm rate: a quote is indicative.
