# keychain.md — Sauvegarde des clés NIP-49

Les clés générées par `npm run init-buzz-keys` écrivent `.env.buzz` (mode `600`, gitignored). Ne **jamais** les commiter.

## Sauvegarde recommandée (NIP-49)

Chaque `nsec` individuel peut être chiffré côté client avec une passphrase forte (NIP-49, schéma `ncryptsec1…`) :

```ts
import { generateSecretKey } from 'nostr-tools/pure';
import * as nip49 from 'nostr-tools/nip49';

const sk = generateSecretKey();
const ncryptsec = nip49.encrypt(sk, '<passphrase-forte-aléatoire>');
// → stocke ce `ncryptsec1…` dans un vault (Bitwarden / 1Password), pas `.env.buzz`.
```

Règles :

- 1 passphrase maîtresse par environnement (dev / staging / prod), stockée dans un coffre d'équipe, PAS dans le repo.
- Le fichier `.env.buzz` = source de vérité opérationnelle **uniquement en local**. Toute rotation régénère le fichier (jamais édité), et chaque `ncryptedsec` est ré-importé.
- Les npubs sont publics : pas de secrets dans le mapping `BRIDGE_CEOPUBKEYS`.
- Un `nsec` exposé ⇒ rotation complète de la paire + purge du map RBAC (`BRIDGE_CEOPUBKEYS`) + invalidation des commandes associées.

## Besoins CEO vs agents

- CEO npub → `BRIDGE_CEOPUBKEYS` (csv) : seul rôle qui valide `claim.settlement.*`, `policy.pricing.exception.*`, `agent.killswitch.*`.
- Agents (sales / souscription / sinistres / finance / conformité / hermes) : leurs npubs n'ont besoin que de leur propre nsec pour produire les événements signés ; ils ne peuvent pas s'auto-accorder de décision réservée au CEO.

## À ne pas faire

- Pas de nsec en clair dans le code, les logs, les issues, Slack, ou un commit.
- Pas de nsec sur une CI non isolée — la rotation serait impossible sans audit complet.
