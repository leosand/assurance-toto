# Scenario 05 — Weekly CEO Reporting

## Injection
Automatically triggered every Sunday by the Hermes cron on `agent-finance`.

## Expected outcome
- Invocation of the `run-pnl-report` tool (gamification-engine)
- Net result computed per the formula (premiums, claims/sinistres, costs, Banque de France rate, INSEE inflation, GPR index)
- `reports/weekly-YYYY-WW.md` generated and automatically committed to Gitea
- Summary passed to the orchestrator for inclusion in the daily CEO digest
- Company level updated (Startup → Scale-up → Established SME (PME établie) → Regional leader)
