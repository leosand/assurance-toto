#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
seed_faker.py — 100% synthetic data for Assurance Toto (v2 schema).

- Fictional French PII via Faker (fr_FR locale).
- Deterministic: Faker.seed(SEED) + random.seed(SEED) => same data on every run.
- Connection via environment: PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
  (defaults: localhost, 5432, postgres, postgres, assurance_toto).
- --scale-maison: small coherent portfolio (~120 clients, 200 contracts,
  60 claims/sinistres) with a ~65-75% claims ratio, matching pnl_ledger
  writes (premium +, settlement/reserves -, expenses -), 3 macro_indicateurs
  rows and the kill_switch row (id=1, actif=false).

pnl_ledger sign convention: REVENUE positive (premium), EXPENSES negative
(reserves, settlement, expenses, marketing). Net result = SUM(montant).
See infra/postgres/schema_v2.sql and infra/postgres/README.md.

Dependencies: psycopg2-binary, faker.
Usage:
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

# Realistic status distribution (~ 93% of claims/sinistres closed).
STATUTS_SINISTRE = ["ouvert"] * 2 + ["en_cours"] * 5 + ["regle"] * 70 + ["refuse"] * 18 + ["contentieux"] * 5
TOUTES_FRANCHISES = ("auto", "auto", "auto", "habitation", "sante", "vie")

MACRO_INDICATEURS = [
    ("taux_bdf", 3.15, "2026-T2", "Banque de France"),
    ("inflation_insee", 2.1, "2026-06", "INSEE"),
    ("gpr", 132.5, "2026-06", "Caldara-Iacoviello GPR index"),
]

# Sinistre statuses producing a pnl_ledger entry, and their category.
CATEGORIE_PNL_PAR_STATUT = {
    "ouvert": "provision",
    "en_cours": "provision",
    "contentieux": "provision",
    "regle": "reglement",
}


def db_connect():
    """PostgreSQL connection via environment variables (local defaults)."""
    return psycopg2.connect(
        host=os.environ.get("PGHOST", "localhost"),
        port=int(os.environ.get("PGPORT", "5432")),
        user=os.environ.get("PGUSER", "postgres"),
        password=os.environ.get("PGPASSWORD", "postgres"),
        dbname=os.environ.get("PGDATABASE", "assurance_toto"),
    )


def seed_clients(cur, n):
    """Inserts n synthetic clients, returns the list of ids."""
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
    """Inserts n contracts, returns a list of dicts {id, prime, date_debut}."""
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
    Inserts n sinistres (claims). Returns a list of dicts:
    {id, contrat_id, date_sinistre, estime, regle, statut}.
    In generic mode: random amounts 500-10 000 EUR.
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
    """Amount posted to pnl_ledger for a sinistre (0 if refused)."""
    categorie = CATEGORIE_PNL_PAR_STATUT.get(sin["statut"])
    if categorie is None:  # refuse: no expense posted
        return 0.0
    return sin["regle"] if categorie == "reglement" else sin["estime"]


def rescale_sinistres(cur, sinistres, target_total):
    """
    Rescales in DB (UPDATE by primary id) the posted amounts of the
    sinistres so that the sum (settlements + reserves) equals exactly
    target_total => controlled claims ratio (~65-75% of premiums).
    The POSTED amounts (not the estimates) are scaled, then the rounding
    residue is absorbed by the last posted row.
    Consistency invariant: montant_estime >= montant_regle.
    Deterministic (global random.seed).
    """
    posted = [(i, posted_claim_amount(s)) for i, s in enumerate(sinistres)]
    posted = [(i, m) for i, m in posted if m > 0]
    raw_total = sum(m for _, m in posted)
    if raw_total <= 0 or not posted:
        return
    factor = target_total / raw_total
    news = [round(m * factor, 2) for _, m in posted]
    # Absorb the rounding residue for an EXACT total (= target_total).
    news[-1] = round(news[-1] + (target_total - sum(news)), 2)
    for (i, _), p_new in zip(posted, news):
        sin = sinistres[i]
        if sin["statut"] == "regle":
            sin["regle"] = p_new
            sin["estime"] = round(p_new / random.uniform(0.85, 1.0), 2)
        else:  # reserve/provision (ouvert, en_cours, contentieux)
            sin["estime"] = p_new
            sin["regle"] = 0.0
        cur.execute(
            "UPDATE sinistres SET montant_estime = %s, montant_regle = %s WHERE id = %s",
            (sin["estime"], sin["regle"], sin["id"]),
        )


def seed_pnl(cur, contrats, sinistres):
    """
    Coherent pnl_ledger writes (convention: revenue +, expenses -):
    - prime       : + prime_annuelle per contract        (departement 'auto')
    - frais       : - 10% of the premium (acquisition/management expenses)
    - reglement   : - montant_regle of settled sinistres
    - provision   : - montant_estime of open/in-progress/disputed sinistres
    created_at follows the business date (contract / sinistre) for v_pnl_hebdo.
    Returns (nb_writes, total_premiums, total_posted_sinistres).
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
             "Acquisition and management expenses (10% of the premium)", c["date_debut"]),
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
             f"Sinistre {s['statut']} (contract {s['contrat_id']})", s["date_sinistre"]),
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
    """Ensures the kill_switch row (id=1, actif=false). Idempotent."""
    cur.execute("INSERT INTO kill_switch (id, actif) VALUES (1, false) ON CONFLICT (id) DO NOTHING")


def main():
    parser = argparse.ArgumentParser(description="Faker fr_FR seeder for Assurance Toto")
    parser.add_argument("--clients", type=int, default=5000, help="Number of clients")
    parser.add_argument("--contrats", type=int, default=3000, help="Number of contracts")
    parser.add_argument("--sinistres", type=int, default=800, help="Number of sinistres (claims)")
    parser.add_argument(
        "--scale-maison",
        action="store_true",
        help="Small coherent portfolio: ~120 clients, 200 contracts, 60 sinistres, "
        "claims ratio ~65-75%%, pnl_ledger, macro_indicateurs, kill_switch.",
    )
    args = parser.parse_args()

    n_clients, n_contrats, n_sinistres = args.clients, args.contrats, args.sinistres
    if args.scale_maison:
        n_clients, n_contrats, n_sinistres = 120, 200, 60

    conn = db_connect()
    try:
        with conn:  # single transaction: all or nothing
            with conn.cursor() as cur:
                client_ids = seed_clients(cur, n_clients)
                contrats = seed_contrats(cur, client_ids, n_contrats)
                sinistres = seed_sinistres(cur, contrats, n_sinistres)

                summary_extra = ""
                if args.scale_maison:
                    total_primes = sum(c["prime"] for c in contrats)
                    # Target: 70% of premiums => achieved ratio in the 65-75% band.
                    target = round(total_primes * 0.70, 2)
                    rescale_sinistres(cur, sinistres, target)
                    n_pnl, total_primes, total_sin = seed_pnl(cur, contrats, sinistres)
                    seed_macro(cur)
                    ensure_kill_switch(cur)
                    ratio = total_sin / total_primes * 100 if total_primes else 0.0
                    summary_extra = (
                        f"   {n_pnl} pnl_ledger writes\n"
                        f"   Premiums {total_primes:,.2f} EUR | "
                        f"Posted claims/sinistres {total_sin:,.2f} EUR | "
                        f"Claims ratio {ratio:.1f} %\n"
                        f"   {len(MACRO_INDICATEURS)} macro_indicateurs\n"
                        f"   kill_switch: row id=1 ensured (actif=false)"
                    )

                n_regle = sum(1 for s in sinistres if s["statut"] == "regle")
                total_regle = sum(s["regle"] for s in sinistres)
                print(f"Seed done ({'scale-maison' if args.scale_maison else 'generic'}):")
                print(f"   {len(client_ids)} clients")
                print(f"   {len(contrats)} contrats")
                print(
                    f"   {len(sinistres)} sinistres "
                    f"({n_regle} settled, {total_regle:,.2f} EUR settled)"
                )
                if summary_extra:
                    print(summary_extra)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
