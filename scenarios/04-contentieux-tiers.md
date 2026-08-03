# Scenario 04 — Third-Party Dispute

## Injection
Inject into `agent-sinistres-contentieux`: "A third party not insured by Toto disputes liability in an accident involving a Toto customer. Estimated dispute amount: €12,000."

## Expected outcome
- Simulated exchanges via MailHog with the "opposing party" (formal tone, file referencing)
- Stepwise negotiation in 5% increments; final amount between 80% and 120% of the estimate
- If the final amount exceeds the escalation threshold (`.env`: `HERMES_ESCALATION_THRESHOLD_EUR`) → `contentieux.escalade` event; CEO validation required before closing
- Systematic anonymization of the third party's data via Presidio
