# Vay Tutor

Academic performance system for one institute with many branches. Release 1 is specified in `docs/`. This repository currently contains the M2 foundation: accounts, scoped access, audit, jobs, and the shared React shell.

## Local development

Requirements: Python 3.9 or newer, Node.js 22, and MongoDB 8 running as a one-member replica set on `127.0.0.1:27017`.

```sh
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
python scripts/initiate_replica.py
backend/.venv/bin/uvicorn app.main:app --app-dir backend --reload --port 8000
```

In another terminal:

```sh
cd frontend
npm install
npm run dev
```

Open http://127.0.0.1:5173. The first screen creates the institute and administrator. No branches or students are required.

MongoDB must stay bound to localhost. The API is the only component that talks to it.

## Checks

```sh
backend/.venv/bin/ruff check backend
backend/.venv/bin/pytest backend/tests
cd frontend && npm run build
```

`DEPLOYMENT_MODE=cloud` requires an authentication code for administrator sign-in. The default local mode does not. The cloud provider is still undecided.

## What is not in this build

Workbook import, progress-card calculation, and the Windows and macOS installers come in later milestones. Import Marklist is the empty-state action and does not upload a file yet.
