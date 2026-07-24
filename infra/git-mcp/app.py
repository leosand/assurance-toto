#!/usr/bin/env python3
\"\"\"infra/git-mcp/app.py — Wrapper MCP minimal pour committer automatiquement vers Gitea local.\"\"\"
import os
import subprocess
from fastapi import FastAPI, Request
import uvicorn

app = FastAPI(title="MCP Git — Assurance Toto")

REPO_URL = os.getenv("GITEA_REPO_URL", "http://gitea:3000/toto/assurance-toto.git")
TOKEN = os.getenv("GITEA_ACCESS_TOKEN", "")
LOCAL_CLONE = "/data/repo"

def ensure_repo():
    if not os.path.exists(LOCAL_CLONE):
        auth_url = REPO_URL.replace("http://", f"http://toto:{TOKEN}@")
        subprocess.run(["git", "clone", auth_url, LOCAL_CLONE], check=False)

@app.post("/commit")
async def commit(request: Request):
    body = await request.json()
    filepath = body["filepath"]
    content = body["content"]
    message = body.get("message", "auto-commit: hermes agent update")
    ensure_repo()
    full_path = os.path.join(LOCAL_CLONE, filepath)
    os.makedirs(os.path.dirname(full_path), exist_ok=True)
    with open(full_path, "w", encoding="utf-8") as f:
        f.write(content)
    subprocess.run(["git", "-C", LOCAL_CLONE, "add", filepath], check=False)
    subprocess.run(["git", "-C", LOCAL_CLONE, "commit", "-m", message], check=False)
    subprocess.run(["git", "-C", LOCAL_CLONE, "push"], check=False)
    return {"status": "committed", "filepath": filepath}

@app.get("/health")
def health():
    return {"status": "ok"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8090)
