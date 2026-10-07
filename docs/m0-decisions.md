# M0 — Approved product decisions and workflow design

Date: 7 October 2026 · Status: Approved baseline for release-1 planning · Supersedes the proposed defaults in [Product requirements v1.1](product-requirements.md) where they differ

This document closes milestone M0. It does not authorize application implementation. M1 may start from these decisions. Cloud provisioning stays gated on the provider and budget item in DEC-06.

Owners below are responsibilities. No person is named because the team has not assigned names. The product owner directing this repository approved this baseline on 7 October 2026.

| Responsibility | Owns |
|---|---|
| Product owner | Scope, selected-level behavior, and this baseline |
| Academic owner | Terminology, sample-sheet resolutions, and calculation policy recorded here |
| Design | Import, reporting, and administration workflows in UX-01 and UX-02 |
| Release owner | Installer signing and notarization |
| Operations owner | Local recovery, hosting selection, backups, and the cloud provider gate |

Acceptance dataset: the four workbooks in `sample-import-files/` (29 worksheets). Expected context for every sheet is in DEC-04.

## DEC-01 — Academic terminology

Approved. Sample paper headings create one subject and one numbered paper together. They do not create a separate subject hierarchy.

| Entity | Approved meaning | Sample mapping |
|---|---|---|
| Institute | Root owner of every record. One institute per deployment. | **IAM**. The workbooks never name a parent above the branch. |
| Branch | A location of the institute. | **IAM Tirur**, from the heading `IAM TIRUR`. |
| Course | A program shared across branches. | **CA Foundation**. |
| Branch offering | The link between IAM Tirur and CA Foundation. | Created on first import. |
| Batch | A cohort for a target exam session. The session is not an assessment date. | **September 2026** and **January 2027** only. A heading that names both is two batches on one assessment, not a third batch. |
| Subject | A curriculum area of the course. | Accounting, Business Law, QT, Economics. |
| Paper | The numbered assessed unit under that subject. Every assessment has both. | Papers 1–4, parsed from the same heading line as the subject. |
| Exam type | Unit, Part, or Chapter. | Parsed from the title row. The typo `EAXAM` is still Unit. |
| Format | MCQ or descriptive. | MCQ only when the title contains `MCQ`. Otherwise descriptive. Format is not an exam type. |
| Series | Optional metadata. | **Test series** on every sample sheet. |
| Assessment | One exam occurrence: title, type, format, paper, maximum, eligible batches, and date. | The title row plus the `MARK(maximum)` header. |
| Attempt | Original, or a retest linked to an original. A retest may use a different maximum. | Only a title containing `Re test` or `Retest` creates a retest. |
| Topic | Optional metadata. | Journal, BRS, SOGA, Ratio, and similar words in the title. Not a catalog level. |
| Student | Stable institute ID plus display name. | Created from the name column. See DEC-03. |
| Enrollment | One student in one branch, course, and batch. | Each result resolves to exactly one enrollment. |

Approved subject and paper map:

| Heading | Subject | Paper |
|---|---|---|
| `PAPER 1 - ACCOUNTING` | Accounting | 1 |
| `PAPER -2 - BUSINESS LAW` | Business Law | 2 |
| `PAPER -3 - QT` | QT | 3 |
| `PAPER 4 - ECONOMICS` | Economics | 4 |

Display names stay as printed. QT is not renamed to Quantitative Aptitude, and Economics is not renamed to Business Economics. Those official names may be added later as aliases.

Assessment identity is institute + branch + course + subject + paper + exam type + normalized title + maximum + eligible batches. The same title in two batches is not automatically one assessment (DEC-04). A repeated part number does not merge assessments when the topic differs: Law `PART EXAM -4 - SOGA` and `PART EXAM -4 -PARTNERSHIP ACT` are different assessments, and the duplicate number is a warning.

## DEC-02 — Selected levels

Approved. “Multiple selected levels” means several hierarchy dimensions at once, with a workbook default and optional per-sheet or per-score-group overrides. Each dimension is **existing**, **new**, or **detect**. The institute is always the active workspace. A workbook cannot create or switch institutes.

Selected context wins over a conflicting heading after the user acknowledges the conflict. Acknowledgement is recorded on the import job. The importer does not silently rewrite a heading into another batch.

Selecting two batches marks both batches eligible. It does not copy a mark into every selected batch. Each result row resolves to one enrollment.

### Example A — empty catalog, one clear sheet

Import Accounting `BRS` with every level set to detect. The plan creates IAM Tirur, CA Foundation, the Tirur offering, batch September 2026, subject Accounting, paper 1, exam type Unit, the BRS assessment at maximum 20, attempt original, and one student plus enrollment per listed name. Exam date 6 June 2026 is taken from the sheet (Excel serial 46179). Commit is one approval. No setup screen and no per-student form.

### Example B — different contexts in one workbook

`LAW .xlsx` contains September sheets (`IRF MCQ`, `IRF`) and January sheets (`COMPANIES ACT`, `SOGA`, `IRF`, `PARTNER SHIP ACT`). Workbook default may detect. Each sheet keeps its own batch from its heading. September IRF chapter and September IRF MCQ stay two assessments because the format differs. January Part Exam 1 IRF is not a retest of the September chapter.

### Example C — mixed batches, no duplicated marks

Economics `MIXED EXAM` is eligible for September 2026 and January 2027. One assessment is created. Each student row is attached to one of those two enrollments. A mark is never written to both batches. Combined rank describes the mixed list. Per-batch rank is labeled separately. Branch and course totals count each result once.

On a later file, known students with exactly one enrollment inside the eligible batches reuse that enrollment. Everyone else is resolved in the import preview with a bulk action (“assign selected rows to September 2026” or “to January 2027”) and per-row overrides.

## DEC-03 — Student identity

Approved. There is no roster upload and no separate student-creation permission. Import permission inside the user’s scope is enough to create a minimal student and enrollment.

ID format: `IAM-` plus six digits, starting at `IAM-000001`. Allocated once, at the commit that creates the student, in workbook order, then sheet order, then row order. Retries and concurrent identical imports reuse the same ID. Display name preserves the first-seen spelling. Matching ignores surrounding whitespace, repeated internal spaces, and case. `MOHD SAEED` with a trailing double space matches `MOHD SAEED`.

| Case | Outcome |
|---|---|
| New normalized name in the resolved branch, course, and batch | Create a student and an enrollment. |
| Same normalized name again in that same enrollment context | Reuse the student and enrollment. |
| Same normalized name in a different batch or branch | Create a different student. Do not merge. |
| Two existing students match one row | Block that row until the user chooses one or creates another. |
| Same name twice on one sheet for one score group | Block those rows as duplicate source rows. |
| Supplied student ID, when a future file has one | ID match wins over name. Conflicting IDs block the row. |
| Suspected variant | Show a suggestion. Default is keep distinct. Merge is a separate explicit action. |

Variants in the acceptance files are suggestions only. They must not auto-merge:

| Keep distinct unless a user merges them | Why |
|---|---|
| `SHIFA` and `SHIFA SCI` | Both occur as separate names. |
| `ZAID AHAMMED` and `ZAID AHAMMED FAZIL` | One name is a longer form, not an exact match. |
| `SHIFAN` and `MOHD SHIFAN` | `SHIFAN` appears once, on Law `SOGA`. |

A merge needs elevated permission, an impact preview, and an audit record. An approved alias then matches inside that same enrollment context only.

## DEC-04 — Sample sheet resolutions

Approved expected outcomes for academic reconciliation. Legend rows (`MORE THAN 60%`, `BETWEEN 40% TO 60%`, `LESS THAN 40%`, and the SAFE / FIFTY-FIFTY / DANGER labels) and the footer slogan are not students. Cached percentages, cached ranks, and `#VALUE!` formula results are ignored. Blank mark cells are missing even when the percentage cache is 0. There is no numeric zero in these files. `A` and `AB` are absent.

Exam dates: only Accounting `BRS` has one, **6 June 2026**. Every other assessment can be saved as a draft without a date. Publication requires a date entered on the import preview or the review screen. The batch month is never copied into the exam date.

### Accounting — `ACCOUNTANCY  RANK LIST.xlsx`

Branch IAM Tirur, course CA Foundation, batch September 2026, subject Accounting, paper 1, series Test series.

| Sheet | Assessment | Maximum | Attempt | Notes |
|---|---|---:|---|---|
| Sheet1 | Unit Exam 1 — Journal, Accounting Equations | 30 | Original | |
| Sheet1 (2) | Same assessment as Sheet1 | 20 | Retest | Title contains `(Re test)`. Blanks stay missing. |
| Sheet1 (3) | Unit Exam 2 — Bill of Exchange | 25 | Original | Source ranks disagree with exact scores; recompute. |
| Sheet1 (4) | Unit Exam 3 — Rectification of Errors | 20 | Original | `SHIFA` is AB. |
| BRS | Unit Exam 4 — BRS | 20 | Original | Date 6 June 2026. `SANEEHA VM` and `MOHD SALMAN` are A. |
| Sheet1 (5) | Part Exam 1 — BRS, Bill, Errors, Final A/C | 45 | Original | `JISLA` and `SHIFA` are AB. |
| DEPRECIATION | Unit Exam 5 — Depreciation | 20 | Original | |
| INCOMPLETE | Unit Exam 6 — Incomplete Records | 12 | Original | |

### Economics — `ECONOMICS  RANK LIST -.xlsx`

Subject Economics, paper 4, series Test series, branch IAM Tirur, course CA Foundation.

| Sheet | Batches | Assessment | Maximum | Notes |
|---|---|---|---:|---|
| Sheet1 | September 2026 | Unit Exam 1 — Consumer Behaviour | 29 | Quarter marks are real scores. |
| Sheet1 (3) | September 2026 | Unit Exam 2 — Production | 30 | |
| MIXED EXAM | September 2026 and January 2027 | Unit Exam 3 — Business Cycle | 25 | One shared assessment. Per-row enrollment. `SHIFA`, `ARJUN A`, and `ZAID AHAMMED FAZIL` are AB. |
| MIXED EXAM (2) | September 2026 and January 2027 | Unit Exam 4 — National Income | 30 | `SHIFA` is AB. Source ranks recomputed. |
| MIXED EXAM (3) | September 2026 and January 2027 | Unit Exam 5 — Keynesian Theory | 40 | Source ranks recomputed. |

### Law — `LAW .xlsx`

Subject Business Law, paper 2, series Test series.

| Sheet | Batch | Assessment | Format | Maximum | Notes |
|---|---|---|---|---:|---|
| IRF MCQ | September 2026 | Chapter 1 — IRF | MCQ | 30 | Distinct from the descriptive chapter. |
| IRF (trailing space) | September 2026 | Chapter 1 — IRF | Descriptive | 30 | |
| COMPANIES ACT | January 2027 | Part Exam 3 — Companies Act | Descriptive | 30 | |
| SOGA | January 2027 | Part Exam 4 — SOGA | Descriptive | 30 | Not merged with Partnership Act. |
| IRF | January 2027 | Part Exam 1 — IRF | Descriptive | 30 | Not a retest of the September chapter. |
| PARTNER SHIP ACT | January 2027 | Part Exam 4 — Partnership Act | Descriptive | 30 | Same part number as SOGA, different assessment. Warning only. |

### QT — `QT.xlsx`

Subject QT, paper 3, series Test series. Titles that say `EAXAM` are exam type Unit, and the source spelling is kept until the user accepts the suggested title `Unit Exam`.

| Sheet | Resolution |
|---|---|
| RATIO- SEPT -26 | Batch September 2026. Assessment Unit Exam 1 — Ratio, maximum 20. The cached percentages are wrong (18/20 is stored as 60%, which is 18/30). Recompute percentage and dense rank. Do not treat this as maximum 30. |
| RATIO JAN-27 | **Conflict.** Sheet name says January 2027; heading says September 2026; title matches the September ratio sheet. Expected resolution: acknowledge the heading as a copy-paste error and use batch **January 2027**. This is a second assessment with the same title and maximum, eligible only for January 2027. It is not the same cohort as the September sheet and is not automatically comparable. Publication stays blocked until the conflict is acknowledged. |
| PROPORTION JAN-27 (2) | **Conflict of the same kind.** Expected batch is **January 2027**. There is no September proportion sheet. `(2)` in the sheet name is not a second score group. One score group, maximum 10. |
| INDICES SEPT & JAN-27 | One assessment, Unit Exam 3 — Indices, maximum 15, eligible for both batches. Per-row enrollment. No Cartesian copy. |
| LOGARITHAM SEPT & JAN-27) | One assessment, Unit Exam 4 — Logarithm, maximum 20, both batches. Source spelling Logaritham is preserved. |
| MCT - STATI | One assessment, Part Exam 1 — MCT, maximum 30, both batches. |
| PART -2 STATI | One assessment, Part Exam 2 — Theoretical Distribution, maximum 50, both batches. Source spelling Theoratical is preserved. |
| CHAPTER -2 | Batch January 2027. Assessment Part Exam 2 — Chapter 2, maximum **25**. This is the canonical 25-mark result. |
| CHAPTER -2 -2 | Same heading and the same 25-mark scores as `CHAPTER -2`, plus a second group `MARK(20)`. **Expected interpretation:** the 25-mark group is a duplicate of `CHAPTER -2` and must be skipped or, if values ever differed, offered as an authorized revision. It must not create a second 25-mark result. The 20-mark group is a **separate assessment**, not a retest and not a component. Suggested title: Part Exam 2 — Chapter 2 (20 marks), maximum 20, batch January 2027. Evidence: high scorers on the 25-mark paper also have 20-mark scores, two students (`SHIBILIYA`, `JIFNA`) appear only on the 20-mark group, and several 20-mark cells are blank with a cached percentage of 0. Those blanks are missing. Overlap with `CHAPTER -2` is a visible warning. The importer does not guess this; the preview requires the user to confirm “separate assessment” before commit. This document is that expected confirmation for acceptance. |
| CHAPTER -3 | Batch January 2027. Part Exam 2 — Chapter 3, maximum 10. The shared “Part Exam 2” number does not merge it with Chapter 2. |

## DEC-05 — Calculations and publication

Approved. Policies are versioned. Release 1 starts on policy version 1 with the rules below. Risk bands are not pass/fail.

| Rule | Approved behavior |
|---|---|
| Percentage | Obtained ÷ maximum × 100 for numeric scores, including quarter and half marks. Display two decimal places. Do not round before ranking or aggregation. |
| Bands | Danger below 40%. Fifty-fifty from 40% through 60% inclusive. Safe above 60%. |
| Absence | `A` and `AB` are absent. No percentage and no rank. |
| Missing | A blank mark is missing. No percentage and no rank. Never stored as zero or absent. |
| Zero | A typed 0 is a real score. It ranks and affects percentages. These samples contain none. |
| Exemption | Only when a user marks the row not applicable and gives a reason. Excluded from the expected-participation denominator. Import does not infer exemptions. |
| Ranking | Dense rank on the exact score inside one assessment, attempt, and declared cohort: 1, 1, 2. Higher score ranks first. Source ranks are stored for comparison and are not canonical. Mixed cohorts show a combined rank and a per-batch rank, both labeled. |
| Retest rollup | The latest published attempt by exam date is the selected attempt. Original and later attempts stay visible. Best-score is not the default. Compare percentages when maxima differ. |
| Aggregate | Sum of obtained scores ÷ sum of maxima × 100, labeled maximum-marks-weighted. Missing and absent results are excluded and counted in coverage. Do not average displayed percentages. |
| Components | A component total is included only under an explicit component policy. Parent and component cannot both enter the same rollup. The QT 20-mark and 25-mark groups are not components. |
| Participation | Scored eligible results ÷ expected eligible opportunities, and only after a confirmed roster snapshot. Until then, counts are labeled “students listed in imported marklists” and full-batch participation is hidden. A name omitted from a sheet is not absent. |
| Pass rate | Hidden until the institute sets a passing threshold. The threshold is separate from the risk bands. No threshold is set in this baseline. |
| Negative scores | Blocked. |
| Self-publication | Off. Upload and publish are different permissions. |
| Drafts | Do not affect cards or academic views. |
| Publication blockers | Missing exam date, unacknowledged heading conflict, unconfirmed score-group interpretation, unresolved duplicate or ambiguous identity rows, and any score outside 0 through maximum. |

Worked checks:

| Input | Required result |
|---|---|
| 15/20 and 10/25 combined | 25/45 = 55.56%. The mean of the percentages, 57.5%, is not the aggregate. |
| 40% and 60% | 40% is fifty-fifty. 60% is fifty-fifty. 39.99% is danger. 60.01% is safe. |
| Two students on 18/20 | Dense ranks 1 and 1. The next distinct score is rank 2. |
| Accounting Unit Exam 1, 29/30, and its retest, 16.5/20 | Both remain visible. Rollup uses the later dated attempt and compares percentages (96.67% and 82.50%). |
| `RATIO- SEPT -26`, Shahada K, 18 with cached 60% and rank 1 | Canonical percentage is 90.00%. Rank is recomputed from scores. |
| Blank cell whose formula shows 0% | Missing. Coverage changes. The score is not 0. |
| `A` or `AB` whose formula shows `#VALUE!` | Absent. The error text is discarded. |
| A third result absent or missing beside 15/20 and 10/25 | Aggregate stays 25/45. Coverage shows the gap. |

Workflow states are draft, then submitted, then published. Rejection returns a marksheet to draft. A published correction or withdrawal needs a reason. One active published revision feeds cards, views, and exports. Concurrent edit conflicts warn and do not silently overwrite.

## DEC-06 — Deployment and operating targets

Approved, with one gate. These are acceptance targets for the agreed dataset, not a capacity promise beyond it.

| Topic | Decision |
|---|---|
| First site | One computer receives the full installation and is the only database. Every other computer uses the client-only installer and connects to that host over the network. Phones, iPads, and tablets connect in the browser on the same network. No other machine installs the server. |
| Local topology | Two client paths, both aimed at the one host: a Windows or macOS client-only installation, and a phone, iPad, or tablet browser. Clients never hold the database. |
| Network access | Required for every client, including a system client-only installation. Traffic is authenticated and encrypted. The host remains usable on the machine itself when the network is down. Clients need the network to reach the host. |
| Offline | Full mode on the host supports offline login and the core academic workflow. A client-only installation and a mobile browser have no offline writes. |
| Local and cloud | Alternative authorities. Release 1 does not sync writes. Moving an institute is a controlled backup, migrate, reconcile, and cutover. |
| Windows | Windows 11, 64-bit. |
| macOS | Apple Silicon and Intel, macOS 14 and later, on architectures the packaging spike proves. |
| Browsers | Current Chrome, Edge, Safari, and Firefox at acceptance time, including Safari on iPhone and iPad and Chrome on Android phones and tablets. |
| Screens | Phone, iPad, tablet, and desktop layouts share the same routes, data, and permissions. Check a phone width, an iPad or tablet width in portrait and landscape, and a desktop width. Tables may scroll sideways. Primary actions, navigation, filters, import review, and cards stay usable without a desktop-only layout. Native App Store or Play Store apps are not part of release 1. |
| Signing | Release owner signs Windows installers and signs and notarizes macOS builds. |
| Load dataset | 10 branches, 10,000 students, 1 million results. Filtered views p95 at or under 2 seconds excluding transfer. Imports of at least 50 sheets and 20,000 result rows, proposed file limit 25 MB, parsing and validation within 2 minutes on the reference hardware. |
| Cloud availability | 99.5% monthly, subject to the chosen host. |
| Cloud recovery | RPO at or under 24 hours. RTO at or under 4 hours. |
| Local recovery | Daily scheduled backup to a destination the operator chooses. Restore is tested. Uninstall keeps data unless a separate choice deletes it. |
| Authentication | Passwords, server sessions, login rate limits, and MFA for cloud administrators. Full mode does not depend on a cloud identity provider. Bootstrap creates one-time local recovery codes for the operator. |
| Retention | Source files, generated reports, and audit events are kept for the life of the institute in release 1. No automatic purge. Marks and credentials stay out of operational logs. |
| Accessibility | WCAG 2.2 AA is the acceptance target. |
| Revocation | Access changes take effect within one minute, including queued exports. |

**Cloud host stays undecided.** Provider, India region, and budget can wait. They remain an Operations gate before cloud provisioning. The first installation does not need them. Local architecture and the import milestones are not blocked.

## UX-01 — Import-first journey

Approved interaction design. The first academic screen in an empty institute is Import Marklist, not a setup wizard. The same screens must work in a system client-only installation and in a phone, iPad, or tablet browser when that client is connected to the host over the network.

### Screens

1. **Empty overview.** Explains that marks create the catalog. Primary action: Import Marklist. No branch, course, or student forms.
2. **Select and upload.** One workbook default with six selectors: branch, course, batch, subject, paper, exam type. Each selector offers existing, new, and detect. Detect is the default. Optional per-sheet and per-score-group overrides use the same selectors. The user can choose more than one batch. File rules and the 25 MB limit are visible before upload. Corrupt, protected, and non-XLSX files fail with a reason. The original file is stored privately.
3. **Discover.** Every sheet is listed with detected headings, row count, and score groups. Include is the default. Skip requires a reason. Nothing disappears quietly.
4. **Plan.** One table of records to create and records to reuse: branch, offering, batch, subject, paper, exam type, assessment, attempt, student, enrollment. Unambiguous rows have no extra form. Exceptions are inline on this screen:
   - Heading conflict: show sheet name, heading, and the recommended batch. The user acknowledges or overrides.
   - Mixed batch: unresolved students listed with checkboxes and the bulk assign actions from DEC-02.
   - Second score group: choices are separate assessment, retest of a named assessment, or component. The QT 20-mark group recommends separate assessment.
   - Missing exam date: one date field per assessment. Saving a draft does not require it. Publish does.
   - Variant names: suggestion with actions Keep distinct (default) and Merge.
   - Duplicate or out-of-range rows: blocking, with file, sheet, row, and column.
5. **Preview.** Canonical marks, recomputed percentage, dense rank, band, and the difference from the source rank and percentage. Totals for create, reuse, skip, and revise. Downloadable validation report. One commit button approves the whole creation plan.
6. **Commit result.** Per-sheet outcome. A failed sheet leaves no new students, enrollments, or marks from that sheet. Shared records already reused stay reused. The job can be resumed. Mappings, acknowledgements, and identity decisions remain on the job.
7. **Review.** A coordinator, not the upload step, submits and publishes. Blockers from DEC-05 are listed. Reject returns the marksheet to draft.

An unambiguous sheet such as Accounting `BRS` never opens a student form or a catalog form. The user uploads, reads the plan, and commits.

Leaving the preview, cancelling, or failing a sheet does not create orphan records. Starting the same file again recognizes the previous job and does not double results.

## UX-02 — Reporting and administration

Approved interaction design.

### Marksheet register

Filters in plain language: branch, course, batch, subject, paper, exam type, date, status. Columns include source file, uploader, reviewer, and revision. There is no “create marksheet” action. Opening a row shows source location, validation summary, revision history, and draft corrections. Published corrections ask for a reason and show the previous value.

### Progress card

Header: institute, branch, student ID, enrollment, reporting period, policy version, publication revision, generation time. Body: each authorized assessment with score, maximum, percentage, date, attempt, status, cohort rank, and band. Original and retest sit side by side. A trend is ordered by exam date. Missing and absent are separate from low scores. Threshold text is visible (“Danger is below 40%”). A subject-restricted viewer sees only allowed subjects, the card is labeled as partial, and course totals that need hidden marks are omitted. PDF and spreadsheet export are separate actions and are hidden without export permission. Batch PDF is a second action from a filtered student list.

### Six academic views

Shared chrome: persistent context filters, a readable scope summary, reset, sample size, policy label, data table beside any chart, pagination, and an empty state that says why figures are absent. Drill-down keeps the filters. Loading and error states are explicit. Pending recalculation is labeled and is not shown as a final total.

| View | Primary content |
|---|---|
| Institute | Authorized branches, distinct students, enrollments, risk mix, coverage, missing imports. |
| Branch | Courses, batches, publication status, trends, students under 40% with marks present. |
| Course | Offerings and batches, subject and paper results. Cross-branch comparison only for assessments explicitly marked comparable. |
| Batch | Listed students, subject-paper matrix, completeness, rank list, links to cards. Participation percentage hidden until a roster snapshot exists. |
| Subject | Papers, topic labels, batch and branch breakdown, missing and absent counts. |
| Paper | Assessments, attempts, exam types, student results. Retests do not add a second total. |

### Users, grants, and settings

A grant is an action bundle plus one complete scope tuple. The save step states the consequence of any omitted dimension (“all batches and papers inside this branch, course, and subject”). An effective-access preview lists what the user can and cannot open. The form refuses grants the administrator cannot delegate, self-elevation, and removal of the last active institute administrator.

Suggested roles from the requirements (institute admin, branch admin, academic coordinator, teacher/uploader, viewer) are templates. Scope is always chosen separately. Custom roles are allowed.

Settings hold policy version 1: bands, dense rank, weighted aggregate, latest-attempt rollup, self-publication off, and an empty passing threshold. Changing policy creates a new version and shows which published outputs will recalculate.

### States that must exist on these screens

- Loading.
- Empty, with the reason (no published results, filters exclude everything, or roster not confirmed).
- Error, with a next step that keeps the current filters or import mappings.
- Restricted: actions the user cannot perform are absent; direct figures never include hidden scope.

## Milestone exit

DEC-01 through DEC-06, UX-01, and UX-02 are decided in this document. The acceptance dataset is the four sample workbooks, read with the sheet table in DEC-04. Responsible roles are assigned above.

Implementation of the application is still not started. M1 architecture is recorded in [m1-architecture.md](m1-architecture.md). Cloud provider provisioning stays closed until Operations chooses a provider, region, and budget.
