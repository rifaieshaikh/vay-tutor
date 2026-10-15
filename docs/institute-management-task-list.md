# Institute management restructuring task list

Related experience work: [UI and UX redesign task list](ui-ux-redesign-task-list.md). Structural implementation does not imply that typography, filters, navigation, actions or staff workflows have passed redesign acceptance.

Date: 15 October 2026

Objective: organize Vay Tutor as an institute management system, with connected admissions, student, academic, staff and assessment workflows. Deliver incrementally using the existing React/FastAPI/MongoDB application.

This is the restructuring backlog. Phases 1 through 6 were accepted on 15 October 2026. Existing functionality is an input, not evidence that these acceptance conditions have passed. Preserve the historical completion records in [the release backlog](task-list.md). This plan replaces its import-first organizing direction for this restructuring; it does not cancel outstanding reporting, distribution, recovery or release work. Reconcile the underlying requirements in IMS-01.

## Phase 1 — Establish the model and implementation baseline

Accepted on 15 October 2026: [ims-baseline.md](ims-baseline.md). The decision changes are the IMS-01 addendum in [m0-decisions.md](m0-decisions.md).

- [x] **IMS-01 — Align product documents.** Update the PRD, architecture and active release-planning rules to describe an institute management system. Replace import-only creation restrictions with explicit manual and import workflows. Record which previous decisions change. **Done when:** documents consistently describe the new organization and retain publication, identity, access and historical-data guarantees. **Owner:** Product/Engineering.
- [x] **IMS-02 — Inventory existing behavior.** Map existing pages, endpoints, collections, permissions and tests to admissions, students, academics, staff, assessments, reports and administration. Include current uncommitted implementation and unresolved release tasks. **Done when:** each capability has an owner, current entry point and proposed destination; gaps and duplicate responsibilities are recorded. **Owner:** Engineering.
- [x] **IMS-03 — Define entity relationships and lifecycles.** Document course → subjects → papers; branch + course → offering → batches; student → enrollments; teacher → teaching assignments; assessment → results. Define admission-to-enrollment linkage, transfers, returning students, batch closure and archived records. Preserve assessments shared across eligible batches where supported. **Done when:** worked examples cover multiple branches, multiple enrollments, a transfer and a shared assessment without duplicate people or results. **Owner:** Product/Academic/Backend.
- [x] **IMS-04 — Define module permissions.** Map existing actions and complete scope tuples to the new modules, including admissions operations, student management, academic setup, teaching assignments and dashboard counts. Keep staff identity separate from login access. **Done when:** allowed and denied examples exist for an administrator, admissions operator and scoped teacher, including users with disjoint grants. **Owner:** Backend/Product.
- [x] **IMS-05 — Record migration requirements.** Compare IMS-03 with actual collections and indexes. Identify only necessary data changes, detect inconsistent links and define any backfill, reconciliation and recovery steps. **Done when:** a representative populated database can be checked before changes; required migrations have a reversible or backup-based recovery procedure. **Owner:** Backend.

Exit: a single agreed model, mapped implementation and explicit compatibility requirements. No database rewrite is assumed.

## Phase 2 — Reorganize navigation and the starting experience

Depends on IMS-01–04. This is the first user-visible delivery slice.

- [x] **IMS-06 — Group navigation by responsibility.** Introduce Dashboard; Admissions; Students; Academics; Staff; Assessments; Reports; Administration. Place enquiries/admissions under Admissions; branches/courses/offerings/batches under Academics; import/marksheets under Assessments; cards/views under Reports; accounts/access/audit/settings under Administration. **Done when:** every existing destination remains reachable, empty groups are hidden and visibility follows permissions. **Owner:** Frontend.
- [x] **IMS-07 — Preserve links and orientation.** Keep existing URLs working through retained routes or redirects. Add clear page titles, breadcrumbs and active navigation states, including detail pages. **Done when:** bookmarks and links from existing screens still reach the correct record and preserve applicable query parameters. **Owner:** Frontend.
- [x] **IMS-08 — Define shared academic context.** Specify branch, course/offering, batch and academic-period selection, including an explicit all-authorized option. Confirm how academic periods relate to existing batch/session keys before adding fields. Define which pages consume each filter. **Done when:** changing a parent clears incompatible descendants, context is visible, and admissions/global curriculum pages do not inherit inappropriate batch restrictions. **Owner:** Product/Frontend/Backend.
- [x] **IMS-09 — Implement context persistence.** Use one shared context implementation with URL-backed applicable filters. Validate selected IDs against authorized options and apply corresponding filters on the server. **Done when:** context survives relevant navigation/reload, can be cleared and cannot expose unauthorized records. **Owner:** Frontend/Backend.
- [x] **IMS-10 — Replace the import-first homepage.** Build a permission-aware operational dashboard with enquiries awaiting follow-up, admissions awaiting an agreed next action, marksheets awaiting review and failed imports. Use actual supported statuses; define missing status semantics before adding counts. **Done when:** every actionable count links to its contributing filtered records, counts reconcile, and loading/error/empty states work. **Owner:** Frontend/Backend/Product.

Exit: users can locate existing work through the new structure and start from relevant pending tasks.

## Phase 3 — Deliver a connected batch workspace

Depends on IMS-03–05 and IMS-06–09. Implement this slice before broad page refactoring.

- [x] **IMS-11 — Make academic structure independently manageable.** Consolidate branch, course, offering and batch creation/editing entry points. Keep curriculum at course level and cohorts beneath offerings. **Done when:** an authorized operator can create a branch offering and batch without importing marks, and invalid or duplicate relationships are rejected. **Owner:** Frontend/Backend.
- [x] **IMS-12 — Build the batch workspace.** Provide batch details, enrolled students, curriculum, teacher assignments and assessments through linked sections. Reuse canonical record pages and avoid copied CRUD implementations. **Done when:** staff can move from a batch to a student, assignment or marksheet and return with context intact; lists are paginated where needed. **Owner:** Frontend/Backend.
- [x] **IMS-13 — Connect teacher assignments.** Inventory the existing teacher implementation, then consolidate or add assignments to batch/subject with applicable dates and status. **Done when:** one teacher can serve multiple batches, changes preserve history and assigning teaching work does not silently grant account permissions. **Owner:** Backend/Frontend.
- [x] **IMS-14 — Verify the first complete workflow.** Exercise branch → offering → batch → enroll student → assign teacher → open assessment/results using the new navigation. **Done when:** the workflow passes with populated and empty data for administrator and scoped staff, with no broken existing URLs. **Owner:** QA/Academic.

Exit: the academic hierarchy supports a complete operational workflow through one batch workspace.

## Phase 4 — Connect admissions, students and assessments

Depends on the domain definitions and relevant shared services from Phase 3.

- [x] **IMS-15 — Separate admissions work from the student directory.** Move enquiry and admission entry points into Admissions; show appropriate stage, next action and links between related records. **Done when:** operators can follow a prospect through supported admission stages without searching the enrolled-student directory. **Owner:** Frontend/Backend.
- [x] **IMS-16 — Unify student identity and enrollment.** Consolidate admission conversion, manual enrollment and import identity resolution around one student identity and historical enrollments. **Done when:** repeated conversion/retry does not duplicate a student or enrollment; same-name ambiguity requires resolution; transfers and returning students preserve history. **Owner:** Backend.
- [x] **IMS-17 — Consolidate the student workspace.** Connect relevant admission history, profile, enrollments and academic progress in the existing student page. Define field visibility for staff roles. **Done when:** one student with multiple enrollments has one canonical profile and accurate scoped history, with links to source records. **Owner:** Frontend/Backend.
- [x] **IMS-18 — Place import within Assessments.** Launch import from the assessment register or batch workspace with explicit inherited context. Retain create/reuse preview and exception resolution for genuinely missing records. **Done when:** ordinary imports reuse selected canonical entities, conflicting context requires resolution and import remains usable for historical workbooks. **Owner:** Frontend/Backend.
- [x] **IMS-19 — Share creation and validation rules.** Route manual and import workflows through shared rules for academic structure, identity and enrollment. Preserve existing transaction boundaries and import provenance. **Done when:** both paths enforce the same uniqueness, ownership, audit and authorization rules; import rollback does not remove pre-existing manual records. **Owner:** Backend.
- [x] **IMS-20 — Connect assessment review and reporting.** Link batch/student workspaces to marksheets, publication status, cards and academic views. Keep draft/published distinctions and existing revision rules. **Done when:** progress and reports use authorized active published results, and their totals reconcile with contributing records. **Owner:** Frontend/Backend/QA.

Exit: admissions, enrollment, teaching and assessment form connected workflows using shared records.

## Phase 5 — Align implementation boundaries

Extract incrementally alongside completed workflow slices; avoid a separate big-bang rewrite.

- [x] **IMS-21 — Split frontend modules by domain.** Extract admissions, students, academics, staff, assessments, reports and administration from large page files. Start with `Catalog.tsx`, `Access.tsx`, `Intake.tsx` and `Student.tsx`. **Done when:** each domain owns its pages/API types, shared UI is reused where appropriate and existing behavior/routes remain intact. **Owner:** Frontend.
- [x] **IMS-22 — Split backend routing and business logic.** Extract domain routers and shared services from `http.py`, `intake.py` and import routes. Keep HTTP parsing separate from domain rules and database operations where useful. **Done when:** manual/import handlers call the same relevant services, router registration remains compatible and domain ownership is explicit. **Owner:** Backend.
- [x] **IMS-23 — Consolidate cross-cutting behavior.** Reuse context selectors, pagination, errors, notifications, audit events and permission checks. Consolidate duplicated API types within the existing tooling. **Done when:** touched workflows use consistent contracts without introducing a second competing implementation. **Owner:** Frontend/Backend.
- [x] **IMS-24 — Refresh developer documentation.** Update README capabilities, local checks, domain ownership and links to the active backlog. **Done when:** a developer can locate the owner of an admissions, enrollment or assessment change without relying on milestone file names. **Owner:** Engineering.

## Phase 6 — Validate and roll out

Accepted on 15 October 2026. IMS-25 through IMS-28 were verified in the application. The release backlog still holds MOD-21, MOD-23, MOD-29, MOD-30, MOD-31, the desktop and cloud work, QA-03 through QA-06, and REL-01 through REL-04.

- [x] **IMS-25 — Verify data integrity and compatibility.** Reconcile student/enrollment/result counts, relationships, active revisions and source links before/after any migration. Exercise retry and failure recovery for changed mutations. **Done when:** no unexplained changes remain and existing endpoints/bookmarks work as documented. **Owner:** Backend/QA.
- [x] **IMS-26 — Verify access across connected workflows.** Check navigation, detail routes, dashboard counts, filters, source files and reports through UI and direct API requests, including disjoint scope grants. **Done when:** records and aggregates remain within authorized complete tuples and revocation is respected. **Owner:** QA/Backend.
- [x] **IMS-27 — Verify usability and responsive behavior.** Review admissions, batch and student workflows on desktop and narrow/mobile layouts, including keyboard use, clear focus, empty/error states and back navigation. **Done when:** operators can finish their tasks without developer guidance and acceptance issues are resolved. **Owner:** QA/Product/Academic.
- [x] **IMS-28 — Run focused regression checks.** Run backend lint/tests and frontend build, adding meaningful coverage for changed identity, enrollment, context and permission behavior. Reconcile representative workbook import, publish, correction and reporting scenarios. **Done when:** required checks pass and failures have recorded resolutions. **Owner:** Engineering/QA.
- [x] **IMS-29 — Pilot and reconcile the release backlog.** Pilot the new organization with representative admissions, academic and teaching staff. Link evidence, resolve blocking issues and update the active release sequence without losing outstanding platform work. **Done when:** staff accept the connected workflows and the remaining release backlog accurately reflects completed and outstanding work. **Owner:** Product/QA/Operations.

## Scope and execution rules

- Start with Phase 1, then deliver navigation/dashboard and the batch workflow as small reviewable slices.
- Keep all boxes open until their acceptance conditions are verified. Assign named owners when scheduling work; role labels above are proposed responsibilities.
- Preserve current uncommitted work and historical task completion records.
- Reuse existing collections and capabilities wherever they satisfy the agreed model. Perform migrations only for demonstrated gaps.
- Include relevant authorization, audit, validation and error handling in each changed workflow.
- Fees, attendance, timetabling, payroll, inventory and parent/student portals need separate requirements and prioritization; this restructuring does not implicitly add them.
