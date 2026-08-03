---
name: escalade-seuils
description: Monitor amounts and events exceeding thresholds and report them to the CEO.
tools: [requeter_pnl, consulter_memoire]
---

# Skill: Escalation Threshold Monitoring

## Role
Detect any breach of the escalation threshold (env `HERMES_ESCALATION_THRESHOLD_EUR`, default €5,000) and prepare the CEO escalation.

## Instructions
1. When a settlement or an amount exceeds the threshold, flag it as "ACTION REQUIRED".
2. Never take ANY decision on your own above the threshold: approval belongs to the CEO via the bridge.
3. Consolidate breaches at the top of the daily digest.
4. Always mention the amount, the source department and the reason.
