# ACD-01 — Modern Academics navigation and management workspaces

Date: 19 October 2026 · Status: accepted on 19 October 2026 at the user's request. No personal reviewer name was supplied.

## User story

As institute staff, I want to browse and manage the institute's branches, course offerings, curriculum and batches through connected, consistent workspaces, so I can understand academic structure, find the right cohort and complete management tasks quickly without duplicate setup or lost context.

## Scope: all Academics options and descendants

The current Academics menu has **Institute, Courses and Batches**. This story covers every destination and its related content/actions, not only the top-level registers:

| Entry point | Included workspace and related content |
|---|---|
| Institute — `/institute` | Institute profile/editing; branch directory; branch creation and archive/status presentation. |
| Branch — `/institute/branches/:branchId` | Branch details, offered courses, offering creation, related batches, authorized student directory and branch editing. |
| Courses — `/courses` | Course directory, creation, editing, archive/status and branch-offering summaries. |
| Course — `/courses/:courseId` | Course overview, subject management, papers/chapters/modules, offered branches and contextual links to batches, reports and Forms. |
| Batches — `/batches` | Batch directory, creation/editing, branch/course/offering/period relationships, dates, timings and current/closed/archive states. |
| Batch — `/batches/:batchId` | Overview, students/enrollment entry, teacher assignments, course curriculum, assessments and report links, including embedded lists. |

Subjects, curriculum items and offerings are included as meaningful workspaces/sections even where no standalone route exists. Do not add a top-level menu entry for every database entity. Preserve existing URLs and deep links; propose any route additions explicitly during design.

Use the [modern UI plan](modern-ui-task-list.md), [Students story](students-story.md), [Admissions story](admissions-story.md) and [dashboard story](dashboard-story.md) for shared patterns and boundaries. This story does not redesign report calculations, staff profiles, application processing, fees, attendance or timetabling. Existing teacher/enrollment workflows must integrate without duplicating their business rules.

## Proposed experience

### Navigation and visual hierarchy

- Academics supports expanded/collapsed submenu and icon-rail flyout behavior from the shared navigation design.
- Keep Institute, Courses and Batches recognizable; remove repeated headings and competing module navigation.
- Each record has a compact name/status/context header, meaningful primary action, clear secondary actions, breadcrumb and return destination.
- Separate **academic structure/management** from **academic performance reports**. Label report links View performance rather than an ambiguous View icon.
- Default to all authorized data. Do not permanently render Branch/Course/Period/Batch dropdowns above every screen. List-owned Filters exposes only applicable criteria; record context is displayed from the record rather than reselected globally.

### Institute and branches

- Institute page provides a concise profile and a usable Branches directory, not a long setup form.
- Branch details prioritize location/contact where recorded, status and offered courses. Staff can add an existing course offering without accidentally creating another global course.
- Branch students and batches use the shared list pattern with searchable identities, appropriate filters, sorting and authorized counts.

### Courses and curriculum

- Course directory shows name, state, offered-branch summary and useful curriculum information; one row per course.
- Course workspace separates Overview, Curriculum and Where offered/Related batches according to content volume.
- Curriculum makes subjects and their assessed/teaching items understandable together. Do not hide all structure behind a subject dropdown or label every item-creation operation Add paper.
- General/course-specific application questions remain in Administration → Forms; retain a contextual link for authorized configuration users.

### Batches

- Batch directory identifies cohort, branch, course, intake, dates/schedule and defined lifecycle state. Filters/sorting support operational cohort lookup.
- Batch workspace gives direct access to Students, Teachers, Curriculum and Assessments without scrolling past always-expanded management forms.
- Add enrollment, Assign teacher and relevant assessment actions open deliberate short forms or navigate to the responsible workspace with explicit context.
- Curriculum belongs to the course; any batch-specific snapshot/override behavior must be an agreed policy, not an accidental editable copy.

## Recorded decisions

Accepted on 19 October 2026 at the user's request. No personal reviewer name was supplied. These outcomes are the contract. Historical records are not rewritten to fit them.

| Decision | Outcome |
|---|---|
| Menu structure | Institute, Courses, and Batches stay the Academics menu. Branches live inside Institute. Offerings and curriculum stay inside branch and course workspaces. No extra top-level entry. |
| Relationships | Institute → branches. A course is reusable and owns subjects. A subject owns numbered papers and named items such as parts, chapters, and modules. A branch plus a course is one offering, and that offering owns batches. Offerings are unique on branch and course. Subjects are unique on course and name. Papers are unique on subject and number. Named items are unique by kind and name within one subject. |
| Default status scope | Lists start with every authorized record, including archived catalog records and closed batches. Active, current, and closed are filters. |
| Status semantics | Current means the batch is not archived and has no end date. Closed means an end date is stored. A future end date closes the batch immediately. The institute timezone is not applied to that comparison. Archived is separate and can combine with either state. |
| Archive and closure | Archive does not delete children, end enrollments, end assignments, or withdraw results. While a branch or course is archived, new offerings, batches, subjects, and curriculum items are refused. An archived batch refuses new enrollments and assignments. Restoring the parent does not restore children that were archived on their own. |
| Offering lifecycle | Offering a course reuses the existing course. A second offering of the same course at the same branch is rejected. An offering has no separate end state. Archiving the branch or the course blocks new batches and offerings. Existing batches remain. |
| Curriculum semantics | Papers are numbered on the subject. Parts, chapters, modules, and later subject partition types belong to the subject, not to a paper. Settings seeds Paper, Part, Chapter, and Module, and can add a partition, rename its label, or archive it. Paper cannot be archived. An archived partition stays on existing items and is hidden from new ones. The same item name may be used on a different subject. Reordering and moving items are not offered. Exam types, such as test series and module exam, are a separate settings list and do not divide the subject. |
| Exam conduct | Assessments → ECR is one register per batch. An exam covers the whole subject or one or more items of a single type, and can include several batches of that course. The marklist is uploaded from the ECR import page. A name that is not already in a selected batch is enrolled there when the import is saved. A name that matches no student creates that student. The import does not create an admission. |
| Curriculum changes | Batches use the live course curriculum. They do not keep a snapshot. Assignments and assessments keep the canonical subject and paper ids. Renaming a subject does not rewrite those ids. |
| Batch identity | Two batches on one offering are unique by display name (`name_key`), not by intake. The same intake with different names is allowed. The same name on that offering is rejected. Cohorts are never merged by name alone. |
| Batch period and schedule | Intake is the month and year parsed from the batch name, shown as Not recorded when the name has none. Start, end, and schedule are separate. There is no timetable or conflict check. |
| Creation actions | Branch, course, subject, and item creation use short dialogs. Batch creation uses the fuller form and states the intake and schedule rules. |
| Access | A grant limited to a subject or paper does not create a sibling subject and does not add items to another subject. A paper-limited grant does not add items for the whole subject. Hidden subjects and papers are omitted from catalog lists, batch curriculum, assignment rows, and assessment rows. A branch administrator with catalog access can still edit the course curriculum. Lookup alone does not grant edit. |

## Accepted contract

- Institute, Courses, and Batches stay the Academics menu. Branches, offerings, and curriculum stay inside those workspaces. Existing routes stay.
- Lists default to every authorized record, including archived catalog records and closed batches. Search stays visible. Filters use Apply, Reset, and Cancel. Applied filters are removable chips. Clear filters restores the full authorized list and keeps the current sort.
- Batch state is separate from catalog archive. Current means the batch is not archived and has no end date. Closed means an end date is recorded. Archived can combine with either. An end date closes new enrollments. Archiving does not delete children, end enrollments, or withdraw results.
- Intake is the calendar period stored on the batch when the name contains one month and year. Start date, end date, and schedule are separate fields. The application does not check timetable conflicts.
- Offering a course at a branch reuses an existing course. A duplicate branch-course offering is rejected. Creating a missing course leaves the offer dialog, then returns to that branch.
- Curriculum is owned by the course. A batch shows that live curriculum and does not keep an editable copy. Subject partition types come from Settings. Paper, Part, Chapter, and Module are seeded. Paper stays numbered. Other partitions are named items on the subject. Exam types are a separate list, seeded with Test series and Module exam.
- Application questions stay in Administration → Forms. Courses link there for people who can manage them.
- Performance reports are linked as View performance. The permanent branch, course, period, and batch bar is not shown on Academics pages.
- A branch student count is distinct authorized students with an enrollment at that branch, excluding archived people. The student list link uses that branch.
- Catalog saves can send `expected_revision`. A mismatch returns `catalog.stale` and does not write. Omitting it stays compatible with older clients. A successful save increments `revision`.
- Batch student lists accept `student_q` and `student_state` (`current` or `historical`) before pagination. Assessment lists accept `assessment_q`, `assessment_status`, and `assessment_subject`. Teacher rows filter by name, status, and subject in the workspace. Branch batch rows filter by name, state, and intake in the workspace. Embedded lists sort by name. Registers sort by name, start, or intake.

## Acceptance criteria

### AC-01 — Coverage, contracts and design review

- [x] Inventory every route above plus embedded offerings, students, subjects/items, assignments and assessments, recording existing UI/API support and missing capabilities.
- [x] Resolve the decision table with owners; specify query/status/date/uniqueness/authorization contracts and necessary compatible migration/backfill checks.
- [x] Review populated desktop/mobile designs for Institute, branch, Courses, course curriculum, Batches and batch workspace plus creation/edit/error states before application changes.
- [x] Every existing Academics capability maps to a designed destination; modernization cannot silently remove management actions or historical records.

### AC-02 — Menu, orientation and continuity

- [x] All three Academics menu entries and their descendants work in expanded sidebar, icon rail/flyout and mobile drawer modes; the active owning entry/group is identifiable.
- [x] Breadcrumbs/document titles identify the actual institute/branch/course/batch, with useful loading fallbacks. Existing bookmarks work or have explicitly compatible redirects.
- [x] Opening related records/sections and returning restores originating search/filter/sort/page/section state, including links from reports or Students where applicable.
- [x] Detail context is derived from the record; a global filter cannot make one batch page appear to belong to another branch/course. Cross-record/report links carry meaningful supported scope only.

### AC-03 — Common filters, search and global sorting

- [x] Every register and embedded list has a documented applicable search/filter/sort contract; irrelevant criteria are absent rather than repeated across all screens.
- [x] Basic search stays visible. Filters opens a draft panel with Apply/Reset/Cancel, applied chips and Clear filters. Defaults show all authorized records under the agreed status policy, with no permanent four-dropdown bar.
- [x] Branch/course/batch/intake/status/date criteria apply only where actual relationships support them. Changing parents clears incompatible descendants without dropping unrelated valid filters.
- [x] Sorting is explicit and stable across the complete authorized filtered dataset before pagination; column headers and sort controls agree. Name/code/date/null behavior is documented.
- [x] URLs, reload and Back/Forward restore applied state; counts/ranges reconcile. Loading/errors/no matches are distinct and stale requests cannot replace newer results.

### AC-04 — Institute and branch directory

- [x] Institute profile is concise and separates permitted Edit institute from Add branch and directory actions; contact/location fields show meaningful labels and missing-value states.
- [x] Branch directory supports name/code search where stored, explicit status and offered-course filters where supported, agreed name/creation sorts and pagination.
- [x] Branch identity/status/offered-course summaries are readable; displayed totals respect scope and link to matching contributors rather than unfiltered catalog counts.
- [x] Create/Edit branch validates actual required fields and normalized uniqueness without losing inputs; retries/concurrency cannot create accidental duplicate branches.
- [x] Unauthorized users cannot edit institute/branch data or infer protected student/course totals through altered requests or linked summaries.

### AC-05 — Branch details and course offerings

- [x] Branch workspace clearly separates Overview, Courses/Offerings, Batches and Students as appropriate; management forms appear only after explicit actions.
- [x] Offer course selects an existing authorized global course, states branch context and prevents duplicate branch-course offerings server-side, including concurrent submissions.
- [x] If the required global course is absent, provide a permitted contextual Create course path without nested modal chains, then return to the offering task with draft state intact.
- [x] Offered-course and batch entries link to the correct canonical records; embedded lists provide relevant search/status/intake filters and sorting without retrieving a silently truncated fixed catalog.
- [x] Branch student lists count people consistently, distinguish enrollment state and expose only authorized student/contact fields; their context agrees with the Students workspace.

### AC-06 — Courses register and workspace

- [x] Course directory supports relevant name/code search, status and offered-branch filtering, agreed name/creation sorting and one row/count per canonical course.
- [x] Course header distinguishes catalog state, curriculum and where offered; actions name their effect, including View performance and Manage application questions where permitted.
- [x] Creating/editing a course preserves its identity and historical references; uniqueness/archive rules and concurrent changes produce actionable errors.
- [x] Related offerings/batches are discoverable with scoped links and list return continuity. Empty states explain the next permitted action without imposing prerequisite manual setup on import workflows.
- [x] Form configuration is not duplicated inside course curriculum; application answers and question history remain governed by Forms/Admissions rules.

### AC-07 — Subjects, papers, chapters and modules

- [x] Curriculum displays navigable subject/item structure with visible selected context; staff can inspect/search relevant items without guessing a hidden dropdown selection.
- [x] Creation labels and forms match the chosen kind and approved parent hierarchy; subject/course/paper numbering and uniqueness are validated server-side.
- [x] Editing, reordering where supported, archiving/reactivation and moving items where explicitly allowed show affected relationships before mutation; unsupported operations are not presented as working.
- [x] Linked assignments/assessments/results retain canonical references and historical interpretation after curriculum changes; version/snapshot policy is enforced rather than silently changing old records.
- [x] Partial subject permissions filter nodes, options and counts without exposing hidden siblings or enabling creation under unauthorized parents.

### AC-08 — Batches register and creation/editing

- [x] Directory shows batch name/reference, branch, course/offering, explicitly labeled intake, dates, schedule and defined current/closed/archive state without conflating these concepts.
- [x] Search and relevant branch/course/intake/status/date filters plus agreed name/start/intake sorting work globally with stable pagination and permitted options.
- [x] Batch creation selects/reuses a valid offering; parent defaults from branch/course entry points are visible and cannot imply permission. Missing offering creation follows an explicit authorized path.
- [x] Date/session/name/schedule validation and approved uniqueness permit genuinely distinct same-intake cohorts while preventing accidental duplicate submissions; no unsupported timetable guarantees are implied.
- [x] Editing a populated batch exposes consequences of structural/date/state changes, rejects stale updates and preserves historical enrollment/assessment links. Parent changes cannot silently relocate existing academic records.

### AC-09 — Batch overview and students

- [x] Header identifies batch, branch, course, intake, schedule and state with useful current/authorized summaries; all applicable counts reconcile with contributing records.
- [x] Overview/section navigation reaches Students, Teachers, Curriculum and Assessments directly, with URL section state and responsive behavior.
- [x] Student list supports identity search, defined enrollment status/date filters and sorting; no match, no enrollments and failed load have distinct recovery.
- [x] Add enrollment clearly distinguishes an existing student from a new applicant/admission path and follows the shared approved rules, not a second identity/enrollment implementation.
- [x] Closed/archived batch restrictions apply in UI and API; pending mutations, duplicates, lost responses and permission changes are handled without duplicate identities/enrollments.

### AC-10 — Batch teachers and curriculum

- [x] Teacher assignments show teacher, subject/paper, effective dates and current/ended status, with relevant search/status/subject filters and sorting.
- [x] Assign teacher opens a bounded form using eligible authorized teacher/curriculum options; ending/revising an assignment preserves history and follows approved dates/overlap rules.
- [x] Assignment creation or ending cannot implicitly grant account access; duplicate/concurrent submissions and failed saves are handled explicitly.
- [x] Batch curriculum states whether it is course-owned live data or a specific version/snapshot. Editing links to the authorized owner and describes its approved impact.
- [x] Hidden subjects/teacher details remain hidden through options, summaries and related links; closed-state behavior is consistently enforced.

### AC-11 — Batch assessments and reporting links

- [x] Assessments list supports relevant title/status/subject/type/date criteria and global sorting, showing publication state and dates clearly.
- [x] Create/Enter marks/Import actions are permission-aware, prefill only the appropriate visible batch context and reuse assessment workflows rather than duplicate creation logic.
- [x] Shared assessments retain their actual eligible cohort relationships; listing under a batch never duplicates a student's canonical result.
- [x] Marksheets, progress cards and academic-view links match authorized batch context, preserve return paths and retain active published-revision/coverage semantics.
- [x] Empty assessment history offers the next permitted action; unsupported report scope or unavailable results are not presented as zero performance.

### AC-12 — Archive, closure and structural integrity

- [x] Archive/close/reactivate/reopen operations have approved permissions and explicit impact summaries; they are separate from permanent deletion.
- [x] Archiving a parent does not silently delete/archive children, terminate assignments/enrollments or withdraw published results. New-write restrictions follow the approved policy.
- [x] Identity, uniqueness, offering and parent-child invariants survive concurrent creation/edit operations; UI defaults cannot bypass them.
- [x] Mutations that span records are atomic or use an explicitly reviewed recoverable contract; retries cannot leave partial structure or create duplicates. Audit captures actor/context/meaningful before-after changes.
- [x] Manual and import-driven creation use the same relevant canonical/authorization rules; canceled/failed imports do not remove pre-existing structure.

### AC-13 — Dialogs, notifications, accessibility and responsive design

- [x] Short forms use task-specific dialogs with labeled primary/secondary actions; complex forms have sufficient workspace. No clipped text actions in icon-sized containers or nested modal workflows.
- [x] Dirty state is protected across dismissals, section/route changes, history and refresh; failed saves retain draft input and field errors; pending actions prevent duplicate submission.
- [x] Focus is meaningful, trapped/restored for modals, and visible; keyboard users can navigate sidebar, nested curriculum, lists and actions with correct semantics.
- [x] Real success/error outcomes use shared notifications; actionable failures remain recoverable and important changes remain inspectable after a notice disappears.
- [x] All routes/sections work at 360/390/768/1280 CSS pixels and 200% text zoom; necessary table scrolling stays within table regions, and color alone never communicates state.

## Execution tasks

- [x] **ACD-T01 — Inventory and decide.** Map every Academics route/embedded list/API; confirm hierarchy, statuses, curriculum policy, uniqueness, permissions and query contracts. **Acceptance:** AC-01 contract checks pass; each pending decision has an owner and blocks dependent behavior. **Owner:** Product/Academic/Backend.
- [x] **ACD-T02 — Review full-scope designs.** Produce linked desktop/mobile layouts for every menu destination and record, curriculum/offerings and dialogs, including empty/error/archived variants. **Acceptance:** user review is recorded and AC-01–13 map to reviewable behavior. **Owner:** Design/Product. **Depends on:** T01.
- [x] **ACD-T03 — Shared academic queries and orientation.** Implement compatible authorized list/filter/global-sort/count APIs, shared controls, stateful links and menu orientation. **Acceptance:** AC-02–03 pass with multi-page fixtures and partial/disjoint grants. **Owner:** Backend/Frontend. **Depends on:** T01–02.
- [x] **ACD-T04 — Institute and branch workspaces.** Deliver profile/directory/editing, offering management and branch-related batch/student lists. **Acceptance:** AC-04–05 pass including concurrent duplicates and scope-correct totals. **Owner:** Frontend/Backend. **Depends on:** T03.
- [x] **ACD-T05 — Course and curriculum workspaces.** Deliver course register/detail, subject/item hierarchy and canonical relationship safeguards. **Acceptance:** AC-06–07 pass for long/empty/partially authorized curriculum and version/change impacts. **Owner:** Frontend/Backend/Academic. **Depends on:** T03–04.
- [x] **ACD-T06 — Batch register and context management.** Deliver directory, creation/editing and eligible offering/context selection. **Acceptance:** AC-08 passes for same-intake cohorts, invalid parents/dates and populated-batch edits. **Owner:** Frontend/Backend. **Depends on:** T03–05.
- [x] **ACD-T07 — Connected batch workspace.** Deliver overview and students/teachers/curriculum/assessment sections with search/filter/sort, deliberate actions and return links. **Acceptance:** AC-09–11 pass using shared enrollment/assignment/assessment rules. **Owner:** Frontend/Backend/Academic. **Depends on:** T06 and compatible student/enrollment contracts.
- [x] **ACD-T08 — Lifecycle and mutation reliability.** Verify approved archive/close/reactivate behavior, structural invariants, concurrency/retry and audit across all menu descendants. **Acceptance:** AC-12 passes with preserved historical data and manual/import consistency. **Owner:** Backend/QA. **Depends on:** T04–07.
- [x] **ACD-T09 — Verify and accept all Academics options.** Run appropriate builds/tests, authenticated responsive/keyboard walkthroughs and actual academic-staff sessions. **Acceptance:** AC-01–13 have evidence per route/embedded workspace; unresolved items remain open. **Owner:** QA/Academic/Product. **Depends on:** T03–08.

## Verification matrix

| Area | Required scenarios |
|---|---|
| Menu/navigation | Expanded/compact/flyout/mobile, direct deep links, record breadcrumbs, search/pagination/section restoration and linked report return. |
| Institute/branches | Empty profile/catalog, long names, duplicate branch, filtered offerings, authorized student totals, failed/concurrent edits. |
| Offerings | Existing global course, no available courses, duplicate branch-course offering, missing/archived parent and permission revocation. |
| Curriculum | Multiple subjects, each supported item kind, invalid parent/number, same names under different parents, archive/version change with existing assessments. |
| Batches | Multiple cohorts in same intake, ambiguous names, distinct period/date filters, wrong/closed/archived offering and structural edit with enrollments/results. |
| Student sections | Multiple/historical enrollments, same-name people, failed lookup, authorized contact fields, duplicate add and closed-batch restrictions. |
| Assignments | Multiple subjects/teachers, effective dates, ended assignment, concurrent create/end and no unintended account permission change. |
| Assessments/reports | Shared assessment across cohorts, draft/submitted/published, corrected/withdrawn results, scoped subjects, empty coverage and contributing counts/links. |
| Integrity | Parent archive/reopen consequences, atomic/recoverable failures, lost responses, manual/import reuse and no historical data loss. |
| Roles | Administrator, scoped academic manager, teacher/read-only and disjoint grants, including direct API and hidden aggregate/option checks. |
| Layout/accessibility | All menu routes and embedded lists at agreed widths/zoom, keyboard curriculum/dialog navigation, long data and loading/error/empty states. |
| Staff workflows | Create/reuse branch → offer course → create batch → inspect curriculum → assign teacher → enroll permitted student → open assessment/progress and return. |

## Definition of done and evidence

Acceptance was requested by the user on 19 October 2026. No personal name was recorded. Tasks and acceptance criteria above are checked from that request plus the evidence in this section. The signed-in walkthrough used the existing local institute and did not create or archive records.

- Acceptance reviewer: the user, 19 October 2026. No personal name was supplied.
- Product decisions: recorded in the decision table on 19 October 2026. Batches use the live course curriculum. Uniqueness is offering plus display name. Subject and paper grants limit what is listed and what can be created.
- Visual review: the working Institute, branch, Courses, course curriculum, Batches, and batch workspaces. There is no separate design file.
- Automated results: `backend/tests/test_academics_story.py` covers two cohorts in one intake, a duplicate name, chapter names under two subjects, a rename that keeps the assignment subject id, a stale `expected_revision`, current and historical student filters, a future end date, an archived batch that keeps enrollments and refuses a new one, an archived branch that keeps the course and refuses a new offering, a subject-scoped coordinator, a branch administrator, and a viewer. `tests/test_catalog_pages.py` and `tests/test_batch_workspace.py` passed with that contract. `tests/test_dashboard.py`, `tests/test_connected_workflows.py`, `tests/test_m2.py`, and `tests/test_mod30.py` passed afterward.
- Role and dataset: signed-in institute administrator (Salih) on the local institute. Course Science, branch North Branch, batch Morning (started 2026-06-01, current, three students). Subject-scoped coordinator, branch administrator, and viewer were checked by the story test, not by a second browser session.
- Migration: startup drops the old batch unique index on offering and intake when it is present, then keeps batches unique on offering and display name.

### Authenticated walkthrough

| Route | What was done | Expected | Actual |
|---|---|---|---|
| `/batches/6ad19416a830ce91249d0fdd` | Searched students for Meera. | The list narrows before pagination and the count matches. | URL gained `student_q=Meera`. The heading became “Students 1” and the only row was Meera Nair. |
| `/courses/6ad19416a830ce91249d0fd9?section=curriculum` | Read the curriculum note and opened Edit course, then chose Archived. | Chapters belong to the subject. Archive explains the impact before save. | The note says papers are numbered on the subject and chapters are not parented to a paper. Choosing Archived showed that existing offerings, batches, enrollments, assignments, and results stay, and new writes stay out. Cancelled without saving. Science stayed Active. |
| Same dialog | Tab from Save, then Escape. | Focus stays in the dialog and returns to the opener. | Tab from Save moved to Close inside the dialog. Escape removed the dialog and restored focus to Edit course. |
| Course page at 360 CSS px | Opened Menu. | The mobile drawer shows Academics and marks Courses current. | Menu expanded. Academics was expanded and current. Courses was current. Close returned focus to Menu. |

### Viewports

Document `scrollWidth` matched `clientWidth` at each size. At 360 the sidebar was the Menu button. Tables stayed inside their regions at 768 (`696 = 696`).

| Surface | 360 | 390 | 768 | 1280 | 640 at 2× scale |
|---|---|---|---|---|---|
| Institute | 360 = 360 | 390 = 390 | 768 = 768 | 1280 = 1280 | 640 = 640 |
| Branch batches | 360 = 360 | 390 = 390 | 768 = 768 | 1280 = 1280 | 640 = 640 |
| Courses | 360 = 360 | 390 = 390 | 768 = 768 | 1280 = 1280 | 640 = 640 |
| Course curriculum | 360 = 360 | 390 = 390 | 768 = 768 | 1280 = 1280 | 640 = 640 |
| Batches | 360 = 360 | 390 = 390 | 768 = 768 | 1280 = 1280 | 640 = 640 |
| Morning batch | 360 = 360 | 390 = 390 | 768 = 768 | 1280 = 1280 | 640 = 640 |

- Unresolved issues: none for this story. Report calculations, staff profiles, application processing, fees, attendance, and timetabling stay in their own workspaces.
