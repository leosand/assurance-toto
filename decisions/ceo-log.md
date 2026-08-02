# Journal des Décisions CEO — Assurance Toto

> Ce fichier est mis à jour automatiquement par l'agent orchestrateur à chaque décision CEO enregistrée
> et committé vers Gitea local pour traçabilité complète.

## Format d'entrée

```
### YYYY-MM-DD — Type de décision
- Détail : ...
- Impact estimé : XXXX €
- Département(s) concerné(s) : ...
```

---

*(Aucune décision enregistrée pour le moment — le journal se remplit automatiquement dès le premier cycle de simulation.)*

## ADR-001 — Intégration Buzz by Block (cockpit/identité/supervision)

- Décision : embarquer l'image publiée `ghcr.io/block/buzz:<pin>` (pull-only) dans notre compose à côté de postgres/redis/minio, NIP-29 channels. Aucun build Rust from source (risque 20-45 min + Go sur WSL2).
- Message canal vérifié : NIP-01 kind 9, tags first `[["h","<channel-uuid-lowercase>"]]`, `content` texte ≤64 KiB (markdown/@mentions). Kind 40002 = V2 réservé, non émis.
- API bridge TS : REST `POST /events|/query|/count` (auth NIP-98 header `Authorization: Nostr <b64(kind27235+json)>`) ou WS NIP-01+NIP-42 (kind 22242). Client officiel = Rust; web UI embarque `nostr-tools@^2.23` → nostr-tools compatible (kinds = entiers).
- Bootstrap : `buzz-admin generate-key|add-member --pubkey|list-members|reconcile-channels` (roles member|admin). Canaux/communautés hors buzz-admin : `POST /operator/communities` puis `buzz channels create/add-member --role bot`.
- Limites amont (à ne PAS utiliser, encapsulées) : approval gates workflow (WF-08 🚧), `send_dm`, `set_channel_topic`, rate-limiting.
- Buzz n'est PAS la source de vérité métier (Postgres la demeure); tout Buzz passe par un `CollabAdapter` interchangeable (Rocket.Chat/Gitea possible).

## ADR-002 — Cockpit CEO : dashboard lean natif (pas Next.js §7 complet en Phase 1)

- Décision (validée par l'utilisateur) : Phase 1 = cockpit CEO lean rendu côté serveur, servi par le `buzz-hermes-bridge` (route `/dashboard`), 100 % lu depuis Postgres.
- Contenu : P&L (résultat net + ratio sinistres/primes), pipeline lead→contrat, file d'approbations CEO cliquables, statut agents + kill switch, timeline des événements avec `correlation_id`. Buzz reste le cockpit « vivant » (messages/approbations signées).
- Justification ROI : le vrai argument commercial = traçabilité + approbation CEO, pas des graphiques. §7 complet différé en Phase 2.
- Options documentées (réversibles) : (a) cockpit lean — RETENU ; (b) Next.js + shadcn/ui + ECharts §7 complet — rejeté Phase 1 (surcharge ~2500 lignes, message brouillé) ; (c) Buzz-seul — rejeté (brief §7 exige un dashboard distinct, différenciant démo).
