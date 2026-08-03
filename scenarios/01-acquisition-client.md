# Scenario 01 — Client Acquisition

## Injection
Inject this task into `agent-sales`: "Launch a daily prospecting cycle: identify 20 new synthetic prospects for car insurance in Paris, qualify them against the scoring grid, and forward the qualified leads to Underwriting."

## Expected outcome
- 20 leads created in the database (table `leads`)
- ~60% qualified (score > 0.6) per the Faker distribution
- `lead.qualified` event published for each qualified lead
- Quotes generated and sent via MailHog for the most promising leads
