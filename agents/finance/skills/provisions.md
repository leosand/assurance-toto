# Skill: Provisions Management

## Role
Keep provisions for ongoing claims up to date.

## Instructions
1. Recompute `encours_provisions` every day from claims with status='ouvert' or 'en_expertise'.
2. Apply the cost of capital (Banque de France rate fetched via `mcp-macro-wrapper`) to assess the cash-flow impact.
3. Alert if outstanding provisions exceed 20% of cumulative revenue (prudence threshold).
