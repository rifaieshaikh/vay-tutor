# M1 — Architecture and platform feasibility

Date: 7 October 2026 · Status: Approved for M2 planning · Baseline: [M0 decisions](m0-decisions.md) and [Product requirements v1.1](product-requirements.md)

This document closes milestone M1. It selects the architecture and the packaging approach. It does not authorize application implementation, installers, or cloud provisioning. The cloud provider, region, and budget stay open.

## What M2 may assume

- One FastAPI service is the only component that talks to MongoDB and to private files.
- React is one application, used in the browser and in the desktop client. It calls `/api/v1` only.
- The first site runs the full installation on one computer. That computer owns the database. Other computers use the client-only installer. Phones, iPads, and tablets use the browser. All clients use the network.
- The API process stays up when the desktop window is closed, so those clients can still connect.
- MongoDB listens on localhost only, as a one-member replica set, so a multi-document transaction can commit or abort.
- Authorization is an action plus one complete scope tuple, enforced in FastAPI on every request and again when a job finishes.

## ARC-01 — API contract

### Versioning and compatibility

All routes live under `/api/v1`. Breaking changes require `/api/v2`. Adding a field is not breaking. Removing or redefining a field is breaking.

Every response includes:

| Header | Meaning |
|---|---|
| `X-Api-Version` | `1` |
| `X-Server-Version` | Full installation or cloud build version |
| `X-Request-Id` | Id to quote in support and audit |

The client sends `X-Client-Version`. `GET /api/v1/compatibility` returns `compatible`, `upgrade_required`, or `server_older`, plus a plain-language message. An incompatible client receives **426** on later calls and must not show a successful connection.

The browser, the desktop client, and a future cloud deployment use this same contract. The client never receives a MongoDB connection string.

### Session

`POST /api/v1/auth/login` with email and password sets an `HttpOnly`, `Secure`, `SameSite=Lax` session cookie. The React app is always loaded from the API origin, including inside the desktop client, so the cookie is first-party.

Other session routes: `POST /api/v1/auth/logout`, `GET /api/v1/auth/session`, `POST /api/v1/auth/password`, `POST /api/v1/auth/recovery/redeem`.

Local full mode authenticates with institute accounts. Cloud mode adds TOTP for administrator accounts. Local mode does not call a cloud identity provider. Bootstrap recovery codes are single-use and hashed at rest.

`POST /api/v1/bootstrap` creates the institute and the first administrator. It rejects calls after bootstrap. It does not create branches, courses, or students.

Login failures are rate-limited per account and per client address. The response does not say which of the email or the password was wrong.

### Errors

```json
{
  "error": {
    "code": "import.heading_conflict",
    "message": "The sheet name says January 2027 and the heading says September 2026.",
    "details": { "file": "QT.xlsx", "sheet": "RATIO JAN-27", "row": 2, "column": "A" },
    "request_id": "..."
  }
}
```

| HTTP | Use |
|---|---|
| 400 | The body is malformed. |
| 401 | No session, or the session was revoked. |
| 403 | The session is valid and the action or scope is denied. |
| 404 | The record does not exist, or it exists outside the caller's scope. Both cases use 404 so a hidden record is not confirmed. |
| 409 | A concurrent edit, a duplicate canonical result, or a stale revision. |
| 422 | A business rule failed. `details` carries sheet, row, and column when the source is a workbook. |
| 426 | The client build is incompatible with this server. |

### Lists

Lists use cursor pagination.

```json
{ "items": [], "page": { "limit": 50, "next_cursor": null } }
```

The default limit is 50 and the maximum is 200. Filters that the caller is not allowed to see are dropped, and the response scope summary says what was applied. Sort is stable: the requested field, then `_id`.

### Context selectors

`GET /api/v1/context/options` powers every existing / new / detect control.

Query: `dimension` (`branch`, `course`, `batch`, `subject`, `paper`, `exam_type`), optional parent ids, and `q`.

Each item is `{ "id", "label", "parents" }`. Results are limited to tuples the caller can import or view. `new` and `detect` are client states and are not stored until commit. The institute is the session institute and is not a selector.

### Import

| Method and path | Effect |
|---|---|
| `POST /api/v1/imports` | Multipart `.xlsx`. Stores the original file. Creates a job. Returns the job id. Does not create academic records. |
| `GET /api/v1/imports/{id}` | Job, sheets, detected headings, score groups, plan, exceptions, and per-sheet outcomes. |
| `PATCH /api/v1/imports/{id}` | Workbook defaults, per-sheet and per-score-group overrides, include or skip with a reason, heading acknowledgements, batch assignments, score-group interpretation, exam dates, and keep-distinct or merge choices. |
| `GET /api/v1/imports/{id}/preview` | Create and reuse totals, canonical marks, source differences, blockers. |
| `GET /api/v1/imports/{id}/validation-report` | Spreadsheet of the preview. Rechecks export permission. |
| `POST /api/v1/imports/{id}/commit` | Queues an atomic commit of the approved plan to draft marksheets. |
| `POST /api/v1/imports/{id}/cancel` | Cancels a job that has not committed the current sheet. |

Upload and preview write no branches, students, enrollments, or marks. Commit does.

Import job states: `uploaded`, `discovering`, `needs_resolution`, `ready`, `committing`, `committed`, `failed`, `cancelled`.

A sheet outcome is `included`, `skipped`, `committed`, or `failed`. A skipped sheet stores the reason. A failed sheet stores the error and leaves no records that the failed sheet itself created.

### Marksheets, cards, and views

| Method and path | Effect |
|---|---|
| `GET /api/v1/marksheets` | Register. Filters: branch, course, batch, subject, paper, exam type, date, status. |
| `GET /api/v1/marksheets/{id}` | Source, validation summary, revision history, and a cursor of results. |
| `PATCH /api/v1/marksheets/{id}/results/{result_id}` | Draft correction. Requires `marksheet.edit_draft`. |
| `POST /api/v1/marksheets/{id}/submit` | Draft to submitted. |
| `POST /api/v1/marksheets/{id}/reject` | Submitted back to draft. |
| `POST /api/v1/marksheets/{id}/publish` | Atomic publish of one revision. Blocked by the DEC-05 rules. |
| `POST /api/v1/marksheets/{id}/correct` | New revision of a published marksheet. Body includes the reason and the changed results. |
| `POST /api/v1/marksheets/{id}/withdraw` | Withdraws the active revision. Body includes the reason. |
| `GET /api/v1/students` | Minimal lookup fields only, unless the caller has `student.manage`. |
| `GET /api/v1/students/{id}/card` | Progress card for authorized subjects. |
| `POST /api/v1/reports/cards` | Batch PDF or XLSX job. |
| `GET /api/v1/views/{level}` | `level` is `institute`, `branch`, `course`, `batch`, `subject`, or `paper`. Query carries the persistent filters. |

Publish, correct, and withdraw return **422** with the blocker list when the exam date, heading acknowledgement, score-group choice, or identity exception is still open. Draft data is absent from view and card payloads.

View payloads include sample size, policy version, coverage label, and `roster_confirmed: false` until a roster snapshot exists. Full-batch participation is omitted in that case. A comparable cross-branch figure appears only when an assessment link is marked `comparable: true`.

### Administration

| Area | Routes |
|---|---|
| Users | `GET/POST /api/v1/users`, `PATCH /api/v1/users/{id}` for activation, deactivation, and credential reset |
| Roles | `GET/POST /api/v1/roles`, `PATCH /api/v1/roles/{id}` |
| Grants | `GET/POST /api/v1/grants`, `DELETE /api/v1/grants/{id}` |
| Effective access | `GET /api/v1/users/{id}/effective-access` |
| Audit | `GET /api/v1/audit` |
| Policy | `GET /api/v1/policies/active`, `POST /api/v1/policies` creates the next version |
| Catalog correction | `PATCH` on branch, course, batch, subject, paper, assessment, and student. `POST /api/v1/students/merge` with an impact preview |
| Files | `GET /api/v1/files/{id}` downloads a source workbook or generated report after a fresh permission check |
| Jobs | `GET /api/v1/jobs/{id}` |
| Backup | `POST /api/v1/ops/backups`, `POST /api/v1/ops/restores` |

Grant save returns the human-readable consequence of every omitted dimension before the grant is stored. The client sends `acknowledge_scope: true` on the second call. The server rejects a grant the actor cannot delegate, a self-elevation, and removal of the last active institute administrator.

### Health

`GET /api/v1/health` returns API, database, worker, and disk status without academic data. The host window and the client connection screen use it. A failed dependency is an error state, not a successful login.

## ARC-02 — MongoDB model and consistency

### Deployment shape

The full installation runs MongoDB Community Server as a **one-member replica set** bound to `127.0.0.1`. Standalone `mongod` cannot run multi-document transactions. A one-member replica set can. The packaging spike must confirm that on the pinned build. If that build refuses a one-member set, the fallback is a second local member on another localhost port, still unreachable from the network.

Write concern for commit and publish is `majority`. The application uses one session transaction per sheet commit and one session transaction per publication or correction.

Cloud, when it is chosen later, uses a replica set or a compatible managed cluster with the same transaction boundary. It is a different deployment, not a second writer for the first site.

### Collections

Each document stores `institute_id` except `institutes` itself. Academic documents store the parent ids needed to authorize them without a join across untrusted input.

| Collection | Holds | Uniqueness |
|---|---|---|
| `institutes` | One institute. Code `IAM`. | `code` |
| `counters` | `student_code` sequence. | `name` |
| `users` | Account, password hash, recovery-code hashes, `session_version`, active flag. | email |
| `sessions` | Cookie id hash, user, expiry, `session_version`. | cookie hash |
| `roles` | Named action bundles. Custom roles allowed. | institute + role name |
| `grants` | One complete scope tuple plus the role or the explicit actions. | — |
| `audit_events` | Append-only. | — |
| `branches` | IAM Tirur and later branches. `name_key`. | institute + `name_key` |
| `courses` | CA Foundation and later courses. | institute + `name_key` |
| `offerings` | Branch plus course. | `branch_id` + `course_id` |
| `batches` | Session key `2026-09` or `2027-01`, display name, offering. | offering + session key |
| `subjects` | Accounting, Business Law, QT, Economics. | course + `name_key` |
| `papers` | Number plus subject. | subject + number |
| `exam_types` | `unit`, `part`, `chapter`. | institute + code |
| `assessments` | Title, title key, type, format, maximum, eligible batch ids, optional date, topic, series. | the identity key below |
| `attempts` | `original` or `retest`, link to the original attempt, its own maximum. | assessment + kind + retest sequence |
| `students` | `student_code` (`IAM-000001`), display name, `name_key`. | `student_code` |
| `aliases` | Approved alternate `name_key` for one student, used only in that student's enrollment contexts. | student + `name_key` |
| `enrollments` | Student, offering, batch, effective dates. | student + batch |
| `enrollment_names` | `name_key` reserved inside one batch. | batch + `name_key` |
| `marksheets` | Assessment, attempt, eligible batches, status, active revision, source job. No embedded result rows. | one draft or active published row per assessment + attempt + cohort key |
| `results` | One student enrollment, score or status, revision, active flag, source coordinates. | marksheet + enrollment + revision |
| `roster_snapshots` | Confirmed eligible enrollment ids for a batch and time. Separate collection, not an array that grows without a bound on the batch document. Membership is its own documents: `roster_members`. | snapshot + enrollment |
| `policies` | Versioned calculation policy. | institute + version |
| `assessment_links` | Explicit comparability between two assessments. Default `comparable: false`. | pair of assessment ids |
| `import_jobs` | File id, actor, state, plan, decisions, sheet outcomes, file hash. | — |
| `files` | Storage key, media type, byte size, sha256, retention. Bytes are not in MongoDB. | sha256 + institute, for duplicate detection |
| `jobs` | Durable work item, lease, attempts, result file id. | — |

`name_key` is trim, collapsed internal whitespace, and Unicode case fold. Display strings keep the first-seen spelling.

Assessment identity key: `branch_id`, `course_id`, `subject_id`, `paper_id`, `exam_type_id`, `title_key`, `maximum`, and the sorted eligible batch ids. The same title with a different maximum is a different assessment, except a retest attempt linked to the original. September Ratio and January Ratio are two assessments because their eligible batches differ.

A result status is `scored`, `absent`, `missing`, or `exempt`. A scored result stores the exact decimal. Percent, rank, and band are derived at read and may be cached on the result only after publication, tagged with the policy version. Cache rebuild is the recalculation job.

### What is deliberately not embedded

Marksheets do not contain result arrays. Batches do not contain enrollment arrays. Audit events are not updated in place. Import jobs store decisions and sheet summaries, and they point at `results` for the committed rows. A workbook of 20,000 rows creates 20,000 result documents, not one document.

### Transactions

| Boundary | Inside the transaction | On failure |
|---|---|---|
| Sheet commit | Upsert of the entities this sheet is allowed to create, new students and enrollments, the draft marksheet, and its results. Student codes are allocated with `findOneAndUpdate` on `counters` inside the same transaction. | Abort. No orphan student, enrollment, or mark from that sheet. Entities committed by an earlier sheet in the job remain. |
| Publish, correct, withdraw | Clear the previous active flag, set the new revision active, update the marksheet status, append the audit event. | The previous active revision stays the only active revision. |
| Cancel before commit | Job state only. | No academic writes. |

Concurrent imports of the same identity use the unique index. The loser gets a duplicate-key error and re-reads the winner instead of inserting a second student or assessment. Uncertain name matches are not inserted; they remain exceptions on the job.

Retries use the job id and the sheet id. A sheet already `committed` is not applied again. A repeated file hash is recognized and offered as skip or authorized revision.

Historical enrollments stay when a student later joins another batch. Renames change the display name and do not move existing results. Deletes of referenced master data are rejected. Archive sets `active: false`.

### Policy version 1

Stored as the first `policies` document, matching DEC-05: danger below 40, fifty-fifty from 40 through 60 inclusive, safe above 60, dense rank, weighted aggregate, latest attempt by exam date, no passing threshold, self-publication off.

## ARC-03 — Authorization

### Grant shape

A grant is one tuple, never a cross-product of separate lists.

```json
{
  "user_id": "...",
  "actions": ["marksheet.upload", "marksheet.view"],
  "scope": {
    "institute_id": "iam",
    "branch_id": "tirur",
    "course_id": "ca-foundation",
    "batch_id": null,
    "subject_id": "accounting",
    "paper_id": null
  }
}
```

`null` means every descendant of the fields that are set. The save preview must say that. A teacher grant for Accounting at Tirur does not include Law, and it does not include Accounting at another branch.

### Actions

`dashboard.view`, `student.lookup`, `student.manage`, `marksheet.view`, `marksheet.upload`, `marksheet.edit_draft`, `marksheet.submit`, `marksheet.publish`, `marksheet.correct`, `marksheet.withdraw`, `import.create_scope`, `progress_card.view`, `export.pdf`, `export.xlsx`, `catalog.correct`, `catalog.manage`, `user.manage`, `grant.manage`, `audit.view`, `backup.admin`.

`marksheet.upload` includes creating students, enrollments, and descendant academic records inside the tuple. `import.create_scope` is what allows a new branch under the institute or a new subject under a course. It does not include `grant.manage`. `backup.admin` does not include any academic action.

Suggested roles from the requirements are seed bundles. The check uses the expanded actions, not the role name.

### Evaluation

1. If the user is inactive, deny.
2. Load grants. Default deny.
3. A record is visible when at least one grant has the required action and every non-null scope field equals the record.
4. Lists, counts, ranks, charts, autocomplete, file downloads, and jobs all use that same predicate. A hidden row is not counted.
5. An upload-only grant can read the drafts of jobs that user created. It cannot read other published results.
6. `student.lookup` returns `student_code` and display name for students who have an enrollment inside the tuple. It does not return a directory of the institute.

### Creation without expanding scope

| Caller | Can create on import | Cannot create |
|---|---|---|
| Institute admin with `import.create_scope` at institute level | A new branch and anything under it | Grants, unless they also have `grant.manage` |
| Branch admin for Tirur | Courses, batches, subjects, papers, assessments, and students under Tirur | Another branch |
| Teacher for Tirur / CA Foundation / Accounting | Assessments, attempts, and minimal students inside that subject | A new branch, course, or subject |

Creating a record does not insert a grant. Descendants are reachable because the parent tuple already includes them.

If a sheet needs a create the caller cannot perform, that sheet is `needs_resolution` with the missing action. Another user with that action can resume the same job. The original user still cannot commit that sheet.

### Worked checks

**Accounting at Tirur only.** Actions `marksheet.upload` and `marksheet.view`, scope Tirur + CA Foundation + Accounting. Upload of an Accounting sheet commits. An Economics sheet in the same workbook is rejected unless it is explicitly skipped. Publish and export return 403. A direct request for a Law marksheet returns 404.

**Two disjoint tuples.** Grant A is Accounting at Branch A. Grant B is Law at Branch B. Law at Branch A and Accounting at Branch B match neither tuple. Totals, cards, source files, and exports follow the same rule.

**Revocation.** Deactivation or any grant change increments `users.session_version`. The next request with the old cookie receives 401. Permission is read from the database on each request, so the change is visible immediately and inside the one-minute target. A queued export stores the `session_version` and the grant ids it was allowed under. Before writing the file and before download, the worker loads the user again. A mismatch fails the job and deletes any partial output.

**Last administrator.** A transaction counts active users who hold institute-wide `grant.manage`. The update aborts when the count would become zero.

## ARC-04 — Files and jobs

### Private files

| Mode | Bytes | Metadata |
|---|---|---|
| Full installation | `{data_dir}/files/{file_id}` on the host, outside the application install folder | `files` collection |
| Cloud | Private object storage chosen with the provider. The application still reaches it only through FastAPI | same `files` collection |

The original workbook and every generated report are stored this way. Logs must not contain mark values, passwords, recovery codes, or file contents. Retention follows DEC-06: keep them for the life of the institute. There is no automatic purge in release 1.

Download checks the caller's current permission, not the permission they had when the job was queued.

### Job document

```json
{
  "type": "import_commit",
  "state": "leased",
  "lease_until": "...",
  "attempts": 1,
  "actor_id": "...",
  "session_version": 3,
  "payload": { "import_job_id": "...", "sheet_id": "..." },
  "last_error": null
}
```

Types: `import_discover`, `import_commit`, `recalculate`, `report_pdf`, `report_xlsx`, `backup`, `restore`.

The worker runs inside the API process. A supervisor restarts that process if it dies. On startup the worker resumes jobs whose lease has expired. Commit and publish stay idempotent under that resume. Discover and report jobs can run again. Restore refuses to start when an import or publish job is leased.

Cancellation sets `cancel_requested`. The worker stops before the next sheet transaction and does not abort a transaction that already committed.

Users see `queued`, `running`, `succeeded`, `failed`, and `cancelled`, plus the last error in plain language. Export files expire from the download link after 7 days by removing the download grant on that file id. The audit event and the source workbook remain.

### Duplicate uploads

The file sha256 is stored on the import job. A second upload of the same bytes in the same institute returns the earlier job and asks for skip or revision. It does not create a second result set.

## ARC-05 — Desktop packaging

Selected approach, from vendor documentation. No installer has been built. M5 is what produces signed installers and proves the residual checks below.

### Client-only installation

[Tauri 2](https://v2.tauri.app/develop/sidecar/) packages the Windows and macOS client. The client stores the host URL, opens that origin in the webview, and talks only to `/api/v1`. It does not embed Python, MongoDB, or the workbook store. Offline writes are absent. Connection failure uses `/api/v1/health` and the compatibility route, and it does not present an empty institute as success.

Windows target: Windows 11 x64, NSIS installer. macOS target: Apple Silicon and Intel, as separate builds or one universal build. Sidecar binaries are not required for the client.

The host UI can be this same client pointed at `https://127.0.0.1:8443`, or the system browser. Staff do not need the client in order to use the host.

### Full installation

The full installer is a different product name and a different package. It installs four parts:

| Part | Role |
|---|---|
| Supervisor | Windows service, or macOS LaunchDaemon, started without an interactive login so phones and other computers can connect while the desktop window is closed |
| MongoDB Community Server | One-member replica set on `127.0.0.1` only. Data directory under ProgramData or Application Support, never inside the folder that an upgrade replaces |
| API and worker | Embedded CPython running FastAPI and the job worker. Listens on the LAN only when network access is enabled |
| Host launcher | Tauri window for health, logs, backup, and opening the app. Closing it does not stop the supervisor |

Default API port is **8443**. If it is taken, the installer asks for another port and records it. The React app is static files served by FastAPI, so the browser and the launcher share one origin.

Uninstall stops the services and removes the program files. It leaves the data directory unless the operator chooses a separate delete.

Upgrade copies a consistent backup first: `mongodump` of the replica set plus the files directory. The data directory is migrated in place. A failed migration restores that backup. Client builds that are too old receive **426**.

### Network encryption

The installer creates a private certificate authority and a host certificate whose names include `localhost`, the computer name, and the LAN address. Clients must use HTTPS. MongoDB is not given a LAN listener.

A desktop client trusts the host CA through the installer prompt. An iPhone or iPad trusts it only after the operator installs the CA profile and enables full trust for that certificate, which is an Apple platform rule. Android must install the same CA. This one-time trust step is part of first-site setup. Plain HTTP does not meet the encryption decision.

### Licensing evidence

MongoDB Community Server is SSPL. [MongoDB's SSPL FAQ](https://www.mongodb.com/legal/licensing/server-side-public-license/faq) says an application built on Community Server is not, by itself, a public MongoDB-as-a-service, and that section 13 does not apply to an internal deployment. This installation matches that description only while clients reach FastAPI and `mongod` stays on localhost. The Release owner still has to confirm redistribution, keep the SSPL notice, and ship the MongoDB source offer before a public installer. Python, FastAPI, and Tauri use permissive licenses; the spike records the exact notices.

### Residual proof for the first packaging build

These are M5 checks, not reasons to change the M2 design:

- A one-member replica set on the pinned MongoDB build commits and aborts a multi-document transaction. MongoDB's transaction documentation requires a replica set. One production page also says "multiple node". If one member is rejected, use the local second member.
- The supervisor comes up after reboot on Windows 11 and on macOS 14 Apple Silicon and Intel, with the window closed, and an iPad on the LAN can log in.
- The private CA is trusted by the desktop client and, after the profile step, by Safari on iPad.
- Signed Windows installers and notarized macOS images install, upgrade, and uninstall without deleting data.

## ARC-06 — Local operations and the cloud slot

### First site

One computer runs the full installation. It is the only authority. Other computers install the client and set the host URL. Phones, iPads, and tablets open `https://<host>:8443` in the browser. The host itself works when the network is down. Clients do not.

Accounts, passwords, and recovery codes are local. Daily backups go to a folder the operator chooses, preferably a second disk. A backup is the database dump plus the files directory plus a manifest of counts. Restore replaces both, then refuses to start until the counts in the manifest match.

There is no sync with a cloud database.

### Cloud, later

When Operations chooses a provider, region, and budget, that deployment is a second authority with the same `/api/v1` contract, the same collections, private object storage, and a managed replica set. Administrator accounts there require TOTP. Moving an institute is backup, load, reconcile counts and grants, and cut over. Both sides must not take writes during the cutover.

Until that choice is made, M2 and M3 do not add a cloud account, a region, or a second database connection.

### Process and ports

| Listener | Address |
|---|---|
| MongoDB | `127.0.0.1` only |
| API | `127.0.0.1:8443` always, plus the LAN address when network access is on |
| Desktop client | Outbound to the configured URL only |

The operator turns LAN listening on during first-site setup. The installer does not open MongoDB to the LAN as part of that switch.

## Milestone exit

ARC-01 through ARC-06 are decided here. Feature work in M2 can use this contract, this data model, and this packaging split. Signed installers, the live packaging proof, and cloud hosting remain later milestones.
