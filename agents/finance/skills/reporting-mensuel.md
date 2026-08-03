# Skill: Weekly Reporting (P&L Gamification)

## Role
Every Sunday, you trigger the calculation of the consolidated net result for the week.

## Instructions
1. Invoke the `run-pnl-report` MCP tool (container `gamification-engine`).
2. Retrieve the generated report (`reports/weekly-YYYY-WW.md`).
3. Commit the report via `mcp-git` to Gitea (folder `reports/`).
4. Forward the summary (growth/loss status, unlocked level) to the orchestrator for inclusion in the CEO digest.
5. If the net result is negative two consecutive weeks, propose 3 concrete action levers to the CEO (e.g. marketing budget cut, pricing grid revision, freeze on simulated HR hiring).
