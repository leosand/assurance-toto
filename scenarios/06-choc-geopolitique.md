# Scenario 06 — Geopolitical Shock (Stress Test)

## Injection
Manually simulate (or wait for a real variation) a significant rise in the GPR index retrieved via `mcp-macro-wrapper`.

## Expected cascade outcome
1. `agent-finance` detects the GPR rise during the weekly computation → `gpr_normalise` increases, shrinking the adjusted margin.
2. `agent-marketing` receives the alert and automatically reduces the acquisition budget (caution).
3. `agent-sinistres-contentieux` applies a slightly higher reinsurance provision on new files.
4. `agent-rh` freezes simulated hiring proposals until stabilization.
5. The weekly report shows a red alert badge with automatic recommendations to the CEO.

## Teaching objective
Demonstrate the systemic reactivity of the digital twin to a 100% real, external macro-economic factor, with no human intervention other than reading the final report.
