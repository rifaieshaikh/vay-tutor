# Multi-branch education management — Product requirements

Version: 1.1 · Date: 7 October 2026 · Status: M0 approved in [m0-decisions.md](m0-decisions.md). M1 architecture in [m1-architecture.md](m1-architecture.md).

## 1. Purpose and first-release outcome

Provide one reliable academic performance system for an institution operating multiple branches. The first release covers marksheet collection, student progress cards, academic performance views, and user administration with granular access control. React frontend, FastAPI backend, MongoDB storage, Windows and macOS installers for both full application and client, and cloud backend deployment are first-release requirements.

This document defines the product and delivery plan. It does not implement the application. M0 decisions in [m0-decisions.md](m0-decisions.md) are the approved baseline and supersede proposed defaults in this document where they differ. The cloud provider, region, and budget remain an Operations gate before cloud provisioning.

An authorized staff member must be able to start with an empty academic catalog, select context at multiple levels, and import an Excel marklist containing multiple sheets. The import automatically creates missing branches, courses, branch offerings, batches, subjects, papers, exam types, assessments, attempts, students and enrollments, and reuses matching existing records. No separate academic setup or student-roster upload is a prerequisite. Only missing or ambiguous information requires resolution in the import flow. Published results generate progress cards and academic views. Management must be able to drill from institute performance to branch, course, batch, subject, paper, assessment, and individual student, within their access scope.

## 2. Scope and boundaries

**Required in release 1:** institute/account bootstrap; marklist-only academic intake through multi-sheet XLSX imports with multiple selected context levels; automatic creation and reuse of all relevant academic details, students and enrollments; review, publication and corrections; progress cards; all six requested academic views; scoped roles and permissions; audit history; PDF and XLSX exports; browser and desktop access; full local installation; client installation; cloud deployment; backup, restore and upgrade procedures. Academic structure and student screens support browsing and correcting imported records rather than a required setup sequence.

**Deferred:** separate manual marksheet creation, standalone academic setup/roster-import workflows, fees, admissions workflows beyond imported student creation, timetable, transport, payroll, learning content, online exam delivery, biometric attendance, parent/student accounts, automatic messaging, predictive AI, and synchronization between independent local and cloud databases. “360 view” in this release means academic performance and data completeness, not a complete ERP profile.

## 3. Reference files and resulting requirements

The supplied files were inspected without modification. Workbook formatting is an input reference, not an authoritative definition of student identity or calculation policy.

| File | Worksheets | Observed structure and implications |
|---|---:|---|
| `sample-import-files/ACCOUNTANCY  RANK LIST.xlsx` | 8 | Paper 1 Accounting; unit and part exams; a retest with a different maximum; blanks and A/AB; BRS includes an explicit exam date. |
| `sample-import-files/ECONOMICS  RANK LIST -.xlsx` | 5 | Paper 4 Economics; single and combined September 2026/January 2027 batches; quarter marks and absence codes. |
| `sample-import-files/QT.xlsx` | 10 | Paper 3 QT; mixed batches; sheet names sometimes disagree with the batch heading; `CHAPTER -2 -2` has separate MARK(25) and MARK(20) groups. |
| `sample-import-files/LAW .xlsx` | 6 | Paper 2 Business Law; MCQ and other chapter/part exams; September and January cohorts; repeated or near-identical sheet names and blank marks. |

All 29 worksheets use a broadly similar pattern: merged heading rows for branch, course/batch, paper, series and exam title; a table headed SL.NO, NAME, MARK(maximum), %, RANK; then performance-band legends and footer text. Maximum marks vary, including 10, 12, 15, 20, 25, 29, 30, 40, 45 and 50. Names are the only supplied student identifiers. The legends state >60% safe, 40–60% fifty-fifty, and <40% danger. Some rank sequences appear inconsistent with exact scores; source ranks must be preserved for comparison but recomputed under a confirmed policy.

Product consequences:

- Automatically create students absent from the resolved context, with generated stable IDs when source IDs are unavailable. Reuse unique exact name/approved-alias matches within the same resolved enrollment context; ambiguous names require resolution, and names alone never merge students across branches or batches.
- Require explicit batch resolution for mixed cohorts and conflicting headings.
- Treat absence, missing marks and zero as distinct states.
- Require explicit interpretation of multiple score groups as separate assessments or components.
- Recalculate percentage and rank from canonical data; do not execute workbook formulas or rely on cached formula outputs.
- Ignore legends, merged-heading filler, footer rows and unused formatted columns as result data.
- Require an exam date before publication where the workbook does not supply one. Batch month is not the exam date.

## 4. Users and primary journeys

| Persona | Main responsibilities |
|---|---|
| Institute administrator | Set up the institution, academic catalog, users, roles and policies; oversee all authorized branches. |
| Branch administrator | Manage assigned branch rosters, assessments, imports and academic reports. |
| Academic coordinator | Review and publish results; compare performance in assigned courses and batches. |
| Teacher or marks uploader | View and/or upload results for specifically assigned branch/course/subject combinations. |
| Management viewer | Read authorized dashboards and progress cards; export only when separately permitted. |
| Installation/operator administrator | Configure endpoints, upgrades, backups and restore; this technical responsibility does not automatically grant academic access. |

Key journeys:

1. Administrator bootstraps the institute and users; no branch, course, batch, subject, paper or student pre-entry is required.
2. Staff opens Import Marklist, selects any known context levels, uploads a workbook, and sees automatically detected details and proposed existing/new records. The importer creates all missing details and students when the import is committed, after resolving only conflicts or missing information, then submits a draft.
3. Coordinator reviews the draft, confirms calculation rules and cohort, and publishes. Publication updates cards and dashboards together.
4. Teacher opens an authorized student's card, reviews exam history and subject trends, and exports an authorized report.
5. Management opens institute overview and drills into a branch, course, batch, subject and paper without losing filters.
6. Administrator grants upload permission for one subject in one branch/course, verifies effective access, and later revokes it.
7. Authorized coordinator corrects published marks with a reason; the application keeps the previous revision and regenerates affected outputs.

## 5. Academic model and terminology

| Entity | Required meaning and relationships |
|---|---|
| Institute | Root ownership and access boundary; owns branches and shared catalog. Release 1 must support one institute with many branches and keep institute IDs on owned records. |
| Branch | A physical or operational unit of the institute. |
| Course | An academic program shared across branches, such as CA Foundation. A branch offering connects a course to a branch. |
| Batch | A cohort belonging to a branch/course offering, with code, display name, academic period and active dates. A target examination session is stored separately from an assessment date. |
| Subject | A curriculum area belonging to a course. Shared curriculum versions preserve historical meaning. |
| Paper | Proposed definition: a numbered/named assessed curriculum unit within a subject. Every assessment must select both subject and paper. This definition requires business confirmation. |
| Exam type | Configurable category such as unit, part, chapter, mock or final. MCQ/descriptive is a separate assessment format. |
| Assessment | A particular exam occurrence, with title, exam type, format, date, paper, maximum score and eligible batches. Topic labels and series are optional metadata. |
| Attempt | Original attempt or retest linked to its original assessment. Retests may have different maximum scores. |
| Student | Stable institute student ID, name and minimal necessary profile information. Automatically created during import, using a supplied ID or a generated ID. Names may have reviewed aliases. |
| Enrollment | Student membership in a branch/course/batch with effective dates and applicable subjects. Transfers retain historical enrollment. |
| Marksheet | Results for an assessment/attempt and defined cohort, with draft/published status and revisions. A workbook can produce multiple marksheets. |
| Result | Student, enrollment, assessment/attempt, score or status, source provenance and revision. |
| Import job | Source file, sheet/row/column locations, mappings, validation decisions, status and submitting user. |

A common assessment can include multiple batches within one branch/course. Each result retains its student's confirmed batch enrollment, and publication permission must cover every participating batch. Cross-branch comparisons use explicitly matched assessments; similarly named exams are not automatically equivalent.

Paper must not ambiguously mean an uploaded question-paper file or an exam occurrence. A future attachment can be modeled separately. The supplied samples combine paper number and subject title; they do not establish a separate subject hierarchy.

## 6. Functional requirements

All requirements in this section are first-release requirements unless stated otherwise.

### 6.1 Automatic academic and student creation

- **SET-01:** Import automatically creates missing branches, courses, offerings, batches, subjects, papers and exam types in their resolved parent context. Reuse matching records instead of duplicating them. Users may inspect, correct, rename and deactivate imported details with appropriate permission. Prevent invalid combinations, such as a paper outside the selected course.
- **SET-02:** Import automatically creates missing students and enrollments. Generate stable institute student IDs if the workbook lacks IDs; retain source names and identifiers. Detect conflicting IDs, ambiguous name matches and duplicate source rows. Student merges require elevated permission, an impact preview and an audit trail; an unmatched student does not require a separate roster workflow.
- **SET-03:** Preserve historical marks and enrollment context when catalog entries are renamed, archived or students transfer. Referenced master data cannot be silently deleted.
- **SET-04:** Configure performance bands, passing thresholds, ranking and aggregation policy with effective versions. Risk bands and official pass/fail criteria are separate concepts.

### 6.2 Assessment and marksheet management

- **MRK-01:** Resolve branch, course, eligible batch(es), subject, paper, exam type, assessment title, exam date, attempt and positive maximum marks from selected levels and workbook contents before publication. The importer creates missing assessment and attempt records. Request absent required values within the import flow; do not require prior setup.
- **MRK-02:** Create marksheets exclusively through Excel marklist import in release 1. Preserve decimal scores and explicit statuses; allow authorized correction of imported drafts/results. Drafts do not affect published analytics.
- **MRK-03:** Show a searchable marksheet register with branch/course/batch/subject/paper/date/type/status filters, source, uploader, reviewer and revision.
- **MRK-04:** Support draft → submitted → published, with return-to-draft on rejection. Authorized self-publication is allowed only if institute policy enables it; default is separate upload and publish permissions.
- **MRK-05:** Correct or withdraw published results with a required reason, revision history and permission. Only one active published revision may contribute to analytics. Concurrent edits must warn about conflicts.

### 6.3 Import flow and safeguards

1. **IMP-01 — Select levels and upload:** Accept XLSX workbooks with multiple sheets. Before or after file selection, let users select known branch, course, batch, subject, paper and exam-type levels. Each level supports an existing value, a new value to create, or detection from the workbook. Selected values can apply to the whole workbook or specified sheets/score groups. Missing parents are resolved automatically from compatible selections or workbook data. Show file limits and progress; reject unsupported, corrupt or protected files with actionable errors. Preserve the original file privately.
2. **IMP-02 — Discover:** List every sheet, detected headers, metadata, result-row count and score groups. User selects sheets to include or explicitly skip with a reason; nothing is silently discarded.
3. **IMP-03 — Detect and create details:** Resolve context from selected levels, headings and remembered mappings. Preview existing records to reuse and missing records to create, including branch, course, offering, batch, subject, paper, exam type, series/topics where present, assessment and attempt. Unambiguous mappings require no per-record confirmation or separate setup forms. Selected context is authoritative after any conflicting workbook labels are acknowledged; do not silently change headings into another context. For the sample paper labels, derive the subject title and numbered paper together. Ask inline for required information that cannot be determined.
4. **IMP-04 — Create or reuse students:** Use supplied stable student IDs first. Without IDs, reuse a unique normalized exact name or approved alias within the same resolved branch/course/batch context; otherwise automatically create a student and enrollment with a generated ID when no match exists. Display all create/reuse decisions in the preview. Multiple candidates, conflicting IDs, duplicate same-name rows or suspected variant matches require resolution; fuzzy matches only suggest candidates. Do not auto-merge across different enrollment contexts. Creating a student's minimal imported identity requires import permission, not a separate roster permission; broad profile editing and merges remain separately controlled.
5. **IMP-05 — Resolve score groups:** For QT `CHAPTER -2 -2`, display both 25-mark and 20-mark groups. Require separate assessment identities, a retest relationship, or an explicit component definition. Component weights/maxima must be defined; repeated student rows or overlapping imports must not double count results.
6. **IMP-06 — Validate:** Flag scores below zero or above maximum, invalid maximum, unknown status codes, duplicate results, missing IDs/mappings/dates, incompatible academic context and unauthorized scope. Support A/AB → absent as a visible mapping; blanks → missing, never automatic zero.
7. **IMP-07 — Preview:** Show selected/detected context, each new or reused entity, new/reused students and enrollments, canonical marks, computed percentage/rank/band, source differences, observed list coverage, warnings and blocking errors. Errors identify file, sheet, row and column. Provide totals for records to create, reuse, skip or revise, and export a validation report. Committing the import approves the unambiguous creation plan in one action.
8. **IMP-08 — Commit:** Create/reuse resolved academic entities, students and enrollments together with each selected logical marksheet atomically to draft. A failing sheet must leave no partial marks or unused new records. Shared entities are created once and reused by subsequent successful sheets. Valid sheets can proceed through explicit selection with per-sheet outcomes; publication is separate. Upload or preview alone creates no permanent records.
9. **IMP-09 — Retry and duplicates:** Recognize repeated source uploads and canonical student/assessment/attempt duplicates. Offer skip or authorized revision, never silent overwrite. Retrying a job cannot create extra results.
10. **IMP-10 — Traceability:** Retain source coordinates, confirmed mappings, identity decisions and job history. Large imports run as resumable background jobs with understandable status and failure messages.
11. **IMP-11 — Matching and concurrency:** Normalize surrounding whitespace, repeated spaces and case for exact matching while preserving display labels. Entity matching keys include ownership/parent context, such as institute + branch name, course + subject, offering + batch, and subject + paper code. Do not collapse distinct batch sessions or assessments on title alone. Concurrent imports and retries must reuse the same academic entities, students and enrollments; uncertain matches remain visible for resolution.
12. **IMP-12 — Multiple selected levels:** Interpret “multiple selected levels” as selecting several hierarchy dimensions together, with optional different context assignments for different sheets. Selecting multiple batches declares eligible cohorts; it does not copy every result into every batch or create a Cartesian product of selections. Resolve each result to one enrollment. The institute comes from the active authorized workspace and is never created or switched by workbook headings.

Example: importing an Accounting workbook into an empty institute detects IAM TIRUR, CA Foundation, September 2026, Accounting, Paper 1, exam types and assessments. Commit creates the branch, course/offering, batch, subject/paper, assessment/attempt records, all listed students and their enrollments, and the draft marksheets. Importing the next workbook reuses known context and students, creates only missing details, and reports conflicts instead of requiring pre-entry.

### 6.4 Student progress cards

- **PRG-01:** One student profile connects all permitted historical enrollments and marksheets. Filters include enrollment, date range, subject, paper and exam type.
- **PRG-02:** Show scores/maxima, percentages, assessment dates, attempts, result status, cohort rank, performance bands, subject/paper summaries and a chronological trend.
- **PRG-03:** Show original and retest side by side, missing results, absence history, latest performance, change in percentage points and assessments included in totals. Undated drafts are excluded from timelines.
- **PRG-04:** Highlight current low-performance results and missing-data concerns separately. Explain the thresholds and comparison basis. A configurable intervention flag can use confirmed rules; do not infer a prediction from sparse history.
- **PRG-05:** Generate printable PDF cards individually and in authorized batch runs, with institute/branch identity, student ID, reporting period, publication revision, generation time and calculation-policy notes. Provide spreadsheet export of authorized detail.
- **PRG-06:** A subject-restricted user sees only that subject's results and summaries on a card; whole-course totals derived from hidden results must not be exposed. Label the card as covering authorized subjects only.

### 6.5 Academic 360 views

Each view provides summaries, trends, result completeness, risk-band distribution, filters and drill-down into contributing published records. Zero-data views show why data is unavailable, not misleading zero performance.

| View | Required content |
|---|---|
| Institute | Authorized branches; distinct student/enrollment counts; assessed participation; normalized performance; risk distribution; branch comparison and missing imports. |
| Branch | Course and batch comparison; assessment publication status; performance trends; students requiring attention. |
| Course | Branch offerings and batches; subject/paper performance; comparable assessment results across authorized branches. |
| Batch | Eligible roster, exam participation, subject/paper matrix, result completeness, rank lists and student cards. |
| Subject | Paper and topic-labeled assessment history; batch/branch breakdown; score distribution; missing/absent results. |
| Paper | Assessment and attempt history; exam-type breakdown; cohort distribution; student-level result detail. |

- **VIEW-01:** Global context filters persist across drill-down; users can see current scope and reset filters.
- **VIEW-02:** Comparisons show sample sizes, dates, assessment identity and policy. Different tests are descriptive trends unless comparability is explicitly confirmed.
- **VIEW-03:** All totals, charts, autocomplete, downloads and background exports honor the same access scope as detail pages. A restricted user must not infer hidden results through aggregate counts or rankings.
- **VIEW-04:** Provide accessible tables alongside charts, clear loading states and searchable/paginated student lists.

## 7. Calculation and completeness rules

These are proposed release-1 defaults to confirm during discovery. The application must display and version the selected policy.

| Topic | Proposed behavior |
|---|---|
| Score percentage | Obtained ÷ maximum × 100 for numeric results. Preserve quarter/half marks; display two decimals without rounding before calculation or ranking. |
| Bands | Danger <40%; fifty-fifty ≥40% and ≤60%; safe >60%, matching sample legends. Boundaries 40 and 60 are explicit. |
| Absence | A/AB maps to absent. No numeric percentage or rank; report separately. |
| Missing | Blank/unentered mark is missing. No numeric percentage or rank; never interpret as absent or zero. |
| Zero | Valid entered score; contributes to scored performance and ranks. |
| Not applicable | Explicit exemption from eligibility, with reason; excluded from expected participation denominator. |
| Ranking | Dense ranking on exact scores within the same assessment, attempt and declared cohort: 1, 1, 2. Do not copy inconsistent source ranks. Mixed cohorts can show combined and per-batch ranks with labels. |
| Retest rollup | Latest published attempt by exam date is the default selected attempt; original and all attempts remain visible. Best-score policy is optional and separately labeled. Compare percentages when maxima differ. |
| Aggregate performance | Sum selected obtained scores ÷ sum corresponding maxima × 100; label as maximum-marks-weighted. Exclude missing/absent results, and always show coverage. Do not average displayed rounded percentages. |
| Participation | Scored eligible results ÷ expected eligible student-assessment opportunities. Absences, missing marks and exemptions appear separately. This is exam participation, not classroom attendance. |
| Pass rate | Passing scored results ÷ scored results, only when an explicit pass threshold is configured. Show denominator and absences separately. |
| Counts | Distinct students for people counts; enrollments for enrollment counts; do not sum batch headcounts as unique institute students. |
| Trends | Order by assessment date, then stable assessment/attempt order. Change is in percentage points and descriptive where assessment difficulty differs. |

The first marklist establishes observed enrollment membership without claiming to be a complete roster. Import preview must distinguish listed-row completeness from full-batch coverage. Full-batch participation requires a confirmed eligible roster snapshot, which can be established from accumulated imported enrollments and confirmed within the import/review flow; it is not a prerequisite to importing marks. Until confirmed, label counts as “students listed in imported marklists” and suppress full-batch participation percentages. A student omitted from a sheet is not automatically absent. Combined-batch results must enter branch/course totals once. Multiple components contribute to a parent total only under a defined component policy; component and parent totals cannot both contribute to the same rollup.

Example verification: 15/20 = 75%; 10/25 = 40%; their combined weighted percentage is 25/45 = 55.56%. The arithmetic mean, 57.5%, is a different metric and must not be substituted. An absent or missing third result changes coverage but does not silently add a zero score.

## 8. User management and role-based scoped ACLs

### 8.1 Permission model

Every permission requires both a **feature/action** and a **resource scope**. Roles provide action bundles; administrators assign those bundles to explicit scope tuples. Default access is denied. Multiple grants form a union of complete tuples, never independent unions of branch, course and subject lists.

Example grant: `{marksheet.upload, marksheet.view}` scoped to `{institute: I, branch: Tirur, course: CA Foundation, subject: Accounting}`. It permits those actions only for that combination. It does not grant publication, export, other subjects, or the same course in another branch. Batch and paper restrictions may narrow a grant further; omitted dimensions mean all descendants within that tuple, and the administrator must see that consequence before saving.

If a user has Accounting in Branch A and Law in Branch B, they must not gain Law in Branch A or Accounting in Branch B. Authorization applies to the full record context. An upload-only grant can inspect its own staged content but does not imply access to existing published results.

### 8.2 Actions and suggested roles

Action catalog: dashboard view; student minimal lookup; student manage; marksheet view/upload/edit-draft/submit/publish/correct/withdraw; import create-scope; progress-card view; PDF/XLSX export; catalog correct/manage; user manage; role/grant manage; audit view; backup/restore administration. Marksheet upload includes creating required missing details and minimal students/enrollments inside the user's authorized scope. Import create-scope allows creating a missing scope boundary under an authorized parent, such as a new branch under the institute or a new subject under a course; it does not grant role administration.

| Suggested role | Default capabilities; scope always assigned separately |
|---|---|
| Institute admin | Import with automatic creation across the institute, including new branches; correct catalog/students and manage grants subject to protected administrator rules. |
| Branch admin | Import and automatically create missing details within assigned branches; correct imported records and access results/reports; may delegate only permitted scope if expressly granted. |
| Academic coordinator | Import, review, publish and corrections within assigned academic scope. |
| Teacher/uploader | View, upload with automatic creation of required descendants/minimal students, edit drafts and submit within assigned subjects; publication/export separately granted. |
| Viewer | Read authorized academic views and cards; export separately granted. |

Custom roles must be supported. Role names do not bypass record-level checks.

### 8.3 Administration and enforcement

- **ACL-01:** Invite/create users, activate/deactivate accounts, reset access credentials, assign/revoke roles and scoped grants, and inspect effective permissions with an administrator preview.
- **ACL-02:** Enforce authorization in FastAPI for every query, mutation, upload context, source-file download, report and job execution. React hides unavailable actions for clarity but is not the security authority.
- **ACL-03:** Reject unauthorized sheets before importing their results; mixed-scope workbooks require explicit exclusion of inaccessible sheets. Recheck permissions at commit/publication and export download time.
- **ACL-04:** Revoke active access promptly on deactivation or grant changes, including existing sessions, queued jobs and cached reports. Proposed maximum online revocation delay: one minute.
- **ACL-05:** Users cannot grant powers or scope they cannot delegate, elevate themselves, or remove the last active institute administrator. Technical system administration and academic authorization remain distinct.
- **ACL-06:** Audit account, role and grant changes with actor, time, before/after and affected scope. Audit records are visible only with audit permission.
- **ACL-07:** Student lookup exposes only the identity fields needed to resolve eligible students; subject access does not imply unrestricted student directory access.
- **ACL-08:** Automatic creation never expands the uploader's scope. An institute-level creation grant can create a branch; a branch-level grant can create details beneath that branch where allowed. A teacher restricted to an existing branch/course/subject cannot create a sibling branch/course/subject through upload. Newly created descendants inherit the applicable parent-scoped grant; creating a record never adds new grants. If required creation is outside scope, show the specific permission issue and allow the import to be resumed by an authorized user.

## 9. Application experience

Primary navigation: Overview; Import Marklist; Marksheets; Progress Cards; Academic Views; Students; Users and Access; Audit; Settings. Import Marklist is the primary academic intake action and the empty-state starting point. Imported structure/assessments are browsable from academic views with authorized corrections; users are not sent through separate setup or roster screens before importing. Navigation is permission-aware.

The import wizard follows select known levels/upload → automatic detection and create/reuse plan → resolve exceptions → preview → import/submit. Whole-workbook defaults and per-sheet overrides share the same dependent context selectors. Unambiguous files proceed without individual academic/student creation forms. Reviewers publish from a separate review screen. A marksheet page exposes its source, state, validation summary and revision history. Filters show academic context in plain language. Errors explain how to resolve the issue while preserving selected levels and mappings.

Desktop and browser interfaces use the same React experience and API contracts. The browser experience is the client for phones, iPads, and tablets on the host network, and it must be usable at those sizes. Support keyboard navigation, readable contrast, clear focus and printable cards. Proposed baseline: WCAG 2.2 AA as a delivery target, with validation during acceptance.

## 10. Platform and deployment requirements

### 10.1 Required architecture

| Layer | Product requirement |
|---|---|
| React frontend | Shared web and desktop interface; stable routing; permission-aware screens; API-backed data and import status. Layouts work on phone, iPad, tablet, and desktop. |
| FastAPI backend | Sole authority for identity, ACLs, academic rules, validation, publication, revisions, reports and job state. Versioned API contract. |
| MongoDB | Store canonical entities, results, grants, provenance and audit records. Support uniqueness, consistent publication and recoverable migrations. Avoid unbounded result arrays in one document. |
| Private file storage | Original imports and generated reports, linked to records and protected by ACLs; local storage in full installation, managed private storage in cloud. |
| Background processing | Durable imports, report generation and recalculation, with retry, deduplication and observable failures in both local and cloud modes. |
| Desktop shell | Package React for Windows/macOS. Shell selection is an engineering decision following a packaging spike; no direct client access to MongoDB. |

This is a logical architecture, not a prescribed database schema or vendor selection. Any MongoDB deployment must provide the consistency guarantees required for atomic publication and revisions; engineering must validate the chosen transaction/deployment configuration.

### 10.2 Deployment modes included in release 1

| Mode | Installed components | Data authority and connectivity |
|---|---|---|
| Cloud with browser | Hosted React, FastAPI, MongoDB and job/file services | Cloud is authoritative; online connection required. |
| Desktop client | React desktop app and endpoint configuration only | Client-only installation for other computers. Connects over the network to the full installation, or later to cloud. No bundled backend or database. |
| Full desktop application | Desktop app plus managed FastAPI, MongoDB, file storage and job runtime | Local server is authoritative; works without internet on the host after setup. The first site installs this on one computer. Other computers use the client-only installation. Phones, iPads, and tablets use the browser. All of them connect over the network. |

Full installation and cloud are alternative authorities for a deployment. Release 1 does not synchronize writes between them. Moving an institute between deployment modes requires controlled backup/export, migration, reconciliation and cutover; installing a desktop client does not copy the database.

### 10.3 Installer and runtime acceptance

- **PLT-01:** Deliver Windows and macOS installers for both full and client variants, with unmistakable labels. Proposed supported targets: Windows 11 x64 and macOS Apple Silicon plus Intel where dependency compatibility is validated; finalize versions/architectures in the packaging milestone.
- **PLT-02:** Installation manages prerequisites, backend/database processes, startup, port conflicts, logs and diagnostics. Startup shows backend/database health and actionable errors.
- **PLT-03:** Full mode supports offline login and all core academic workflows using locally managed accounts. Cloud-only identity providers cannot be its sole authentication dependency.
- **PLT-04:** Client mode supports authenticated endpoint configuration and verifies server compatibility. A system client-only installation connects over the network to the full installation. Connection failure shows service status and prevents false success; offline writes are deferred from release 1.
- **PLT-05:** The first site enables network access so other computers, phones, iPads, and tablets can connect to the one full installation. Other computers use the client-only installer. Phones, iPads, and tablets use the browser. Access uses protected credentials and encrypted authenticated traffic. Only the designated server hosts the database.
- **PLT-06:** Sign Windows installers and sign/notarize macOS distribution. Verify redistribution/licensing of bundled dependencies before release.
- **PLT-07:** Upgrade preserves data, grants and file provenance; creates a verified pre-migration backup and provides a documented recovery path. Client/server incompatibility receives an actionable message.
- **PLT-08:** Uninstall retains institution data by default; data removal requires a separate explicit choice. Backup/restore is accessible to authorized operators with clear destination, progress and outcomes.
- **PLT-09:** Cloud deployment includes TLS, secrets management, private database connectivity, environment separation, health checks, monitoring, persistent job processing and scheduled backup/restore validation. Hosting provider and region are decisions, not assumptions.

## 11. Non-functional requirements and proposed targets

Targets below define initial acceptance scenarios, not promised capacity; confirm them against expected institute size and representative infrastructure.

| Area | Release-1 requirement / proposed target |
|---|---|
| Performance | Standard filtered views p95 ≤2 seconds, excluding network transfer, on an agreed dataset of 10 branches, 10,000 students and 1 million results; paginate detail. |
| Import | Support at least 50 sheets and 20,000 result rows per workbook, up to a proposed 25 MB limit; finish normal parsing/validation within 2 minutes on agreed reference hardware, with async status for larger jobs. |
| Consistency | No partial published marksheet; retries never double count; cards and dashboards use the same active result revision and policy. Show pending recalculation explicitly. |
| Availability | Proposed cloud service target 99.5% monthly, subject to chosen hosting; local operation depends on the server host being running. |
| Recovery | Proposed cloud RPO ≤24 hours and RTO ≤4 hours; full mode offers daily scheduled backups to a configurable destination and tested restore. Confirm local recovery targets separately. |
| Authentication | Secure passwords/session handling, login rate controls and administrator MFA for cloud access; define equivalent local account recovery during packaging discovery. |
| Privacy | Minimize student personal data, encrypt transport and backups, keep imported files private, avoid marks/credentials in operational logs. Decide retention and hosting location with the institution. |
| Audit | Record imports, mappings, publications, score changes, exports and permission changes with actor/time/context. Application users cannot alter historical audit events. |
| Accessibility | Keyboard-operable workflows, chart alternatives, visible status labels and screen-reader-friendly forms. |
| Operations | Diagnose failed imports, job backlog, report failures and service/database health; document cloud and local operator recovery. |
| Compatibility | Verify the agreed browser matrix, Windows targets, macOS architectures and printer/PDF output on release builds. |

## 12. Acceptance scenarios and release gates

| ID | Scenario and required outcome |
|---|---|
| AT-01 | Start with an institute and users but an empty academic catalog; import all four sample workbooks. Discover 29 sheets and automatically create all resolved academic details, students and enrollments without separate setup/roster steps. Retain source files and exclude legends/footer text; no worksheet is silently lost. |
| AT-02 | Import mixed Economics/QT sheets: require batch assignment per eligible student, preserve combined assessment identity and avoid duplicate rollups. |
| AT-03 | Import QT `RATIO JAN-27`: display conflict with September heading and block publication until batch context is confirmed. |
| AT-04 | Import QT `CHAPTER -2 -2`: discover both maxima, require interpretation, preserve both groups and flag overlap with existing chapter results. |
| AT-05 | Enter A, AB, blank and numeric zero: obtain absent, absent, missing and scored-zero respectively; no false zero percentages from workbook formulas. |
| AT-06 | Import a new name: automatically create a student with generated ID and enrollment. Import it again in the same context: reuse the unique exact match. Ambiguous/variant names require resolution; prevent accidental merging across batches/branches. |
| AT-07 | Publish then correct a mark: every authorized card/dashboard/export uses the new revision; previous value, actor and reason remain auditable. |
| AT-08 | Upload the same file twice and retry an interrupted job: no duplicate published results or partial marksheets. |
| AT-09 | Grant Accounting upload/view only in Tirur/CA Foundation: allow that context, deny other subjects/branches/courses and publication/export; direct API requests also deny access. |
| AT-10 | Assign two disjoint branch/subject tuples: confirm no unintended cross-combination access through lists, totals, source files, cards or exports. |
| AT-11 | Revoke a user while a report is queued: deny subsequent protected access/download within the revocation target. |
| AT-12 | Verify 40%, 60%, tied exact scores, inconsistent source ranks, weighted percentages, missing coverage and different-maximum retests against the confirmed policy. |
| AT-13 | Navigate each of institute, branch, course, batch, subject and paper views: retain filters, reconcile visible totals to contributing authorized results and show empty-data states. |
| AT-14 | Generate single and batch PDF progress cards: readable multipage output, explicit period/scope/revision and no hidden subjects. |
| AT-15 | Clean-install all four desktop variants on agreed OS/architecture targets; run full mode offline and client mode against local/cloud servers. |
| AT-16 | Upgrade a populated full installation, recover a failed migration using backup, and restore cloud backup; reconcile student/result counts and permissions. |
| AT-17 | Select branch/course/batch/subject/paper levels together, including new values; commit creates only missing entities. Assign different sheet contexts and acknowledge conflicting headings. Multiple batches never duplicate each student's mark into all batches. |
| AT-18 | Cancel preview or fail a sheet during commit: leave no unused new entities, enrollments or partial marks. Concurrent identical imports create one canonical set of matching records. |
| AT-19 | A scoped teacher import creates permitted assessment/paper descendants and new minimal students but cannot create another branch/course/subject. Institute admin can import a new branch without pre-creating it. |
| AT-20 | Import a list without a complete roster: show listed students and missing marks, suppress unsupported full-batch participation, and do not classify omitted names as absent. |

Release gates: product confirms policy decisions; academic owner approves reconciled sample imports and cards; security/QA approves scoped ACL scenarios; operations approves installers, upgrades and restore; performance targets are validated or explicitly renegotiated before launch.

## 13. Delivery plan

All milestones contribute to the first release. Desktop and cloud validation start early because they affect authentication, storage, job processing and operations.

| Milestone | Deliverable | Exit criteria / dependencies |
|---|---|---|
| M0 — Product discovery | Approved terminology, enrollment/identity rules, calculation policy, deployment choices and card layout; clickable workflow designs | Resolve blocking decisions listed below; agree acceptance dataset and rollout owners. |
| M1 — Platform feasibility and contracts | React/FastAPI/MongoDB architectural plan and API contracts; desktop full/client packaging feasibility on both OS families; local/cloud identity and file/job design | Demonstrate feasibility of bundled services, signing and offline operation; establish backup and migration strategy before feature build. |
| M2 — Foundation and authorization | Import-created academic/student model, matching rules, authentication, role/action catalog, scoped creation grants and audit foundation | Prove tuple-scoped creation/access and historical enrollment behavior with direct API checks. |
| M3 — Marksheet vertical slice | Multiple-level selection, automatic create/reuse import, exception resolution, review/publication/revision and duplicate handling | Import all 29 reference worksheets into an empty academic catalog without prerequisite setup; reconcile results with no silent ambiguity or double counting. |
| M4 — Progress and academic views | Progress cards, metrics, six views, filters, print/PDF/XLSX exports | Confirm calculation examples, permission-filtered aggregates and representative card output. |
| M5 — Distribution and operations | Signed Windows/macOS full/client installers; staged cloud deployment; monitored jobs, backup/restore and upgrade support | Pass clean-install, offline/LAN/client, cloud, failure-recovery and compatibility scenarios. |
| M6 — Pilot and release | One-branch pilot followed by multi-branch rollout, operator/user guides and production release | Academic reconciliation and user acceptance; restore drill; agreed performance and access tests; institute launch approval. |

Effort estimates and calendar dates follow M0/M1. Suggested accountable functions: product owner for scope/policies; academic owner for roster and result reconciliation; design/frontend/backend leads for implementation; QA/security for acceptance; operations/release owner for installers and cloud. These may be combined in a small team, but each responsibility needs an owner.

## 14. Measurement and rollout

Capture import completion time, proportion of rows requiring manual resolution, duplicate/conflict rate, failed publication count, report-generation time, active staff use and progress-card coverage. Proposed pilot success: all supplied samples reconciled; no known unauthorized disclosure or duplicate result; every eligible pilot student has an accurate card with explicit missing-data coverage; users complete the upload-to-publication journey without engineering assistance after onboarding.

Pilot preparation: bootstrap the institute, set policies, allocate roles and back up source marklists. Import into an empty academic catalog, review automatically created details/students, and resolve only ambiguous identities or context. Authoritative IDs/rosters, when available, improve reconciliation and coverage but are not prerequisites. Run one branch in parallel with its current spreadsheets for a complete assessment cycle, reconcile cards, then expand to another branch to validate automatic reuse, cross-branch permissions and comparisons. Production cloud publication and institution rollout require the designated launch owner's approval.

## 15. Risks and decisions before implementation

| Decision / risk | Proposed default or action | Owner / required by |
|---|---|---|
| Subject vs paper terminology | Paper is a numbered assessed unit under a subject; confirm how Accounting, Law, QT and Economics map. | Academic owner / M0 |
| Stable student identity and aliases | Automatically generate institute-wide IDs for new imported students; reuse unique exact contextual matches. Resolve ambiguous candidates inline; authoritative roster optional. Name-only imports cannot prove identity across enrollment contexts. | Academic operations / M0 |
| Mixed batch ownership | Use selected levels, source row labels or known enrollments; ask inline where assignment is indeterminate. Create missing batches/enrollments automatically and keep one shared assessment where appropriate. | Academic owner / M0 |
| Multiple selected levels | Baseline interpretation: select multiple hierarchy dimensions with workbook defaults and per-sheet/group overrides. Multiple cohorts require per-row enrollment resolution and never Cartesian duplication. | Product owner / M0 |
| Second QT score group | Clarify separate exam, retest or component; importer must not guess. | Academic owner / M0 |
| Ranking and grade policy | Exact-score dense rank; sample risk bands; separate official passing threshold. | Academic owner / M0 |
| Retest and aggregation rules | Latest attempt, weighted maxima and explicit coverage; confirm exemptions/negative scoring and component rules. Negative scores blocked unless a later confirmed scoring policy allows them. | Academic owner / M0 |
| Publishing workflow | Separate upload/publish by default; determine whether self-publishing is permitted. | Institute admin / M0 |
| Full app server topology | First site: one full installation. Other computers connect with the client-only installer. Phones, iPads, and tablets connect in the browser. All clients use the network. | Product/operations / M0 |
| Local/cloud data portability | Controlled migration only in release 1; bidirectional sync is deferred. | Product owner / M0 |
| Desktop frameworks and OS matrix | Choose after packaging spike; validate MongoDB/backend distribution, licensing, privileges and process lifecycle. | Engineering/release / M1 |
| Cloud provider, region and budget | Select using expected scale, backup needs and institution data requirements. | Institution/operations / M1 |
| Data retention and recovery | Confirm raw-file/audit retention, backup location, administrator recovery and acceptable RPO/RTO. | Institution/operations / M1 |
| External access | Staff accounts only initially; confirm whether student/parent portals are needed later. | Product owner / M0 |
| Number of independent institutes | One institute per deployment initially, with explicit ownership boundaries; hosted multi-tenant SaaS needs separate scope approval. | Product owner / M0 |

These decisions were approved in [m0-decisions.md](m0-decisions.md) on 7 October 2026. That record supersedes this table where they differ. Approval of the baseline does not authorize application implementation. The remaining gate is the cloud provider, region, and budget, owned by Operations before cloud provisioning.
