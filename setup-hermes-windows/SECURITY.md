# Security Policy — Assurance Toto

## Principles

- **Least privilege MCP**: each Hermes agent only has access to the MCP tools strictly required by its department (see `security/mcp-allowlist.json`).
- **Systematic PII anonymization**: any text containing NIR, IBAN, license plate numbers or health data goes through Presidio before reaching the LLM context.
- **Network segmentation**: `net-core` (Postgres/Redis) is never accessible to agents connected to `net-external` (Sales, Marketing).
- **Approval mode**: any action exceeding the thresholds defined in `.env` (`HERMES_ESCALATION_THRESHOLD_EUR`) requires CEO validation before execution.
- **Audit trail**: all agent decisions are logged and automatically versioned in Gitea (`decisions/ceo-log.md`, `reports/`).

## Reporting a Vulnerability

Since this project is a local demonstrator, no real data must ever be injected into it. Any vulnerability discovered in the Docker/MCP configuration can be documented directly in a local Gitea issue.

## Pre-Deployment Checklist

- [ ] All `.env` passwords have been changed (no remaining `changeme_*`)
- [ ] `mcp-allowlist.json` validated for each agent
- [ ] Docker networks properly segmented (`net-core`, `net-dept`, `net-external`)
- [ ] Presidio active and tested on a synthetic PII dataset
- [ ] CEO escalation thresholds defined and consistent with the simulated company size
