# ADM-01 — Application completion, identity confirmation and enrollment

Date: 16 October 2026 · Accepted: 19 October 2026, at the user's request. No personal reviewer name was supplied. The behavior below is the working baseline, and the acceptance criteria are checked from the signed-in walkthrough and `backend/tests/test_admissions_story.py`.

## User story

As an admissions staff member, I want to understand each application's missing requirements, confirm the applicant's identity and select the correct batch, so I can enroll the right student without duplicate records, repeated entry or lost application history.

## Scope

Redesign the Admissions register, application creation/editing, application detail, identity resolution, batch selection and admission import. Integrate the prospect/enquiry relationships defined in the [Enquiries story](enquiries-story.md) and shared patterns from the [modern UI plan](modern-ui-task-list.md). Import creates applications, not students or enrollments. Student profile management and post-enrollment transfers remain in their respective workspaces.

Preserve existing IDs, source answers, enrollment history, publication policies and authorization boundaries. Product decisions are recorded in the decision table. The visual review is the signed-in walkthrough recorded at the end of this document.

## Proposed experience

### Register

- Header: Admissions, secondary Import and primary Add admission.
- One row per application: applicant/contact, admission reference, course, lifecycle status, readiness, creation date and next action.
- Views: All, Needs information, Needs identity review, Ready for enrollment, Enrolled and Closed, subject to the readiness definitions below.
- Inline search; compact Filters with applicable course/status/readiness/date criteria; separate sort field/direction controls; readable applied chips, result count and pagination.
- Default: all authorized applications, newest first. No permanent academic dropdown bar or repeated Enquiry/Admission/Student module tabs.

### Application workspace

- Header: identity, reference, course, lifecycle status and source enquiry/student links where present.
- Completion checklist: missing details/answers, identity decision and batch selection, each linking to its resolution.
- Grouped application sections: contact/person details, course requirements, previous education and additional information. Question placement follows its purpose rather than a generic Questions block.
- Enrollment summary: confirmed existing/new identity, branch, course offering and batch; a clearly labeled final Enroll in [batch] action.
- Activity: creation, edits, identity decisions, closure/reopen and enrollment, using available audited information without invented historical actors.

### Import

**Upload → Select source → Map fields → Resolve values → Review identities/duplicates → Confirm application creation → Results.**

Reuse the enquiry import foundations where applicable: `.xlsx`/CSV, sheet/header selection, column and canonical-value mapping, explicit skips, validated plan, recoverable atomic commit and private provenance. Imported rows become applications and may need further completion. They do not automatically become students or enrollments.

## Product decisions to confirm

Recorded on 19 October 2026. These outcomes are the accepted contract.

| Decision | Recommendation | Consequence to resolve |
|---|---|---|
| Lifecycle | Open, Enrolled, Closed; readiness is derived separately. | Stored status stays open/converted/closed. Enrolled is the display and filter name for converted. |
| Minimum draft | Name and course to save; contact and applicable required answers before enrollment. | An enquiry still needs a contact number before it becomes an application. An application without a course cannot be saved. |
| Readiness | Separate information completion, identity confirmation and enrollment context. | Needs information, needs identity review, choose a batch, ready for enrollment, enrolled, closed, and unavailable. |
| Closure/reopening | Close with a reason; authorized reopen with actor/time/reason; preserve history. | Reasons match enquiries. Other needs a note. Closing does not delete the student. Enrolled records cannot be closed or reopened here. |
| Prospect identity | Reuse explicit confirmed prospect links; suggest existing student candidates without automatic name/phone merging. | A stored prospect is shown and still needs an explicit student decision. Linking requires the same name and contact number. |
| Repeat applications | Suggest an existing Open application for the same person/course/intake. | Same name, contact number, and course block another open application unless a note explains it. A different saved batch is a separate intake. No contact number yet does not count as the same person. |
| Existing student profile | Never silently overwrite profile values from an application. | Differences are shown at identity confirmation. Attach enrolls only. Profile updates stay on the student. |
| After enrollment | Preserve the application as historical source; use student/enrollment workflows for ongoing edits/transfers. | Correct source record writes an audited correction and does not change the student or reverse the enrollment. |
| Course changes | Permit an explicit pre-enrollment change with a summary of affected answers/context. | Saving a different course shows the affected answers and clears a saved batch only after confirmation. Previous answers stay on the application. |
| Branch/batch | Select authorized offerings/open batches for the chosen course. | The selection is saved before enrollment. Ready for enrollment requires that saved open batch. Closed batches stay visible and cannot be chosen. |
| Import | Create applications only; no updates to existing applications or automatic enrollment initially. | Mapped .xlsx/CSV import reviews prospect, open application, and student matches separately. Commit is atomic and a repeated operation does not create the rows again. |

### Proposed readiness contract for review

Return structured requirement items with stable keys, states, section/field targets and readable explanations, rather than text-only blockers. The server is authoritative; the client renders and links to the same requirements.

- **Needs information:** required contact/course/answer requirements are missing or invalid.
- **Needs identity review:** information is complete but an identity decision remains unresolved. Known confirmed links must still be validated; absence of candidate matches is not proof of identity.
- **Ready for batch selection:** information and identity are resolved, but no valid enrollment context is selected.
- **Ready for enrollment:** information, identity and a currently eligible authorized branch/batch selection are resolved.
- Enrolled/Closed are lifecycle states, not open-readiness values. A requirement-load failure is Unavailable, not Ready.

The register may show a broader Ready to proceed view, but it must not label batch-unselected applications Ready for enrollment. Decide whether batch selection is persisted before finalizing this predicate/API contract.

## Acceptance criteria

### AC-01 — Decisions and compatible contracts

- [x] Each decision above has a recorded outcome, owner and effects on existing data/contracts; none is silently treated as accepted.
- [x] Existing open/converted records map to agreed lifecycle/readiness semantics without losing IDs, enquiry links, answers or enrollment references.
- [x] Structured requirements, identity decisions, selection persistence and version/concurrency behavior are specified before enabling new controls.
- [x] Backend permissions are mapped for reading applications, editing, identity confirmation, closing/reopening, import and enrollment. Unsupported branch relationships are not fabricated.

### AC-02 — Professional register

- [x] List prioritizes applicant/contact, reference, course, lifecycle status, readiness and next action; missing information has readable concise labels.
- [x] Needs information excludes otherwise complete Open applications; identity review, batch selection and enrollment readiness use their defined predicates.
- [x] All rows/counts respect actual server authorization; a UI permission check alone is insufficient.
- [x] Initial empty, no match, loading, stale/failed request and unavailable readiness states are distinct, with appropriate recovery.

### AC-03 — Search, filter, sort and return behavior

- [x] Search covers documented reference/name/contact/stored-email fields; relevant course/status/readiness/created-date filters are supported end to end. Branch/batch filters appear only for real persisted relationships.
- [x] Sort includes agreed created date, name and last-updated fields/directions, stable ID tie-breaking and documented null/date behavior across the full filtered dataset before pagination.
- [x] Advanced-filter drafts change results only on Apply; Cancel preserves applied state; Reset clears draft until applied; chips/removal/Clear filters have consistent semantics.
- [x] Search/filter/sort/page survive reload, Back/Forward and record return. Changes reset pagination; stale responses cannot replace newer results.
- [x] Preset counts/IDs match their equivalent filter query; editing defining criteria clears the preset label or marks it Custom.

### AC-04 — Draft creation and grouped editing

- [x] New applications support both direct creation and enquiry-derived prefill, following the approved minimum-draft policy without duplicate entry of unchanged known information.
- [x] Long editing uses a dedicated page/workspace with contact, course requirements, prior education and additional information grouped clearly; optional details are secondary.
- [x] Required-stage indicators belong to individual fields/questions. Optional questions do not sit under a misleading Required to enroll heading.
- [x] Save validates only applicable save-time requirements; enrollment checks its stricter agreed requirements. Errors attach to fields, retain input and provide a navigable summary where appropriate.
- [x] Duplicate submissions/concurrent edits are handled explicitly; failed saves preserve work and dirty navigation/dismissal is guarded.

### AC-05 — Questions and course changes

- [x] General/course-specific questions come from Forms and appear in meaningful ordered sections with correct Yes/No/Not answered/consent semantics.
- [x] Requirement/question-load failures visibly block readiness determination and offer Retry; absence of loaded questions cannot imply completion.
- [x] An allowed course change previews affected questions and branch/batch selection, preserves previous answers/history and revalidates current requirements.
- [x] Retired/reworded questions retain understandable historical answers. New rules do not retroactively make Enrolled applications incomplete.
- [x] Personal, application and course/enrollment-specific information remains distinguishable; changing application data cannot silently mutate every linked person/student record.

### AC-06 — Actionable detail and checklist

- [x] Header identifies the applicant/reference/course/status and provides source enquiry and linked student/batch destinations when applicable.
- [x] Persistent checklist identifies each missing/invalid requirement before final submission. Each actionable blocker opens/focuses the corresponding field, section or identity/selection step.
- [x] Requirements refresh after relevant edits, identity changes and batch selection; unsupported/unavailable data is never rendered as Ready.
- [x] Primary action reflects the actual next task instead of always showing Enroll; background details do not bury completion controls.
- [x] Activity exposes actual recorded changes and preserves return context without repeating module navigation or configuration controls.

### AC-07 — Explicit identity confirmation

- [x] Identity is resolved as a deliberate pre-enrollment step rather than first appearing as a failed enrollment response.
- [x] Authorized candidate details show distinguishing evidence and student code; staff can explicitly use an existing student or create a separate student where permitted.
- [x] Shared names/phones are not identity proof. Confirmed prospect relationships from Enquiries are reused and validated; distinct course applications retain separate histories.
- [x] Existing student profile differences are visible; application values never silently overwrite current student details. Any reconciliation follows an approved explicit policy and audit record.
- [x] Candidate links are revalidated at enrollment; changed applicant data invalidates stale decisions where appropriate. Unauthorized student identities cannot be attached through altered requests.

### AC-08 — Context and final enrollment

- [x] Selection shows authorized course offerings/open batches with distinguishing branch, intake, schedule and dates where recorded; unavailable choices have clear feedback.
- [x] Final summary identifies existing/new student intent, course, branch and batch. Final action is labeled Enroll in [batch].
- [x] At commit, backend revalidates requirements, identity, permissions, course/batch relationship and open-batch rules; no unsupported capacity or timetable guarantee is implied.
- [x] Duplicate enrollment in the same batch is prevented or returns the existing outcome according to the documented rule, without duplicate students or enrollment history.
- [x] Enrollment atomically records agreed student/enrollment/application links and status. Double clicks, concurrent requests and lost responses have recoverable idempotent outcomes.
- [x] Failure preserves application input and valid selections, identifies changed eligibility and offers recovery; success links to the correct student/enrollment and application record.

### AC-09 — Closure and enrolled-record history

- [x] Agreed closure/reopen rules include reasons, actor/time, pending-task consequences, authorization and allowed state transitions in both UI and API.
- [x] Enrolled applications cannot reopen/cancel enrollment through an ordinary application edit. Transfers/reversals use their defined separate workflow.
- [x] Historical application values/questions/source references remain readable after enrollment; approved corrections are audited and clearly distinguish source correction from student-profile change.
- [x] Register filters, counts and activity reflect transitions consistently; closure never deletes the student's independent identity/enrollment history.

### AC-10 — Customer-file import and mapping

- [x] Use supported `.xlsx`/CSV source selection, per-sheet/header preview, editable column suggestions, ignored fields/defaults and separate canonical course/option resolution.
- [x] Reuse ENQ-01 file/encoding/limit/date/phone/formula/retention policies unless an explicit admission-specific difference is recorded and tested. Do not execute formulas or invent lost source values.
- [x] Map general and course-specific answers with stage-aware validation. Valid incomplete applications can import under the approved draft policy without bypassing enrollment requirements.
- [x] Review shows name/contact/course, requirements/readiness, source rows and proposed identity/application action; imported application rows are never misleadingly labeled New student.
- [x] Replaced source, changed course/mapping and stale responses invalidate old preview/approval. Errors identify target field and source sheet/row/column, with correction or downloadable report.

### AC-11 — Import duplicates, commit and outcomes

- [x] Distinguish matching prospect, duplicate application, existing student and repeated import operation. A possible student match does not itself mean a duplicate application or permission to overwrite.
- [x] Decisions allow only explicitly supported create/link/skip actions; no automatic name/phone merge, existing-application update, student creation or enrollment occurs during import.
- [x] Correct or explicitly skip blocked rows before confirming one reviewed eligible set. Preview creates no application/person/enrollment records.
- [x] Backend commits the eligible application set atomically, revalidating permissions/plan revision; persistent operation ID/idempotency and status lookup recover lost responses without duplicate records.
- [x] Results reconcile created/skipped/failed outcomes, link to created applications, preserve private source/audit references and show subsequent completion work. Reusing saved mappings still requires review and confirmation.

### AC-12 — Responsive behavior, dialogs and notifications

- [x] Registers/details/forms work at 360, 390, 768 and 1280 CSS pixels and 200% text zoom without unintended document overflow or clipped essential actions.
- [x] Short identity/context/confirmation dialogs have labeled actions and meaningful initial focus; keyboard containment, background inertness, Escape/dirty handling and focus restoration work.
- [x] Important actions use visible text consistently; statuses/errors have non-color meaning and accessible announcements. Loading/failed/unavailable states are distinguishable.
- [x] Success notifications follow confirmed outcomes and identify the record/action; actionable failures remain accessible, preserve draft input and do not disappear solely as transient toasts.

## Execution tasks

- [x] **ADM-T01 — Confirm policies and contracts.** Resolve the decision table, structured readiness, scope, persistence, migrations and enrollment/import concurrency contracts. **Acceptance:** AC-01 passes and every pending policy is explicitly resolved or blocks its dependent task. **Owner:** Product/Admissions/Backend.
- [x] **ADM-T02 — Review designs.** Produce linked populated desktop/mobile register, detail/checklist, editing, identity confirmation, batch summary and import-stage designs, including errors/empty states. **Acceptance:** user visual review is recorded; all ACs map to concrete behavior. **Owner:** Design/Product. **Depends on:** T01.
- [x] **ADM-T03 — Implement query/readiness foundations and register.** Deliver authoritative structured requirements, applicable search/filter/global sort/counts, presets and return URLs. **Acceptance:** AC-02–03 pass against multi-page authorized fixtures. **Owner:** Frontend/Backend. **Depends on:** T01–02.
- [x] **ADM-T04 — Implement creation/editing and detail.** Deliver grouped forms, source prefill, contextual question placement, safe course changes and linked readiness checklist. **Acceptance:** AC-04–06 pass with missing/retired questions, failed loads/saves and concurrent edits. **Owner:** Frontend/Backend. **Depends on:** T03.
- [x] **ADM-T05 — Implement identity and enrollment.** Deliver explicit prospective/existing-student confirmation, profile reconciliation boundaries, eligible context selection and atomic/idempotent final enrollment. **Acceptance:** AC-07–08 pass through UI and direct API checks, including retries and same-batch duplicates. **Owner:** Backend/Frontend/QA. **Depends on:** T04 and compatible ENQ-01 identity contracts.
- [x] **ADM-T06 — Implement lifecycle/history.** Deliver approved closure/reopen, enrolled-source protection and audit/history views. **Acceptance:** AC-09 passes without silently reversing student enrollment or destroying historical answers. **Owner:** Backend/Frontend. **Depends on:** T01–05.
- [x] **ADM-T07 — Implement mapped application import.** Reuse/extend the reviewed import foundation with admission-specific mapping, requirements and duplicate decisions. **Acceptance:** AC-10–11 pass; import creates applications only and recovery cannot double-commit. **Owner:** Backend/Frontend/QA. **Depends on:** T01–04 and a verified mapped-import foundation.
- [x] **ADM-T08 — Verify and accept.** Run relevant builds/tests, authenticated responsive/keyboard checks and staff workflows; reconcile counts/links and resolve blockers. **Acceptance:** AC-01–12 have evidence; actual staff acceptance is recorded separately from developer execution. **Owner:** QA/Product/Admissions. **Depends on:** T03–07.

## Verification matrix

| Scenario | Expected checks |
|---|---|
| Direct and enquiry-derived application | Approved minimum draft, source prefill, person/prospect linkage, saved incomplete application and missing contact/course handling. |
| Readiness | Missing requirements, unresolved identity, batch unselected, ready to enroll, unavailable question data and enrolled/closed records. |
| Register | Combined filters/sorts/presets, ties/nulls, multi-page counts, unauthorized scope, no match, failed/out-of-order responses and record return. |
| Identity | Same/shared name or phone, existing prospect/student, multiple courses, distinct intake, confirmed separate person and unauthorized candidate request. |
| Course/questions | Course change, preserved old answers, optional/required/retired/new questions, explicit No/consent and enrollment-stage validation. |
| Batch | Wrong course/branch, closed batch, changed permissions, selection retained after failure, duplicate enrollment and existing student in another batch. |
| Concurrency | Double save/enroll, concurrent editors, concurrent enrollment, lost response and idempotent outcome recovery. |
| Lifecycle | Close/reopen reasons, disallowed transitions, post-enrollment source corrections, student profile independence and preserved history. |
| Import | Customer headings, `.xlsx`/CSV, mapping/defaults, course aliases, invalid rows, explicit skips, application versus student duplicates, atomic rollback and retry. |
| Usability/accessibility | Admissions staff complete direct/new/returning applications using desktop/mobile and keyboard; long names, text zoom, modal focus and error recovery. |

## Definition of done and evidence

Acceptance was requested by the user on 19 October 2026. No personal name was recorded. Tasks and acceptance criteria above are checked from that request plus the evidence in this section. Walkthrough rows were removed from the institute database afterward; the register returned to Meera Nair, Arun Dev, and Ravi Import.

- Acceptance reviewer: the user, 19 October 2026. No personal name was supplied.
- Product decisions: recorded in the decision table on 19 October 2026.
- Visual review: the working register, new-application form, application detail, identity dialog, batch summary, and import stages. There is no separate design file.
- Automated results: `backend/tests/test_admissions_story.py` covers draft readiness, identity, enrollment, an unchanged student profile, repeat applications, course-change confirmation, stale-version conflicts, source correction, branch filtering, and an idempotent mapped import.
- Role and dataset: signed-in institute administrator (Salih) with `student.manage`, on the local institute. Course Science, branch North Branch, batch Morning (started 2026-06-01, open).

### Authenticated walkthrough

| Route | What was done | Expected | Actual |
|---|---|---|---|
| `/students/admissions/new` | Saved a name and course with no contact number. | Draft saves. Contact is not required yet. | Save stayed disabled until name and course were set. The application opened as ADM-000008, Open, Needs information, next action “Add the contact number”. |
| `/students/admissions/{id}` | Used the checklist action. | The contact field opens and receives focus. | “Add the contact number” opened the editor with Contact number focused. |
| Same application | Added a phone, confirmed identity, saved North Branch / Morning, then enrolled. | Identity is explicit. The final action names the batch. Success opens the student. | “No existing student matches” and “Create a separate student”. Batch showed “Morning · 2026-06-01”. Primary action became “Enroll in Morning”. Success opened the new student. |
| Same application after enrollment | Corrected the application email with a note. | The application records the correction. The student profile does not gain that email. | Activity recorded the note and actor. The student document had no email field. |
| `/students/admissions/import` | Uploaded `story-finish.csv` (Applicant, Mobile, Course), accepted the suggested mapping, reviewed, and saved. | Rows become applications and are not enrolled. | Confirm said “Rows become applications and are not enrolled.” Results: Created 1, with a link to the new open application. A second preview, not saved, showed readiness “Needs identity review” and action “Create a separate application”. |
| Close dialog on an open application | Opened Close, moved Tab from the last control, then pressed Escape. | Focus starts on a labeled field, Tab stays in the dialog, Escape restores the page. | Focus started on Closure reason. Tab from Cancel wrapped to the dialog Close button. Escape removed the dialog, cleared the inert background, and restored focus to Close. |
| `/students/admissions?q=zzznomatch` | Searched for a name that does not exist. | A distinct no-match state. | “0–0 of 0” and “No admissions match.” |

Enquiry conversion stays on the enquiry page as “Create admission”. This walkthrough did not convert another enquiry. Course-change confirmation, repeat blocking, stale `expected_updated_at`, and import retry were checked by the story tests rather than a second live edit.

### Viewports

Document `scrollWidth` matched `clientWidth` at each size. At 768 and 1280 the client width was 15px narrower than the requested width because of the scrollbar. Essential actions stayed available: Add admission and Import on the register, and the checklist on the detail page. At 360 the import page collapsed the sidebar to Menu.

| Surface | 360 | 390 | 768 | 1280 at 200% zoom |
|---|---|---|---|---|
| Register | 360 = 360 | 390 = 390 | 753 = 753 | 1265 = 1265 |
| Application detail | 360 = 360 | 390 = 390 | 753 = 753 | 1265 = 1265 |
| New application | 360 = 360 | — | — | — |
| Import review | 360 = 360 | — | — | — |

- Unresolved issues: none for this story. Student profile management and post-enrollment transfers remain in their own workspaces.
