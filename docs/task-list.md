# Release 1 task list

Date: 7 October 2026 · Baseline: [Product requirements v1.1](product-requirements.md) · M0: [Approved decisions](m0-decisions.md) · M1: [Architecture](m1-architecture.md)

This is a planned backlog, not authorization to implement. M0, M1, and M2 are complete. Later tasks are open. Each checkbox is a deliverable with an acceptance condition. Owner labels identify responsibilities, not assigned people. Estimates and dates follow product decisions and platform feasibility. All milestones, including desktop and cloud delivery, are required for release 1.

## M0 — Product decisions and workflow design

Dependencies: none. Owners: Product, Academic, Design, Operations.

- [x] **DEC-01 — Confirm academic terminology.** Define institute, branch, offering, course, batch, subject, paper, assessment and attempt, including how sample paper titles create subjects. **Done when:** an approved mapping includes Accounting, Law, QT and Economics. Reference: PRD §5, §15. Decision: [m0-decisions.md](m0-decisions.md) DEC-01.
- [x] **DEC-02 — Confirm selected-level behavior.** Define workbook defaults, per-sheet/score-group overrides, existing/new/detect choices and conflict acknowledgment. **Done when:** examples cover an empty catalog, different contexts in one workbook and mixed batches without duplicated marks. Reference: IMP-01/03/12. Decision: [m0-decisions.md](m0-decisions.md) DEC-02.
- [x] **DEC-03 — Confirm student identity rules.** Agree generated IDs, exact contextual reuse, aliases, ambiguous matches and cross-enrollment reconciliation. **Done when:** new, returning, same-name and variant-name cases have explicit outcomes; no roster prerequisite exists. Reference: SET-02, IMP-04/11. Decision: [m0-decisions.md](m0-decisions.md) DEC-03.
- [x] **DEC-04 — Resolve sample ambiguities.** Decide the QT second score group, conflicting batch headings, retest relationships and how users supply missing exam dates. **Done when:** academic owner records expected resolutions for affected sheets. Reference: IMP-03/05, AT-02/03/04. Decision: [m0-decisions.md](m0-decisions.md) DEC-04.
- [x] **DEC-05 — Approve calculations and publication policy.** Confirm bands, passing thresholds, dense ranks, decimal precision, weighted totals, retests, components, exemptions, coverage and self-publication policy. **Done when:** worked examples and boundary outcomes are approved. Reference: SET-04, MRK-04, PRD §7. Decision: [m0-decisions.md](m0-decisions.md) DEC-05.
- [x] **DEC-06 — Agree deployment and operating targets.** Confirm local host/LAN topology, OS/architecture/browser matrix, hosting region/budget, data retention, account recovery, load dataset and recovery targets. **Done when:** proposed targets are accepted or replaced, and signing/hosting owners are identified. Reference: PLT-01–09, PRD §11/15. Decision: [m0-decisions.md](m0-decisions.md) DEC-06. First site is one full installation. Other computers connect with the client-only installer, and phones, iPads, and tablets connect in the browser, all over the network. Cloud provider, region, and budget stay undecided until cloud provisioning.
- [x] **UX-01 — Design import-first journeys.** Prototype empty state, multiple-level selection, detection/create-reuse preview, exception resolution, commit and review. **Done when:** an unambiguous workbook needs no individual setup/student forms and failed imports retain mappings. Reference: IMP-01–12, PRD §9. Decision: [m0-decisions.md](m0-decisions.md) UX-01.
- [x] **UX-02 — Design reporting and administration.** Prototype marksheet register, review/revisions, cards, all six views, user grants and policy settings. **Done when:** academic/admin users review designs including restricted scope, loading, error and empty states. Reference: MRK-03–05, PRG-01–06, VIEW-01–04, ACL-01. Decision: [m0-decisions.md](m0-decisions.md) UX-02.

Milestone exit: met on 7 October 2026. Decisions, workflows, the 29-sheet acceptance dataset, and responsible roles are in [m0-decisions.md](m0-decisions.md).

## M1 — Architecture and platform feasibility

Dependencies: relevant DEC tasks. Owners: Frontend, Backend, Release, Operations.

- [x] **ARC-01 — Define React/FastAPI contracts.** Specify versioned endpoints, context selectors, import plan/state, errors, pagination, review, reports and effective permissions. **Done when:** frontend/backend contracts cover the designed journeys and client compatibility behavior. Reference: PRD §9/10. Decision: [m1-architecture.md](m1-architecture.md) ARC-01.
- [x] **ARC-02 — Design MongoDB model and consistency.** Define entities, ownership, contextual matching keys, indexes, revisions, eligible snapshots and atomic import/publication boundaries. **Done when:** design handles concurrency, shared entities, retries and historical enrollments without unbounded arrays. Reference: SET-01–03, IMP-08/09/11, MRK-05. Decision: [m1-architecture.md](m1-architecture.md) ARC-02.
- [x] **ARC-03 — Define authorization architecture.** Specify action plus complete scope tuples, creation beneath authorized parents, delegation and revocation. **Done when:** positive/negative examples include two disjoint grants and automatic creation without privilege expansion. Reference: ACL-01–08. Decision: [m1-architecture.md](m1-architecture.md) ARC-03.
- [x] **ARC-04 — Define file and job lifecycle.** Design private local/cloud storage, durable jobs, source provenance, cancellation, retries, export expiry and permission rechecks. **Done when:** restart/failure handling and retention are defined for both deployment modes. Reference: IMP-01/08–10, ACL-03/04, PRD §10/11. Decision: [m1-architecture.md](m1-architecture.md) ARC-04.
- [x] **ARC-05 — Validate desktop packaging feasibility.** Evaluate shell and bundle FastAPI, MongoDB and job runtime on agreed Windows/macOS targets; validate licensing, startup, privileges, port handling and signing. **Done when:** feasibility evidence and a selected approach cover full and client variants before feature assumptions are finalized. Reference: PLT-01/02/06. Decision: [m1-architecture.md](m1-architecture.md) ARC-05. Signed installers and the live packaging proof remain M5.
- [x] **ARC-06 — Define cloud/local operations.** Plan authentication in offline full mode, LAN encryption, cloud environments, migrations, backup/restore and controlled local/cloud migration. **Done when:** architecture provides one authority per deployment and recovery procedures without bidirectional sync. Reference: PLT-03–09. Decision: [m1-architecture.md](m1-architecture.md) ARC-06. Cloud provider, region, and budget stay undecided.

Milestone exit: met on 7 October 2026. Contracts, the data model, authorization, jobs, and the full/client packaging approach are in [m1-architecture.md](m1-architecture.md). The application foundation is M2. Installers remain M5.

## M2 — Application foundation, identity and access

Dependencies: ARC-01–06; corresponding DEC decisions. Owners: Frontend, Backend, QA, Operations.

- [x] **FND-01 — Establish project foundations.** Set up React, FastAPI, environment configuration, lint/build checks and CI. **Done when:** frontend/backend builds and local development instructions are reproducible. Reference: PRD §10.
- [x] **FND-02 — Implement MongoDB persistence.** Add canonical models, indexes, migration/version handling and transaction support from ARC-02. **Done when:** ownership, uniqueness and rollback guarantees are verified. Reference: SET-01–03, IMP-08/11.
- [x] **FND-03 — Bootstrap institute and accounts.** Create first administrator and institute without academic pre-entry. Implement secure login, sessions, account recovery, rate controls and cloud administrator MFA. **Done when:** cloud and offline local authentication work and no branch/student setup is required. Reference: ACL-01, PLT-03, PRD §11.
- [x] **ACL-01 — Implement roles and scope evaluation.** Add action catalog, suggested/custom roles, complete tuple grants and descendant creation checks. **Done when:** default denial and disjoint-grant isolation hold for direct API requests. Reference: PRD ACL-02/05/08, AT-09/10/19.
- [x] **ACL-02 — Build user/access administration.** Add account activation/deactivation, role/grant assignment and effective-access preview. **Done when:** administrators cannot self-elevate, over-delegate or remove the last active admin. Reference: PRD ACL-01/05.
- [x] **ACL-03 — Enforce access across services.** Apply scopes to detail, aggregates, selectors, student lookup, import commit/publication, source downloads and report jobs. **Done when:** no hidden data is exposed through counts, ranks, files or cards. Reference: PRD ACL-02/03/07/08, VIEW-03, PRG-06.
- [x] **ACL-04 — Implement revocation.** Invalidate sessions/caches and recheck queued jobs/report downloads after grants change. **Done when:** revocation meets the confirmed delay and blocks a queued export. Reference: PRD ACL-04, AT-11.
- [x] **FND-04 — Implement audit and private storage.** Store protected source files; record account/grant, import, publication, correction and export events with actor/time/context. **Done when:** application users cannot edit historical audit events and operational logs omit sensitive marks/credentials. Reference: IMP-10, PRD ACL-06/§11.
- [x] **FND-05 — Implement durable jobs.** Add persistent import/report/recalculation execution, status and retry handling in local/cloud runtimes. **Done when:** restarting a worker preserves job progress without duplicate side effects. Reference: IMP-10, PRD §10.
- [x] **FE-01 — Build shared application shell.** Add navigation, authentication, institute context, permission-aware actions and accessible status/error handling. **Done when:** browser and desktop can share the same React routes and Import Marklist is the academic empty-state action. Reference: PRD §9.

Milestone exit: met on 7 October 2026. The local app bootstraps an institute, signs in, enforces scope, writes an append-only audit, and runs durable jobs. Import parsing, cards, and installers remain later milestones.

## M3 — Excel import, automatic creation and marksheets

Dependencies: M2; DEC-01–05; UX-01. Owners: Backend, Frontend, Academic, QA.

- [x] **IMP-01 — Parse multi-sheet XLSX safely.** Detect headings, table rows, max marks, dates, statuses and repeated score groups; retain source coordinates without executing formulas. **Done when:** all 29 sample worksheets are discovered; legends, footers and unused formatting are excluded. Reference: PRD IMP-01/02/05/10, AT-01/04/05.
- [x] **IMP-02 — Build selected-level controls.** Support existing/new/detect values for branch, course, batch, subject, paper and exam type, with workbook defaults and sheet/group overrides. **Done when:** compatible parents resolve and conflicting labels require acknowledgment. Reference: PRD IMP-01/03/12, AT-03/17.
- [x] **IMP-03 — Build academic create/reuse planner.** Resolve/create branch, course, offering, batch, subject, paper, exam type, assessment, attempt and supplied series/topics. **Done when:** an empty catalog imports successfully and later files reuse exact contextual matches. Reference: SET-01, MRK-01, PRD IMP-03/11.
- [x] **IMP-04 — Build student/enrollment create/reuse planner.** Use source IDs or generate IDs; apply exact contextual name/alias reuse and expose ambiguous/variant candidates. **Done when:** new students need no roster permission/workflow and repeat imports do not create duplicates. Reference: SET-02, PRD IMP-04/11, AT-06.
- [x] **IMP-05 — Resolve mixed batches and score groups.** Assign each result to one enrollment; support separate assessment, retest or configured component interpretations. **Done when:** combined cohorts and QT dual groups preserve all marks without Cartesian duplication or double-counted components. Reference: PRD IMP-05/12, AT-02/04/17.
- [x] **IMP-06 — Validate and normalize results.** Distinguish numeric zero, missing, A/AB absence and exemption; validate ranges, context, duplicates and publication-required dates. **Done when:** actionable errors locate the source and draft/publication blockers are explicit. Reference: PRD IMP-06, MRK-01, AT-03/05.
- [x] **IMP-07 — Build import preview and exceptions UI.** Show canonical results, source differences, entity/student create-reuse totals and validation report download. Preserve mappings through fixes and retries. **Done when:** unambiguous imports require one commit approval, while exceptions are resolved inline. Reference: PRD IMP-02–07, UX-01.
- [x] **IMP-08 — Commit atomically and idempotently.** Save missing entities/enrollments and draft marksheets together; reuse shared records across sheets. Support explicit partial-sheet selection, cancellation and retry. **Done when:** failures leave no orphan records/partial marks and concurrent identical imports create one canonical set. Reference: PRD IMP-08/09/11, AT-08/18.
- [x] **IMP-09 — Add import history and resume.** Display file/sheet outcomes, skipped-sheet reasons, mappings, provenance, job progress and failures. **Done when:** users can resume interrupted work and inspect every selected/skipped sheet. Reference: PRD IMP-02/10.
- [x] **MRK-01 — Build marksheet register/detail.** Add academic/date/type/status filters, source links, uploader/reviewer and draft correction. **Done when:** only authorized marksheets appear and there is no separate manual creation flow. Reference: PRD MRK-02/03.
- [x] **MRK-02 — Implement review and publication.** Support submit, reject/return, policy-governed self-publication and atomic publish. **Done when:** unresolved blockers prevent publication and drafts never enter published metrics. Reference: PRD MRK-01/04, AT-07.
- [x] **MRK-03 — Implement revisions and withdrawal.** Require reasons, retain prior values, protect concurrent edits and trigger dependent recalculation. **Done when:** one active revision contributes and exports/cards use the same revision. Reference: PRD MRK-05, AT-07.
- [x] **CAT-01 — Browse and correct imported records.** Provide authorized catalog/student inspection, rename/archive, alias review, merge impact preview and enrollment history. **Done when:** corrections preserve historical context and referenced records cannot be silently deleted. Reference: SET-01–03.
- [x] **QA-01 — Reconcile the sample import vertical slice.** Record academic-owner expected outcomes and run AT-01–08 and AT-17–20 from an empty catalog. **Done when:** all 29 sheets reconcile after explicit exception resolution with no prerequisite setup.

Milestone exit: met on 7 October 2026. Sample workbooks import into drafts, exceptions stay on the job, publication uses one active revision, and catalog corrections archive instead of deleting. Calculations, progress-card layout, and installers remain later milestones.

## M4 — Calculations, progress cards and academic views

Dependencies: published results from M3; DEC-05; UX-02. Owners: Backend, Frontend, Academic, QA.

- [x] **CAL-01 — Implement versioned calculation policies.** Add percentage, exact-score dense ranking, bands, pass thresholds, weighted aggregation, attempt selection and component rules. **Done when:** 40/60 boundaries, 55.56% weighted example, ties and changed-max retests match approved expectations. Reference: SET-04, PRD §7, AT-12.
- [x] **CAL-02 — Implement eligibility and completeness.** Separate observed imported membership from confirmed eligible roster snapshots. Count distinct students/enrollments and statuses correctly. **Done when:** incomplete lists suppress unsupported participation and omitted students are not absent. Reference: PRD §7, AT-20.
- [x] **CAL-03 — Keep derived outputs consistent.** Refresh aggregates/cards after publication/correction/withdrawal and expose pending recalculation. **Done when:** all outputs share active revision/policy and mixed batches/components count once. Reference: MRK-05, PRD §11, AT-07.
- [x] **PRG-01 — Build student progress cards.** Add historical enrollments, filters, exam details, ranks, subject/paper summaries, chronology, retest comparisons and risk/missing-data indicators. **Done when:** authorized history reconciles to results and restricted cards contain only permitted subjects. Reference: PRD PRG-01–04/06.
- [x] **RPT-01 — Build PDF/XLSX exports.** Support individual and batch cards, authorized detail exports and print layout with period/scope/revision/policy notes. **Done when:** multipage output is readable and access is rechecked for jobs/downloads. Reference: PRG-05/06, AT-11/14.
- [x] **VIEW-01 — Build shared academic-view framework.** Add persistent context/date/type filters, drill-down, sample sizes, policy labels, tables, pagination and empty/loading states. **Done when:** navigation preserves filters and aggregate authorization matches detail. Reference: PRD VIEW-01–04.
- [x] **VIEW-02 — Build institute view.** Show authorized branch comparison, distinct students/enrollments, normalized performance, risk and coverage. **Done when:** totals reconcile without hidden branches or summed duplicate headcounts. Reference: PRD §6.5.
- [x] **VIEW-03 — Build branch view.** Show courses, batches, publication status, trends and attention lists. **Done when:** branch drill-down reconciles to authorized course/batch data. Reference: PRD §6.5.
- [x] **VIEW-04 — Build course view.** Show offerings/batches, subject/paper results and explicitly comparable assessments across branches. **Done when:** similarly named exams are not automatically treated as equivalent. Reference: PRD §5/6.5.
- [x] **VIEW-05 — Build batch view.** Show listed/eligible roster, subject/paper matrix, completeness, rank lists and card links. **Done when:** eligibility limitations and ranking cohort are clear. Reference: PRD §6.5/7.
- [x] **VIEW-06 — Build subject view.** Show paper/topic assessment history, branch/batch breakdown and score/status distribution. **Done when:** users can drill to contributing authorized results. Reference: PRD §6.5.
- [x] **VIEW-07 — Build paper view.** Show assessment/attempt history, exam types, cohorts and student detail. **Done when:** retests/components retain their meaning without duplicate totals. Reference: PRD §6.5.
- [x] **QA-02 — Verify reporting and accessibility.** Run AT-07/10–14/20, keyboard/screen-reader checks and representative PDF visual checks. **Done when:** totals reconcile, restricted outputs reveal no hidden subjects, and confirmed accessibility targets are met.

Milestone exit: met on 7 October 2026. Cards, exports, and all six academic views reconcile to the active revision and the approved calculation examples. Pilot academic sign-off remains M6.

## M5 — Desktop distribution and cloud operations

Dependencies: ARC-05/06; platform foundations from M2. Packaging/cloud foundations can start during M2–M4; final validation requires M4. Owners: Release, Operations, Backend, QA.

- [ ] **DSK-01 — Build desktop client runtime.** Package shared React UI, authenticated endpoint configuration, health/connectivity messages and server-version checks. **Done when:** it connects to cloud/local server without bundling MongoDB or accepting offline writes. Reference: PLT-04.
- [ ] **DSK-02 — Build full application runtime.** Bundle and manage FastAPI, MongoDB, jobs and private files; handle startup/shutdown, permissions, port conflicts and diagnostics. **Done when:** full academic workflows work offline on the host. Reference: PLT-02/03.
- [ ] **DSK-03 — Add secure LAN mode.** Configure explicit server exposure, encrypted authenticated access and client connection. **Done when:** only the designated host owns the database and LAN clients honor ACLs. Reference: PLT-05.
- [ ] **DSK-04 — Deliver Windows installers.** Produce distinctly labeled full/client installers with managed prerequisites and verified signatures. **Done when:** clean install, startup and uninstall succeed on agreed Windows targets. Reference: PLT-01/02/06/08.
- [ ] **DSK-05 — Deliver macOS installers.** Produce full/client packages for agreed architectures, signed and notarized. **Done when:** clean installation and runtime validation pass on each supported target. Reference: PLT-01/02/06/08.
- [ ] **OPS-01 — Build upgrade and compatibility flow.** Add pre-migration backup, data/grant preservation, compatibility messages and failed-upgrade recovery. **Done when:** a populated installation upgrades and recovers without result/permission loss. Reference: PLT-07.
- [ ] **OPS-02 — Build local backup/restore and uninstall behavior.** Add scheduled daily backups, configurable destination, authorized restore and data-retaining uninstall. **Done when:** restore reconciles data/files/grants and removal requires a separate explicit choice. Reference: PLT-08, PRD §11.
- [ ] **CLD-01 — Provision cloud staging/production.** Configure React hosting, FastAPI, MongoDB, private files and persistent job services with TLS, secrets and private database connectivity. **Done when:** separated environments run the same contracts and academic workflows. Reference: PLT-09.
- [ ] **CLD-02 — Configure monitoring and recovery.** Add health checks, job/backlog/failure visibility, scheduled backups and restore validation. **Done when:** alerts and restore drills meet agreed availability/RPO/RTO targets. Reference: PLT-09, PRD §11.
- [ ] **OPS-03 — Document local/cloud migration.** Define controlled export/backup, migration, reconciliation and cutover with one authority. **Done when:** a representative deployment moves without relying on bidirectional synchronization. Reference: PRD §10.2.
- [ ] **QA-03 — Validate platform releases.** Run AT-15/16 on signed release builds, including offline host, LAN, cloud client, failed services, upgrade and restore. **Done when:** all four installer variants pass the supported OS/architecture matrix.

Milestone exit: production-ready installers and cloud deployment, with proven recovery and operator procedures.

## M6 — Acceptance, pilot and launch

Dependencies: M3–M5 completion. Owners: QA, Academic, Product, Operations.

- [ ] **QA-04 — Complete access-control acceptance.** Run AT-09–11/19 through UI and direct APIs, including hidden aggregates, source files, queued exports and privilege delegation. **Done when:** no unresolved scope leakage or privilege escalation remains.
- [ ] **QA-05 — Validate scale and resilience.** Exercise agreed 10-branch/10,000-student/1-million-result dataset, import load targets, concurrent retries and service interruptions. **Done when:** confirmed performance limits pass or product explicitly renegotiates targets before release. Reference: PRD §11.
- [ ] **QA-06 — Complete requirement acceptance matrix.** Attach evidence for AT-01–20, compatible browsers, accessibility, PDF output and release builds. **Done when:** academic, QA and operations owners sign off their release gates. Reference: PRD §12.
- [ ] **REL-01 — Prepare guides and instrumentation.** Deliver import/review/report/access guides, local/cloud operations and recovery runbooks; capture import time, manual-resolution rate, failures and card coverage. **Done when:** operators can diagnose and recover without developer-only procedures. Reference: PRD §13/14.
- [ ] **REL-02 — Run one-branch pilot.** Start from an empty academic catalog and run a full assessment cycle alongside current spreadsheets. **Done when:** academic owner reconciles students/results/cards and staff complete the workflow after onboarding. Reference: PRD §14.
- [ ] **REL-03 — Expand pilot to another branch.** Validate reuse, multi-branch comparisons and scoped subject access. **Done when:** no duplicates or unauthorized disclosure are found and identified issues are resolved. Reference: PRD §14.
- [ ] **REL-04 — Approve and execute launch.** Review acceptance evidence, backup/restore drill, deployment readiness and institution approval. **Done when:** designated launch owner approves rollout and installers/cloud are released with documented support ownership. Reference: PRD §12–14.

## Planning and completion rules

- Confirm decisions before dependent implementation; do not invent missing academic policies.
- Build one complete import-to-published-card path before broadening views, while starting desktop/cloud feasibility early.
- Keep automatic academic/student creation inside the import workflow. No separate setup sequence or manual marksheet creation belongs in this release.
- Every engineering task includes relevant authorization, audit, error handling and meaningful verification for its affected behavior.
- Do not mark a milestone complete while a required desktop variant, academic view or deployment mode remains deferred.
- Bidirectional local/cloud sync, parent/student portals, fees, predictive AI and the other deferred PRD features remain outside this backlog.

## Acceptance traceability

| PRD acceptance scenarios | Primary backlog coverage |
|---|---|
| AT-01 | IMP-01/03/04/08, QA-01 |
| AT-02 | IMP-05, QA-01 |
| AT-03 | IMP-02/06, QA-01 |
| AT-04 | IMP-01/05, QA-01 |
| AT-05 | IMP-06, CAL-01, QA-01 |
| AT-06 | IMP-04, CAT-01, QA-01 |
| AT-07 | MRK-02/03, CAL-03, QA-02 |
| AT-08 | IMP-08, FND-05, QA-01 |
| AT-09 | ACL-01/03, QA-04 |
| AT-10 | ACL-01/03, QA-04 |
| AT-11 | ACL-04, RPT-01, QA-04 |
| AT-12 | CAL-01/02, QA-02 |
| AT-13 | VIEW-01–07, QA-02 |
| AT-14 | PRG-01, RPT-01, QA-02 |
| AT-15 | DSK-01–05, QA-03 |
| AT-16 | OPS-01/02, CLD-02, QA-03 |
| AT-17 | IMP-02/05, QA-01 |
| AT-18 | FND-02, IMP-08, QA-01 |
| AT-19 | ACL-01/03, IMP-03/04, QA-04 |
| AT-20 | CAL-02, QA-01/02 |
