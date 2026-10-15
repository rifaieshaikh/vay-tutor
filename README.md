# Vay Tutor

Institute management for one institute with many branches. Staff admit students, teach batches, record assessments, and read published progress. The active restructuring backlog is [docs/institute-management-task-list.md](docs/institute-management-task-list.md). The accepted model is [docs/ims-baseline.md](docs/ims-baseline.md).

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

Open http://127.0.0.1:5173. The first screen creates the institute and administrator. MongoDB stays on localhost. The API is the only component that talks to it.

## Checks

```sh
cd backend && PYTHONPATH=. .venv/bin/ruff check app && PYTHONPATH=. .venv/bin/python -m pytest
cd frontend && npm run build
```

`DEPLOYMENT_MODE=cloud` requires an authentication code for administrator sign-in. The default local mode does not.

## Where to change a workflow

Each domain owns its pages and its HTTP routes. Shared request checks live in `backend/app/deps.py`. Enrollment shape and name conflicts live in `backend/app/enrollment.py` and are used by admission, manual enrollment, transfer, and import.

| Change | Frontend | Backend |
| --- | --- | --- |
| Enquiry or admission | `frontend/src/admissions/` | `backend/app/admissions/` |
| Student profile, directory, or enrollment | `frontend/src/students/` | `backend/app/students/` |
| Branch, course, batch, or curriculum | `frontend/src/academics/` | `backend/app/academics/` |
| Teacher record or teaching assignment | `frontend/src/staff/` | `backend/app/staff/` |
| Import or marksheet | `frontend/src/assessments/` | `backend/app/assessments/` and `backend/app/importing/` |
| Progress card or academic view | `frontend/src/reports/` | `backend/app/reports/` |
| Account, access, audit, or policy | `frontend/src/administration/` | `backend/app/administration/` |

The dashboard and academic context options are in `backend/app/dashboard/`. A teaching assignment does not grant login access. Login grants stay in administration.
