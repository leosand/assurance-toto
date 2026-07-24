# MCP Macro Wrapper

Micro-service FastAPI exposant `/macro-context` (GET) qui retourne :
```json
{"taux_bdf": 0.035, "inflation_insee": 0.02, "indice_gpr": 100.0}
```
Sources gratuites, sans clé API : Banque de France Webstat, INSEE (API Melodi/opendatasoft), GPR Index (Caldara & Iacoviello).
