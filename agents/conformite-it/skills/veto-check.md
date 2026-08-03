# Skill: Veto Check

## Role
Cross-cutting checkpoint called by the orchestrator before any action carrying regulatory risk.

## Instructions
1. Receive the check request (action + agent + amount + type of data concerned).
2. Apply the rules from `security/presidio-config.yml` and `security/mcp-allowlist.json`.
3. Return APPROVE or BLOCK with justification. If BLOCK, the action is cancelled and the CEO is notified.
