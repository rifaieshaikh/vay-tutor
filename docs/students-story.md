# STU-01 — Modern student directory and record workspace

Date: 19 October 2026 · Status: recommended baselines are implemented. Staff design review and acceptance are still open.

## User story

As institute staff, I want to find a student quickly and manage their personal information, enrollments and published progress from a clear record workspace, so I can finish daily tasks without duplicate identities, scattered information or lost history.

## Scope and boundaries

Modernize the Students directory and student detail, including search/filter/sort, overview, profile editing, previous education, enrollments/transfers, progress, source admissions and activity. Use shared interaction patterns from the [modern UI plan](modern-ui-task-list.md) and preserve relationships with [Enquiries](enquiries-story.md) and [Admissions](admissions-story.md).

The current implementation already has distinct students in the directory, multiple record sections, enrollment operations and merge preview. Inspect and reuse them where appropriate; do not claim these features are absent or accepted without verification. Preserve student IDs/codes, aliases, photos, enrollment/result history, source answers and permissions.

This is a design/execution story, not authorization to start application changes before the design discussion is resolved. No new fees, attendance, parent portal, predictive risk scoring or standalone student-import workflow is included. Application import creates applications; marksheet import retains its existing authorized identity-resolution path. Enrollment creation remains governed by the agreed admission/direct-enrollment policies.

## Proposed experience

### Directory

- Compact Students header with permission-aware contextual actions. Avoid a misleading Add student button if the actual operation is Create admission or Enroll an existing student.
- Default all authorized students, with one row per canonical person. No permanent Branch/Course/Period/Batch bar and no repeated Enquiry/Admission/Student module tabs.
- Inline search; compact Filters panel; separate labeled Sort control; applied chips, count and pagination.
- Prioritize name/code, authorized contact if appropriate, current-enrollment summary and clearly labeled person status. Keep historical dates and secondary actions out of the main scan path.
- Multiple current enrollments appear as a concise summary with access to the full record. Person status and enrollment status are separate concepts.

### Record workspace

- Compact header: portrait/initials, name, student code, person status, relevant enrollment summary, labeled Edit profile and permission-aware actions.
- Overview: key permitted information, current enrollments, relevant next actions and a clearly scoped published-progress summary where useful.
- Personal information: contact, guardian/address and ongoing profile answers.
- Previous education: qualifications separate from current institute performance.
- Enrollments: current/history, dates, linked batch/course/branch and explicit Add enrollment/Transfer actions where allowed.
- Progress: deliberate enrollment/period selection where necessary, published results, coverage and links to progress cards/marksheets.
- Admissions: source applications, related enquiries and historical application answers in their proper context.
- Activity: readable audited changes, actors and dates. Use available history; do not fabricate missing actors or silently expose protected before/after values.
- Use section navigation suited to content volume; do not force every section into an overflowing row of tabs. Preserve selected section and meaningful record context in URLs.

## Decisions to confirm before implementation

| Decision | Recommended baseline | Required clarification |
|---|---|---|
| Canonical identity | One institute student identity; multiple enrollments over time. | Preserve prospect/application links; no name/shared-phone auto-merge. |
| Person status | Archived is separate from currently enrolled, historical or unenrolled. | Define archive/reactivate effects on current enrollments and permissions; do not silently end enrollments. |
| Default directory | All authorized non-archived students, with an explicit Include archived filter. | Confirm this default; it is a proposal and differs from showing every authorized archive by default. Clear filters restores the approved documented baseline. |
| Creation entry point | Create admission for a new applicant; Add enrollment for an existing student. | Confirm exceptional direct/student creation paths and minimum requirements already permitted by the product. |
| Multiple enrollments | One directory row/count per person; summary reflects applied scope. | Decide summary order and wording when several enrollments match, without implying hidden enrollments do not exist. |
| Status/date filters | Define Current, Historical and No matching enrollment precisely. | Agree date boundaries, institute timezone, closed-batch treatment and distinction between batch intake period and enrollment dates. |
| Profile edits | Explicit corrections with audit history and safe concurrency. | Decide name/code mutability, alias behavior and which fields different staff may view/edit. |
| Transfer | Operate on one selected enrollment with explicit effective date and target batch. | Confirm same-course/cross-course policy, overlap/gap rules, closed-batch handling and retained results. No historical score reassignment by accident. |
| Merge | Advanced restricted operation with impact preview and explicit confirmation. | Define conflicts, source archive/redirect behavior, audit and recoverability; do not introduce a merge recommendation based only on a shared phone/name. |
| Progress | Authorized active published revisions only; label enrollment/period/coverage. | Decide multi-enrollment default and comparability rules; no unqualified cross-course average. |
| Historical answers | Application snapshots stay with source admissions; ongoing profile fields remain clearly separate. | Define explicit reconciliation when approved personal details differ; never silently overwrite all records. |

## Accepted contract

The requester asked for this story to be completed on 19 October 2026. These rules are now what the application enforces:

- One student identity can have many enrollments. Shared name or phone never merges records by itself.
- Archive and reactivate change only the person status. They do not end enrollments or remove results. A merged source stays archived. A reason is required.
- The directory defaults to authorized non-archived students. Include archived is explicit. Clear filters restores that default.
- Current means the applied branch, course, batch, and intake period contain an enrollment that has not ended. Historical means every enrollment in that scope has ended. No matching enrollment means the person is authorized and has no enrollment in that scope. Intake period is the batch session, not the enrollment dates. A closed batch does not by itself end an enrollment.
- A transfer ends the selected enrollment and starts the new one on the same effective date, after a preview and a reason. Results stay on the previous batch. Repeating the same idempotency key does not create a second enrollment.
- Merge requires a preview and explicit confirmation. It cannot be undone from the screen. Enrollments that already exist on the student who is kept stay on the archived source.

## Acceptance criteria

### AC-01 — Reviewed design and contracts

- [ ] Resolve the decision table with named owners; unaccepted proposals block dependent implementation rather than becoming silent defaults.
- [ ] Produce populated desktop/mobile directory, overview, profile-edit, enrollments/transfer, progress and source-admission designs with loading/empty/error variants. Record user design review before coding.
- [ ] Map current APIs/permissions and missing query/record contracts; document canonical identity, person versus enrollment status, date semantics and concurrent-edit behavior.
- [ ] Existing student IDs/codes, names/aliases, photos, source links, enrollments and result revisions reconcile before/after any necessary migration.

### AC-02 — Professional person directory

- [ ] Render one row per student and count distinct people, including when several enrollments match a filter; no row-span expansion turns the directory into enrollment history.
- [ ] Name and code identify the record; enrollment summary and status are readable with long names/multiple enrollments and explain the applied scope.
- [ ] Default and Clear filters follow the approved archive policy, within authorized scope. A status badge never confuses person archive state with enrollment status.
- [ ] Primary/contextual actions name their true operation and follow permissions; advanced merge is not presented as a routine primary action.
- [ ] Loading, no students, no filter matches, unavailable access and load failure are distinct; failures offer Retry without showing false zero counts.

### AC-03 — Search, filters, sorting and continuity

- [ ] Document and implement search for name, student code, aliases and permitted contact fields. Sensitive/contact search is limited by server permissions, including aggregate/match behavior.
- [ ] Filters provide applicable branch/course/batch, explicitly named intake period, person archive state and defined enrollment-status/date criteria. Do not display unsupported fields.
- [ ] No duplicate global/local scope bars. Panel drafts commit only on Apply; Cancel preserves results; Reset clears the draft until applied; chips/removal/Clear filters follow defined dependencies.
- [ ] Sort offers name/code and other explicitly agreed fields such as creation date. Each field has direction, stable unique tie-breaker and defined null/text/date rules, applied before pagination.
- [ ] Parent changes clear incompatible descendants, preserve unrelated search and reset pagination. Global counts/IDs/order reconcile with direct authorized API requests.
- [ ] URL reload, Back/Forward and record return restore committed search/filter/sort/page. Selected record section persists; out-of-order responses cannot replace the latest view.

### AC-04 — Header, overview and section navigation

- [ ] Header immediately identifies student/code/person status and relevant enrollment context, with purposeful labeled actions rather than a mixed strip of tiny text/icon buttons.
- [ ] Overview links to current enrollments, source admissions and progress where permitted without duplicating the full content of every section.
- [ ] Prior qualifications, institute progress, application answers, personal fields and activity are separately located and labeled.
- [ ] Section links/tabs are keyboard accessible, deep-linkable and usable on narrow screens; changing sections preserves record identity and relevant context.
- [ ] Not-found/out-of-scope responses follow existing disclosure policy; failed record fetch shows recovery without rendering a stale different student.

### AC-05 — Personal information and safe editing

- [ ] Personal/contact/guardian/address and ongoing profile fields are grouped meaningfully; absent optional values are concise and not mistaken for validation errors.
- [ ] Permitted edits follow explicit name/alias/code rules and preserve historical references; a shared prospect/student link never silently overwrites unrelated source snapshots.
- [ ] Field errors are associated with inputs, failed saves retain values and concurrent changes receive an explicit conflict/recovery path.
- [ ] Dirty forms are protected on Close/Cancel/Escape/outside click, route/section change, browser Back and refresh as applicable. Unchanged forms do not prompt.
- [ ] Pending save/photo operations prevent duplicate submission; invalid photo type/size and failed uploads are recoverable. Portraits have appropriate alternative text/fallbacks.
- [ ] Before/after audit and notifications accurately describe confirmed changes; a failed operation cannot show success.

### AC-06 — Enrollment management

- [ ] Separate current and historical enrollments with course, branch, batch, dates and explicit state; names link to the correct authorized workspace.
- [ ] Add enrollment for an existing student uses eligible authorized options and approved admission/direct-entry rules; closed/wrong-course/invalid contexts cannot pass by altering requests.
- [ ] Editing dates validates the agreed temporal rules; a display-only change cannot silently erase historical periods or result attribution.
- [ ] Same-student/same-batch duplicates, concurrent submissions and lost responses have defined idempotent handling. No new student identity is created for another enrollment.
- [ ] Each row offers relevant labeled actions with consistent sizing, explicit enrollment context and no clipped text inside icon-sized containers.

### AC-07 — Transfer workflow

- [ ] Transfer identifies the source enrollment, target branch/course/batch allowed by policy, effective date and reason before confirmation.
- [ ] Preview states the source end/target start dates, overlap/gap consequences and historical-result behavior. Incompatible/closed/unauthorized targets are rejected with actionable feedback.
- [ ] Backend atomically enforces agreed source/target changes; retry/concurrent attempts cannot create duplicate targets or leave the source ended without its required target.
- [ ] Failed transfer retains selections/input; completed transfer refreshes both current/history views with correct links and an audited outcome.
- [ ] Existing assessment/student identity and published revisions remain intact; historical scores are not silently moved to the new batch.

### AC-08 — Progress and results

- [ ] Progress explicitly identifies enrollment/course, period, applicable policy and coverage; multiple enrollments require a meaningful selected scope rather than an unexplained combined percentage.
- [ ] Only authorized active published results contribute; missing/absent/scored-zero and no-results states remain distinct according to existing academic rules.
- [ ] Source marksheets, progress cards and any supported export open with matching scope and contributing results; unrelated/hidden subjects never appear through totals.
- [ ] No comparable cross-course/batch metric is invented; incomplete participation or missing roster data is labeled rather than interpreted as absence.
- [ ] Loading, failed computation/request and no published results have distinct recoverable presentations; drafts/corrections retain existing revision guarantees.

### AC-09 — Admissions, previous education and activity

- [ ] Prior qualifications are readable independently of current progress and preserve source context where recorded.
- [ ] Applications/enquiries link to the correct source; historical question labels/values remain understandable after retirement or course changes.
- [ ] Application answers appear with their originating application/course, while explicitly ongoing profile answers appear in Personal information.
- [ ] Activity displays meaningful actor/time/change summaries with permission-filtered values, explicit gaps in historical data and appropriate pagination where needed.
- [ ] Navigating to a source record and back restores the student section and originating directory/batch return path without unsafe arbitrary redirects.

### AC-10 — Archive/reactivate and merge safeguards

- [ ] Archive/reactivate follows the approved policy, with explicit effect summary, reason where required, authorization and audit. It is not deletion and does not implicitly cancel enrollments/results.
- [ ] Merge is restricted and requires choosing source/survivor, a current impact/conflict preview and explicit confirmation; no name/phone-only automatic merge.
- [ ] Preview accounts for enrollments, aliases, admissions/prospect links, results/revisions and conflicting values; revalidate references/permissions and concurrent changes at commit.
- [ ] Merge outcome preserves history and resolves source links according to the approved archive/redirect policy. Retry cannot duplicate data and errors cannot leave partial identity reassignment.
- [ ] Explain recoverability before committing; do not promise Undo unless a verified reversal path exists. If merge policy is unresolved, retain existing protections and leave this slice unaccepted.

### AC-11 — Shared dialogs, notifications and accessibility

- [ ] Use bounded dialogs for date edits/transfers/confirmations and adequate dedicated editing space for long profiles; no nested modal chains or duplicate module navigation.
- [ ] Modal focus is set/contained/restored, background is inert and controls have visible focus/accessible names; keyboard-only directory-to-record workflows succeed.
- [ ] Success/error/info notifications follow real outcomes; timed notices pause on hover/focus, actionable errors persist and field errors remain beside fields.
- [ ] At 360/390/768/1280 CSS pixels and 200% text zoom, identifying text and actions remain reachable without unintended document overflow; tables scroll within their own regions where necessary.
- [ ] Color is not the only status indicator; contrast, long text, missing photos, many enrollments and permission-restricted variants are verified.

## Execution tasks

- [ ] **STU-T01 — Confirm policies and map current behavior.** Inventory directory/detail/embedded lists, permissions, identity/status/date rules and API gaps; resolve the decision table and migration needs. **Acceptance:** AC-01 contract/policy checks pass with named owners and explicit unresolved blockers. **Owner:** Product/Academic/Backend.
- [ ] **STU-T02 — Design and review.** Prepare populated desktop/mobile directory, overview, editing, enrollment/transfer, progress/admission/history and error/empty states. **Acceptance:** user design review is recorded and every AC has defined visual/interaction behavior. **Owner:** Design/Product. **Depends on:** T01.
- [ ] **STU-T03 — Deliver directory queries and shared list UI.** Implement relevant search/filters/global sort/counts/pagination and URL/return behavior. **Acceptance:** AC-02–03 pass using multi-page fixtures with multiple enrollments, archived and restricted students. **Owner:** Frontend/Backend. **Depends on:** T01–02.
- [ ] **STU-T04 — Deliver record structure and profile editing.** Build header/overview/sections, grouped personal/prior-education/source information and safe profile/photo operations. **Acceptance:** AC-04–05 and AC-09 pass, including conflicts and permission-restricted values. **Owner:** Frontend/Backend. **Depends on:** T03.
- [ ] **STU-T05 — Deliver enrollment and transfer workflows.** Implement eligible selections, explicit temporal policy, contextual actions and atomic/recoverable mutations. **Acceptance:** AC-06–07 pass in UI and direct APIs without duplicate identities/enrollments or historical-result reassignment. **Owner:** Frontend/Backend/QA. **Depends on:** T04 and compatible Admissions/enrollment contracts.
- [ ] **STU-T06 — Deliver scoped progress.** Connect published progress/results/card links and supported exports to explicit enrollment/period context. **Acceptance:** AC-08 passes with multi-course, missing-result, revised and scoped-subject fixtures. **Owner:** Frontend/Backend/Academic. **Depends on:** T04–05.
- [ ] **STU-T07 — Verify lifecycle and advanced identity operations.** Implement only approved archive/reactivate/merge changes, retaining compatible existing protections. **Acceptance:** AC-10 passes with conflicts, permissions, concurrency and source-link recovery tests; unapproved merge changes stay blocked. **Owner:** Backend/QA/Product. **Depends on:** T01–06.
- [ ] **STU-T08 — Validate and accept.** Run relevant frontend/backend checks, authenticated responsive/keyboard walkthroughs and staff sessions; reconcile identities/enrollments/results before and after changes. **Acceptance:** AC-01–11 have linked evidence, blockers are retested and actual staff acceptance is recorded separately from developer checks. **Owner:** QA/Academic/Product. **Depends on:** T03–07.

## Verification matrix

| Scenario | Required checks |
|---|---|
| Directory | One person with several current/past enrollments, distinct counts, scoped summaries, archived baseline and No matching enrollment semantics. |
| Queries | Search name/code/alias/permitted contact, combined filters, date boundaries, stable multi-page sorting, no match, failed/stale responses and URL/Back/return state. |
| Identity | Shared names/phone, linked prospect/applications, returning student, original code/alias preservation and no automatic duplicate merge. |
| Editing | Optional fields, changed name/alias, custom question retirement, failed save/photo upload, concurrent changes, dirty navigation and repeated clicks. |
| Enrollment/transfer | Wrong/closed target, date overlap/gap, multiple courses, existing same-batch enrollment, revoked grants, concurrent/retried mutation and retained results. |
| Progress | Multiple enrollments, no published results, missing/absent/zero, changed active revision, hidden subjects, coverage and matching drill-down/export. |
| Lifecycle/merge | Archive/reactivate effects, source/survivor conflict, preview becoming stale, preserved links/history and atomic failure/retry behavior. |
| Roles | Administrator, scoped teacher, student manager and read-only staff; hidden contact/history and direct API denial including aggregate leakage. |
| Interaction | Desktop/mobile, keyboard, text zoom, many enrollments, long names, missing data, accessible dialogs/notifications and return from source records. |
| Staff tasks | Find a student, edit permitted details, add/transfer enrollment, inspect published progress and find the source admission without developer guidance. |

## Definition of done and evidence

All accepted criteria and tasks pass with evidence. Run appropriate builds/backend checks and meaningful tests for query correctness, scope, concurrent mutations and historical integrity. Retain authenticated screenshots/checklists identifying route, role, dataset, viewport and expected/actual behavior without unnecessarily sharing private student data. Record actual staff acceptance separately from developer walkthroughs. Unverified or unresolved policy slices remain open; appearance alone does not close the story.

- Named owner / acceptance reviewer: unassigned.
- Product decisions and compatibility contracts: pending.
- User-reviewed designs: pending.
- Implementation references and test results: pending.
- Staff review, migration reconciliation and unresolved issues: pending.
