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

## Desktop

`desktop/` is the Electron app, Vay Tutor Client. It stores a host address, checks `/api/v1/health` and `/api/v1/compatibility`, and opens that host in tabs. A new tab, and a link that asks for a new window, stays on that same host. It does not install MongoDB or keep institute records.

The [desktop workflow](.github/workflows/desktop.yml) builds the installers when desktop files change, and also when the workflow is run manually.

## Client-only installation

Other computers use this installation. One computer keeps the database. This one only connects to it.

The installed program is named Vay Tutor Client. After installation, enter the host address, for example `https://192.168.1.37:8443`. The app checks that the host is ready and that this client can use it, then opens the institute. Several pages can stay open in tabs. The host address is the only setup; the client accepts that computer’s certificate. Plain HTTP is refused.

The workflow attaches two artifacts:

| Artifact | Computer |
| --- | --- |
| `vay-tutor-client-only-windows` | Windows 11, NSIS installer |
| `vay-tutor-client-only-macos` | macOS, disk image |

## Full installation

One computer uses this installation. It includes the API, the institute UI, and a packaged MongoDB Community for when none is already running. If MongoDB is already listening on `127.0.0.1:27017`, Vay Tutor uses that instance and leaves it running when the program stops. If nothing is listening there, it starts the packaged MongoDB on that address. Local installation does not require a replica set. The institute is served at `https://127.0.0.1:8443`, and on this computer’s other addresses at port 8443, so the client-only installation on another computer can connect. Records, the database, and the certificate stay in `C:\ProgramData\Vay Tutor`. Removing the program leaves that folder in place. The installer offers a desktop shortcut.

The installed program is named Vay Tutor. A sign-in task starts it again at the next Windows sign-in. Closing the window leaves MongoDB and the API running. Vay Tutor Client on another computer needs only the host address. A phone or tablet browser needs `vay-tutor.cer` installed once; on Windows that file is `C:\ProgramData\Vay Tutor\vay-tutor.cer`, and `connect.txt` in that folder lists the address. MongoDB Community’s license is included beside `mongod.exe`. Redistribution of MongoDB Community has to be confirmed by the release owner.

Build both Windows installers from a checkout:

```bash
cd desktop && npm ci && CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --win --x64
node desktop/scripts/stage-full.js
cd desktop/host && npm ci && CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --win --x64
```

Both Windows installers are written to `desktop/release`:

| File | Installation |
| --- | --- |
| `VayTutorClient-Setup-0.2.0.exe` | Client-only, for the other computers |
| `VayTutor-Setup-0.2.0.exe` | Full installation, for the computer that keeps MongoDB, the API, and the institute UI |

The workflow also publishes the full installation as `vay-tutor-full-windows`. The installers are unsigned, so Windows SmartScreen asks for confirmation.

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
