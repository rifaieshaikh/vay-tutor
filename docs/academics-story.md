# ACD-01 — Modern Academics navigation and management workspaces

Date: 19 October 2026 · Status: proposed; product decisions, design review and implementation pending.

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

## Decisions to confirm

| Decision | Recommended baseline / question |
|---|---|
| Menu structure | Retain Institute, Courses and Batches as primary entries. Branches live within Institute; offerings and curriculum are contextual. Confirm if a separate Branches entry is actually needed. |
| Relationships | Institute → branches; reusable courses → subjects/items; branch + course → offering → batches. Confirm existing denormalized IDs and uniqueness rules before changing contracts. |
| Default status scope | All authorized records initially; do not silently hide archived/closed records. Offer explicit Active/Current views and status filters. Confirm any intentional exception. |
| Status semantics | Distinguish archived catalog records, closed batches and historical enrollment/assignment periods. Define active/current date rules and institute timezone. |
| Archive/closure | Retain all history; do not silently remove descendants, end enrollments/assignments or withdraw assessments. Define new-write restrictions, reopen/reactivate permissions and impact previews. |
| Offering lifecycle | Reuse an existing course when offering it at a branch. Define duplicate prevention and whether ending an offering blocks only new cohorts or also other operations. |
| Curriculum semantics | Define subject/paper/chapter/module terminology and allowed parent relationships. Do not infer a chapter's parent paper or numbering rules from UI labels alone. |
| Curriculum changes | Reuse canonical curriculum; define whether existing batches use live curriculum or versioned snapshots, with impact on assignments, assessments and historical references. |
| Batch identity | Define uniqueness across offering, intake/session key and display name, including multiple schedules/cohorts for the same intake. Never merge distinct cohorts by name alone. |
| Batch period and schedule | Explicitly label intake period separately from start/end dates and timing text. Do not promise scheduling/conflict detection unless supported by actual rules. |
| Creation actions | Use bounded dialogs for simple branch/course/subject/item creation; fuller forms for complex batch/context setup. Preserve entered data and permitted defaults. |
| Access | Define branch/course/subject-level readers/managers, partial curriculum visibility and aggregate counts. Do not treat navigation visibility or a broad lookup permission as complete authorization. |

No proposed policy is accepted merely by creating this document. Resolve and record these decisions before dependent implementation; preserve historical completion records elsewhere.

## Acceptance criteria

### AC-01 — Coverage, contracts and design review

- [ ] Inventory every route above plus embedded offerings, students, subjects/items, assignments and assessments, recording existing UI/API support and missing capabilities.
- [ ] Resolve the decision table with owners; specify query/status/date/uniqueness/authorization contracts and necessary compatible migration/backfill checks.
- [ ] Review populated desktop/mobile designs for Institute, branch, Courses, course curriculum, Batches and batch workspace plus creation/edit/error states before application changes.
- [ ] Every existing Academics capability maps to a designed destination; modernization cannot silently remove management actions or historical records.

### AC-02 — Menu, orientation and continuity

- [ ] All three Academics menu entries and their descendants work in expanded sidebar, icon rail/flyout and mobile drawer modes; the active owning entry/group is identifiable.
- [ ] Breadcrumbs/document titles identify the actual institute/branch/course/batch, with useful loading fallbacks. Existing bookmarks work or have explicitly compatible redirects.
- [ ] Opening related records/sections and returning restores originating search/filter/sort/page/section state, including links from reports or Students where applicable.
- [ ] Detail context is derived from the record; a global filter cannot make one batch page appear to belong to another branch/course. Cross-record/report links carry meaningful supported scope only.

### AC-03 — Common filters, search and global sorting

- [ ] Every register and embedded list has a documented applicable search/filter/sort contract; irrelevant criteria are absent rather than repeated across all screens.
- [ ] Basic search stays visible. Filters opens a draft panel with Apply/Reset/Cancel, applied chips and Clear filters. Defaults show all authorized records under the agreed status policy, with no permanent four-dropdown bar.
- [ ] Branch/course/batch/intake/status/date criteria apply only where actual relationships support them. Changing parents clears incompatible descendants without dropping unrelated valid filters.
- [ ] Sorting is explicit and stable across the complete authorized filtered dataset before pagination; column headers and sort controls agree. Name/code/date/null behavior is documented.
- [ ] URLs, reload and Back/Forward restore applied state; counts/ranges reconcile. Loading/errors/no matches are distinct and stale requests cannot replace newer results.

### AC-04 — Institute and branch directory

- [ ] Institute profile is concise and separates permitted Edit institute from Add branch and directory actions; contact/location fields show meaningful labels and missing-value states.
- [ ] Branch directory supports name/code search where stored, explicit status and offered-course filters where supported, agreed name/creation sorts and pagination.
- [ ] Branch identity/status/offered-course summaries are readable; displayed totals respect scope and link to matching contributors rather than unfiltered catalog counts.
- [ ] Create/Edit branch validates actual required fields and normalized uniqueness without losing inputs; retries/concurrency cannot create accidental duplicate branches.
- [ ] Unauthorized users cannot edit institute/branch data or infer protected student/course totals through altered requests or linked summaries.

### AC-05 — Branch details and course offerings

- [ ] Branch workspace clearly separates Overview, Courses/Offerings, Batches and Students as appropriate; management forms appear only after explicit actions.
- [ ] Offer course selects an existing authorized global course, states branch context and prevents duplicate branch-course offerings server-side, including concurrent submissions.
- [ ] If the required global course is absent, provide a permitted contextual Create course path without nested modal chains, then return to the offering task with draft state intact.
- [ ] Offered-course and batch entries link to the correct canonical records; embedded lists provide relevant search/status/intake filters and sorting without retrieving a silently truncated fixed catalog.
- [ ] Branch student lists count people consistently, distinguish enrollment state and expose only authorized student/contact fields; their context agrees with the Students workspace.

### AC-06 — Courses register and workspace

- [ ] Course directory supports relevant name/code search, status and offered-branch filtering, agreed name/creation sorting and one row/count per canonical course.
- [ ] Course header distinguishes catalog state, curriculum and where offered; actions name their effect, including View performance and Manage application questions where permitted.
- [ ] Creating/editing a course preserves its identity and historical references; uniqueness/archive rules and concurrent changes produce actionable errors.
- [ ] Related offerings/batches are discoverable with scoped links and list return continuity. Empty states explain the next permitted action without imposing prerequisite manual setup on import workflows.
- [ ] Form configuration is not duplicated inside course curriculum; application answers and question history remain governed by Forms/Admissions rules.

### AC-07 — Subjects, papers, chapters and modules

- [ ] Curriculum displays navigable subject/item structure with visible selected context; staff can inspect/search relevant items without guessing a hidden dropdown selection.
- [ ] Creation labels and forms match the chosen kind and approved parent hierarchy; subject/course/paper numbering and uniqueness are validated server-side.
- [ ] Editing, reordering where supported, archiving/reactivation and moving items where explicitly allowed show affected relationships before mutation; unsupported operations are not presented as working.
- [ ] Linked assignments/assessments/results retain canonical references and historical interpretation after curriculum changes; version/snapshot policy is enforced rather than silently changing old records.
- [ ] Partial subject permissions filter nodes, options and counts without exposing hidden siblings or enabling creation under unauthorized parents.

### AC-08 — Batches register and creation/editing

- [ ] Directory shows batch name/reference, branch, course/offering, explicitly labeled intake, dates, schedule and defined current/closed/archive state without conflating these concepts.
- [ ] Search and relevant branch/course/intake/status/date filters plus agreed name/start/intake sorting work globally with stable pagination and permitted options.
- [ ] Batch creation selects/reuses a valid offering; parent defaults from branch/course entry points are visible and cannot imply permission. Missing offering creation follows an explicit authorized path.
- [ ] Date/session/name/schedule validation and approved uniqueness permit genuinely distinct same-intake cohorts while preventing accidental duplicate submissions; no unsupported timetable guarantees are implied.
- [ ] Editing a populated batch exposes consequences of structural/date/state changes, rejects stale updates and preserves historical enrollment/assessment links. Parent changes cannot silently relocate existing academic records.

### AC-09 — Batch overview and students

- [ ] Header identifies batch, branch, course, intake, schedule and state with useful current/authorized summaries; all applicable counts reconcile with contributing records.
- [ ] Overview/section navigation reaches Students, Teachers, Curriculum and Assessments directly, with URL section state and responsive behavior.
- [ ] Student list supports identity search, defined enrollment status/date filters and sorting; no match, no enrollments and failed load have distinct recovery.
- [ ] Add enrollment clearly distinguishes an existing student from a new applicant/admission path and follows the shared approved rules, not a second identity/enrollment implementation.
- [ ] Closed/archived batch restrictions apply in UI and API; pending mutations, duplicates, lost responses and permission changes are handled without duplicate identities/enrollments.

### AC-10 — Batch teachers and curriculum

- [ ] Teacher assignments show teacher, subject/paper, effective dates and current/ended status, with relevant search/status/subject filters and sorting.
- [ ] Assign teacher opens a bounded form using eligible authorized teacher/curriculum options; ending/revising an assignment preserves history and follows approved dates/overlap rules.
- [ ] Assignment creation or ending cannot implicitly grant account access; duplicate/concurrent submissions and failed saves are handled explicitly.
- [ ] Batch curriculum states whether it is course-owned live data or a specific version/snapshot. Editing links to the authorized owner and describes its approved impact.
- [ ] Hidden subjects/teacher details remain hidden through options, summaries and related links; closed-state behavior is consistently enforced.

### AC-11 — Batch assessments and reporting links

- [ ] Assessments list supports relevant title/status/subject/type/date criteria and global sorting, showing publication state and dates clearly.
- [ ] Create/Enter marks/Import actions are permission-aware, prefill only the appropriate visible batch context and reuse assessment workflows rather than duplicate creation logic.
- [ ] Shared assessments retain their actual eligible cohort relationships; listing under a batch never duplicates a student's canonical result.
- [ ] Marksheets, progress cards and academic-view links match authorized batch context, preserve return paths and retain active published-revision/coverage semantics.
- [ ] Empty assessment history offers the next permitted action; unsupported report scope or unavailable results are not presented as zero performance.

### AC-12 — Archive, closure and structural integrity

- [ ] Archive/close/reactivate/reopen operations have approved permissions and explicit impact summaries; they are separate from permanent deletion.
- [ ] Archiving a parent does not silently delete/archive children, terminate assignments/enrollments or withdraw published results. New-write restrictions follow the approved policy.
- [ ] Identity, uniqueness, offering and parent-child invariants survive concurrent creation/edit operations; UI defaults cannot bypass them.
- [ ] Mutations that span records are atomic or use an explicitly reviewed recoverable contract; retries cannot leave partial structure or create duplicates. Audit captures actor/context/meaningful before-after changes.
- [ ] Manual and import-driven creation use the same relevant canonical/authorization rules; canceled/failed imports do not remove pre-existing structure.

### AC-13 — Dialogs, notifications, accessibility and responsive design

- [ ] Short forms use task-specific dialogs with labeled primary/secondary actions; complex forms have sufficient workspace. No clipped text actions in icon-sized containers or nested modal workflows.
- [ ] Dirty state is protected across dismissals, section/route changes, history and refresh; failed saves retain draft input and field errors; pending actions prevent duplicate submission.
- [ ] Focus is meaningful, trapped/restored for modals, and visible; keyboard users can navigate sidebar, nested curriculum, lists and actions with correct semantics.
- [ ] Real success/error outcomes use shared notifications; actionable failures remain recoverable and important changes remain inspectable after a notice disappears.
- [ ] All routes/sections work at 360/390/768/1280 CSS pixels and 200% text zoom; necessary table scrolling stays within table regions, and color alone never communicates state.

## Execution tasks

- [ ] **ACD-T01 — Inventory and decide.** Map every Academics route/embedded list/API; confirm hierarchy, statuses, curriculum policy, uniqueness, permissions and query contracts. **Acceptance:** AC-01 contract checks pass; each pending decision has an owner and blocks dependent behavior. **Owner:** Product/Academic/Backend.
- [ ] **ACD-T02 — Review full-scope designs.** Produce linked desktop/mobile layouts for every menu destination and record, curriculum/offerings and dialogs, including empty/error/archived variants. **Acceptance:** user review is recorded and AC-01–13 map to reviewable behavior. **Owner:** Design/Product. **Depends on:** T01.
- [ ] **ACD-T03 — Shared academic queries and orientation.** Implement compatible authorized list/filter/global-sort/count APIs, shared controls, stateful links and menu orientation. **Acceptance:** AC-02–03 pass with multi-page fixtures and partial/disjoint grants. **Owner:** Backend/Frontend. **Depends on:** T01–02.
- [ ] **ACD-T04 — Institute and branch workspaces.** Deliver profile/directory/editing, offering management and branch-related batch/student lists. **Acceptance:** AC-04–05 pass including concurrent duplicates and scope-correct totals. **Owner:** Frontend/Backend. **Depends on:** T03.
- [ ] **ACD-T05 — Course and curriculum workspaces.** Deliver course register/detail, subject/item hierarchy and canonical relationship safeguards. **Acceptance:** AC-06–07 pass for long/empty/partially authorized curriculum and version/change impacts. **Owner:** Frontend/Backend/Academic. **Depends on:** T03–04.
- [ ] **ACD-T06 — Batch register and context management.** Deliver directory, creation/editing and eligible offering/context selection. **Acceptance:** AC-08 passes for same-intake cohorts, invalid parents/dates and populated-batch edits. **Owner:** Frontend/Backend. **Depends on:** T03–05.
- [ ] **ACD-T07 — Connected batch workspace.** Deliver overview and students/teachers/curriculum/assessment sections with search/filter/sort, deliberate actions and return links. **Acceptance:** AC-09–11 pass using shared enrollment/assignment/assessment rules. **Owner:** Frontend/Backend/Academic. **Depends on:** T06 and compatible student/enrollment contracts.
- [ ] **ACD-T08 — Lifecycle and mutation reliability.** Verify approved archive/close/reactivate behavior, structural invariants, concurrency/retry and audit across all menu descendants. **Acceptance:** AC-12 passes with preserved historical data and manual/import consistency. **Owner:** Backend/QA. **Depends on:** T04–07.
- [ ] **ACD-T09 — Verify and accept all Academics options.** Run appropriate builds/tests, authenticated responsive/keyboard walkthroughs and actual academic-staff sessions. **Acceptance:** AC-01–13 have evidence per route/embedded workspace; unresolved items remain open. **Owner:** QA/Academic/Product. **Depends on:** T03–08.

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

Every Academics menu option and descendant in the scope has individually verified acceptance coverage. Record route, role, dataset, viewport, expected/actual behavior, relevant test commands/results and authenticated screenshots without unnecessary private student data. Reconcile canonical entities, enrollments, assignments and results before/after changes. Developer walkthroughs do not substitute for actual staff/user acceptance. No new route, curriculum policy or archive cascade is implicitly approved by this document; unresolved criteria keep the story open.

- Named owner / acceptance reviewer: unassigned.
- Policy/query/hierarchy decisions and migration needs: pending.
- User-reviewed designs for every workspace: pending.
- Implementation references and test results: pending.
- Staff review and unresolved issues: pending.
