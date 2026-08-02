#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
seed_faker.py — Données 100 % synthétiques pour Assurance Toto (schéma v2).

- PII françaises fictives via Faker (locale fr_FR).
- Déterministe : Faker.seed(SEED) + random.seed(SEED) => mêmes données à chaque run.
- Connexion via l'environnement : PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
  (défauts : localhost, 5432, postgres, postgres, assurance_toto).
- --scale-maison : petit portefeuille cohérent (~120 clients, 200 contrats,
  60 sinistres) avec ratio de sinistralité ~65-75 %, écritures pnl_ledger
  correspondantes (prime +, reglement/provision -, frais -), 3 lignes
  macro_indicateurs et la ligne kill_switch (id=1, actif=false).

Convention de signe pnl_ledger : RECETTES positives (prime), CHARGES négatives
(provision, reglement, frais, marketing). Résultat net = SUM(montant).
Voir infra/postgres/schema_v2.sql et infra/postgres/README.md.

Dépendances : psycopg2-binary, faker.
Usage :
    python seed_faker.py --clients 5000 --contrats 3000 --sinistres 800
    python seed_faker.py --scale-maison
"""

import argparse
import os
import random

import psycopg2
from faker import Faker

SEED = 42
fake = Faker("fr_FR")
Faker.seed(SEED)
random.seed(SEED)

# Répartition réaliste des statuts (~ 93 % de sinistres clos).
STATUTS_SINISTRE = ["ouvert"] * 2 + ["en_cours"] * 5 + ["regle"] * 70 + ["refuse"] * 18 + ["contentieux"] * 5
TOUTES_FRANCHISES = ("auto", "auto", "auto", "habitation", "sante", "vie")

MACRO_INDICATEURS = [
    ("taux_bdf", 3.15, "2026-T2", "Banque de France"),
    ("inflation_insee", 2.1, "2026-06", "INSEE"),
    ("gpr", 132.5, "2026-06", "Caldara-Iacoviello GPR index"),
]

# Statuts de sinistre produisant une écriture pnl_ledger, et leur catégorie.
CATEGORIE_PNL_PAR_STATUT = {
    "ouvert": "provision",
    "en_cours": "provision",
    "contentieux": "provision",
    "regle": "reglement",
}


def db_connect():
    """Connexion PostgreSQL via variables d'environnement (défauts locaux)."""
    return psycopg2.connect(
        host=os.environ.get("PGHOST", "localhost"),
        port=int(os.environ.get("PGPORT", "5432")),
        user=os.environ.get("PGUSER", "postgres"),
        password=os.environ.get("PGPASSWORD", "postgres"),
        dbname=os.environ.get("PGDATABASE", "assurance_toto"),
    )


def seed_clients(cur, n):
    """Insère n clients synthétiques, retourne la liste des ids."""
    ids = []
    for _ in range(n):
        cur.execute(
            """
            INSERT INTO clients (nom, prenom, email, telephone, adresse, date_naissance)
            VALUES (%s, %s, %s, %s, %s, %s) RETURNING id
            """,
            (
                fake.last_name(),
                fake.first_name(),
                fake.unique.email(),
                fake.phone_number(),
                fake.address().replace("\n", ", "),
                fake.date_of_birth(minimum_age=18, maximum_age=85),
            ),
        )
        ids.append(cur.fetchone()[0])
    return ids


def seed_contrats(cur, client_ids, n):
    """Insère n contrats, retourne une liste de dicts {id, prime, date_debut}."""
    contrats = []
    for i in range(n):
        prime = round(random.uniform(300, 1500), 2)
        date_debut = fake.date_between(start_date="-3y", end_date="today")
        statut = random.choices(["actif", "suspendu", "resilie"], weights=[80, 10, 10])[0]
        date_fin = fake.date_between(start_date=date_debut, end_date="today") if statut == "resilie" else None
        cur.execute(
            """
            INSERT INTO contrats (client_id, type_contrat, numero, date_debut, date_fin,
                                  prime_annuelle, statut)
            VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id
            """,
            (
                random.choice(client_ids),
                random.choice(TOUTES_FRANCHISES),
                f"POL-{i:06d}",
                date_debut,
                date_fin,
                prime,
                statut,
            ),
        )
        contrats.append({"id": cur.fetchone()[0], "prime": prime, "date_debut": date_debut})
    return contrats


def seed_sinistres(cur, contrats, n):
    """
    Insère n sinistres. Retourne une liste de dicts :
    {id, contrat_id, date_sinistre, estime, regle, statut}.
    En mode générique : montants aléatoires 500-10 000 EUR.
    """
    sinistres = []
    for _ in range(n):
        contrat = random.choice(contrats)
        statut = random.choice(STATUTS_SINISTRE)
        estime = round(random.uniform(500, 10000), 2)
        regle = round(estime * random.uniform(0.5, 1.0), 2) if statut == "regle" else 0.0
        sin = {
            "contrat_id": contrat["id"],
            "date_sinistre": fake.date_between(
                start_date=max(contrat["date_debut"], fake.date_between(start_date="-2y", end_date="today")),
                end_date="today",
            ),
            "description": fake.sentence(nb_words=8),
            "estime": estime,
            "regle": regle,
            "statut": statut,
        }
        cur.execute(
            """
            INSERT INTO sinistres (contrat_id, date_sinistre, description,
                                   montant_estime, montant_regle, statut)
            VALUES (%s, %s, %s, %s, %s, %s) RETURNING id
            """,
            (sin["contrat_id"], sin["date_sinistre"], sin["description"],
             sin["estime"], sin["regle"], sin["statut"]),
        )
        sin["id"] = cur.fetchone()[0]
        sinistres.append(sin)
    return sinistres


def posted_claim_amount(sin):
    """Montant comptabilisé en pnl_ledger pour un sinistre (0 si refuse)."""
    categorie = CATEGORIE_PNL_PAR_STATUT.get(sin["statut"])
    if categorie is None:  # refuse : aucune charge comptabilisée
        return 0.0
    return sin["regle"] if categorie == "reglement" else sin["estime"]


def rescale_sinistres(cur, sinistres, target_total):
    """
    Recale en base (UPDATE par id primaire) les montants comptabilisés des
    sinistres pour que la somme (règlements + provisions) égale exactement
    target_total => ratio de sinistralité maîtrisé (~65-75 % des primes).
    Les montants POSTÉS (pas les estimés) sont mis à l'échelle, puis le
    résidu d'arrondi est absorbé par la dernière ligne postée.
    Invariant de cohérence : montant_estime >= montant_regle.
    Déterministe (random.seed global).
    """
    posted = [(i, posted_claim_amount(s)) for i, s in enumerate(sinistres)]
    posted = [(i, m) for i, m in posted if m > 0]
    raw_total = sum(m for _, m in posted)
    if raw_total <= 0 or not posted:
        return
    factor = target_total / raw_total
    news = [round(m * factor, 2) for _, m in posted]
    # Absorption du résidu d'arrondi pour un total EXACT (= target_total).
    news[-1] = round(news[-1] + (target_total - sum(news)), 2)
    for (i, _), p_new in zip(posted, news):
        sin = sinistres[i]
        if sin["statut"] == "regle":
            sin["regle"] = p_new
            sin["estime"] = round(p_new / random.uniform(0.85, 1.0), 2)
        else:  # provision (ouvert, en_cours, contentieux)
            sin["estime"] = p_new
            sin["regle"] = 0.0
        cur.execute(
            "UPDATE sinistres SET montant_estime = %s, montant_regle = %s WHERE id = %s",
            (sin["estime"], sin["regle"], sin["id"]),
        )


def seed_pnl(cur, contrats, sinistres):
    """
    Écritures pnl_ledger cohérentes (convention : recettes +, charges -) :
    - prime       : + prime_annuelle par contrat      (departement 'auto')
    - frais       : - 10 % de la prime (acquisition/gestion)
    - reglement   : - montant_regle des sinistres regles
    - provision   : - montant_estime des sinistres ouverts/en_cours/contentieux
    created_at suit la date métier (contrat / sinistre) pour v_pnl_hebdo.
    Retourne (nb_ecritures, total_primes, total_sinistres_comptabilises).
    """
    n_rows = 0
    total_primes = 0.0
    for c in contrats:
        cur.execute(
            "INSERT INTO pnl_ledger (departement, categorie, montant, description, created_at) "
            "VALUES (%s, %s, %s, %s, %s)",
            ("auto", "prime", c["prime"], "Prime annuelle contrat auto", c["date_debut"]),
        )
        cur.execute(
            "INSERT INTO pnl_ledger (departement, categorie, montant, description, created_at) "
            "VALUES (%s, %s, %s, %s, %s)",
            ("finance", "frais", -round(c["prime"] * 0.10, 2),
             "Frais d'acquisition et de gestion (10 % de la prime)", c["date_debut"]),
        )
        total_primes += c["prime"]
        n_rows += 2

    total_sinistres = 0.0
    for s in sinistres:
        montant = posted_claim_amount(s)
        if montant <= 0:
            continue
        categorie = CATEGORIE_PNL_PAR_STATUT[s["statut"]]
        cur.execute(
            "INSERT INTO pnl_ledger (departement, categorie, montant, description, created_at) "
            "VALUES (%s, %s, %s, %s, %s)",
            ("sinistres-contentieux", categorie, -montant,
             f"Sinistre {s['statut']} (contrat {s['contrat_id']})", s["date_sinistre"]),
        )
        total_sinistres += montant
        n_rows += 1
    return n_rows, total_primes, total_sinistres


def seed_macro(cur):
    for indicateur, valeur, periode, source in MACRO_INDICATEURS:
        cur.execute(
            "INSERT INTO macro_indicateurs (indicateur, valeur, periode, source) "
            "VALUES (%s, %s, %s, %s)",
            (indicateur, valeur, periode, source),
        )


def ensure_kill_switch(cur):
    """Garantit la ligne kill_switch (id=1, actif=false). Idempotent."""
    cur.execute("INSERT INTO kill_switch (id, actif) VALUES (1, false) ON CONFLICT (id) DO NOTHING")


def main():
    parser = argparse.ArgumentParser(description="Seeder Faker fr_FR pour Assurance Toto")
    parser.add_argument("--clients", type=int, default=5000, help="Nombre de clients")
    parser.add_argument("--contrats", type=int, default=3000, help="Nombre de contrats")
    parser.add_argument("--sinistres", type=int, default=800, help="Nombre de sinistres")
    parser.add_argument(
        "--scale-maison",
        action="store_true",
        help="Petit portefeuille cohérent : ~120 clients, 200 contrats, 60 sinistres, "
        "ratio de sinistralité ~65-75 %%, pnl_ledger, macro_indicateurs, kill_switch.",
    )
    args = parser.parse_args()

    n_clients, n_contrats, n_sinistres = args.clients, args.contrats, args.sinistres
    if args.scale_maison:
        n_clients, n_contrats, n_sinistres = 120, 200, 60

    conn = db_connect()
    try:
        with conn:  # transaction unique : tout ou rien
            with conn.cursor() as cur:
                client_ids = seed_clients(cur, n_clients)
                contrats = seed_contrats(cur, client_ids, n_contrats)
                sinistres = seed_sinistres(cur, contrats, n_sinistres)

                summary_extra = ""
                if args.scale_maison:
                    total_primes = sum(c["prime"] for c in contrats)
                    # Cible : 70 % des primes => ratio réalisé dans la bande 65-75 %.
                    target = round(total_primes * 0.70, 2)
                    rescale_sinistres(cur, sinistres, target)
                    n_pnl, total_primes, total_sin = seed_pnl(cur, contrats, sinistres)
                    seed_macro(cur)
                    ensure_kill_switch(cur)
                    ratio = total_sin / total_primes * 100 if total_primes else 0.0
                    summary_extra = (
                        f"   {n_pnl} écritures pnl_ledger\n"
                        f"   Primes {total_primes:,.2f} EUR | "
                        f"Sinistres comptabilisés {total_sin:,.2f} EUR | "
                        f"Ratio de sinistralité {ratio:.1f} %\n"
                        f"   {len(MACRO_INDICATEURS)} macro_indicateurs\n"
                        f"   kill_switch : ligne id=1 garantie (actif=false)"
                    )

                n_regle = sum(1 for s in sinistres if s["statut"] == "regle")
                total_regle = sum(s["regle"] for s in sinistres)
                print(f"Seed terminé ({'scale-maison' if args.scale_maison else 'générique'}) :")
                print(f"   {len(client_ids)} clients")
                print(f"   {len(contrats)} contrats")
                print(
                    f"   {len(sinistres)} sinistres "
                    f"({n_regle} réglés, {total_regle:,.2f} EUR réglés)"
                )
                if summary_extra:
                    print(summary_extra)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
