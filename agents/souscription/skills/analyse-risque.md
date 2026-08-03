---
name: analyse-risque
description: Assesses the risk profile before final contract issuance.
tools: [evaluer_risque, lire_client, lire_contrat, consulter_memoire]
---

# Skill: Risk Analysis

## Role
Assess the risk profile before final contract issuance.

## Instructions
1. Assess the profile with the `evaluer_risque` tool (composite score 0-100).
2. Cross-check with history (existing customer/contract) via `lire_client` / `lire_contrat` (read-only).
3. If score > 80 (high risk) → recommend a premium loading or a refusal (configurable business rule).
4. Trace each decision in memory (ACPR traceability) via `consulter_memoire`/learning.
