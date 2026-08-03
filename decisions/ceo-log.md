# CEO Decision Log — Assurance Toto

This file is updated automatically by the orchestrator agent on each recorded CEO decision
> and committed to local Gitea for full traceability.

## Entry format

```
### YYYY-MM-DD Decision type
- Detail
- Estimated impact XXXX €
- Department(s) concerned: ...
```

---

*(No decision recorded yet — the log fills automatically from the first simulation cycle.)*

## ADR-001 — Buzz by Block Integration (cockpit/identity/supervision)

- Decision: ship the published image `ghcr.io/block/buzz:<pin>` (pull-only) in our compose alongside postgres/redis/minio, NIP-29 channels. No Rust build from source (20-45 min risk + Go on WSL2).
- Verified channel message: NIP-01 kind 9, tags first `[["h","<channel-uuid-lowercase>"]]`, `content` text ≤64 KiB (markdown/@mentions). Kind 40002 = reserved V2, not emitted.
- TS bridge API: REST `POST /events|/query|/count` (NIP-98 auth header `Authorization: Nostr <b64(kind27235+json)>`) or WS NIP-01+NIP-42 (kind 22242). Official client = Rust; web UI ships `nostr-tools@^2.23` → nostr-tools compatible (integer kinds).
- Bootstrap: `buzz-admin generate-key|add-member --pubkey|list-members|reconcile-channels` (roles member|admin). Channels/communities outside buzz-admin: `POST /operator/communities` then `buzz channels create/add-member --role bot`.
- Upstream limitations (do NOT use, encapsulated): workflow approval gates (WF-08 pending), `send_dm`, `set_channel_topic`, rate-limiting.
- Buzz is NOT the business source of truth (Postgres remains it); all Buzz traffic goes through an interchangeable `CollabAdapter` (Rocket.Chat/Gitea possible).

## ADR-002 — CEO Cockpit: native lean dashboard (no full Next.js §7 in Phase 1)

- Decision (validated by the user): Phase 1 = lean CEO cockpit, server-side rendered, served by the `buzz-hermes-bridge` (route `/dashboard`), 100% read from Postgres.
- Content: P&L (net result + claims/premiums ratio), lead→contract pipeline, clickable CEO approval queue, agent status + kill switch, event timeline with `correlation_id`. Buzz remains the "live" cockpit (signed messages/approvals).
- ROI rationale: the real selling point = traceability + CEO approval, not charts. Full §7 deferred to Phase 2.
- Documented options (reversible): (a) lean cockpit — RETAINED; (b) Next.js + shadcn/ui + ECharts full §7 — rejected in Phase 1 (~2500 lines bloat, blurred message); (c) Buzz-only — rejected (§7 brief requires a distinct dashboard, demo differentiator).
