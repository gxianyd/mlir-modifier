#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}/backend"
source .venv/bin/activate
exec uvicorn app.main:app --reload --port 8000
