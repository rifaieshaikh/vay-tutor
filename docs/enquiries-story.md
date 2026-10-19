# ENQ-01 — Modern enquiry management and mapped import

Date: 16 October 2026 · Status: product behavior accepted by the user on 16 October 2026. Implementation is in the application and was developer-verified on 17 October 2026 for the register, follow-up, mapped import, and enquiry-to-admission path. Acceptance checkboxes stay open until a staff review is recorded. Visual design review, capacity benchmarks, and institute confirmation of timezone and source-file retention are still open.

## User story

As an admissions staff member, I want to find and manage enquiries, record follow-ups and import my existing spreadsheets with field mapping, so I can act on prospective students without re-entering information or adapting every file to a fixed template.

## Scope

Redesign the Enquiries register, enquiry detail, Add/Edit enquiry, follow-up entry and enquiry spreadsheet import as one connected experience. Use shared navigation, filter, dialog and notification patterns from the [modern UI plan](modern-ui-task-list.md). This story is separate from the [dashboard story](dashboard-story.md); it does not redesign Admissions or Students beyond the enquiry-to-admission transition.

Preserve existing IDs, answers, follow-up history, permissions and conversion guarantees while implementing the accepted lifecycle and identity decisions below. No application changes begin until the proposed desktop/mobile layouts and unresolved decisions below are reviewed. Existing implementation or tests are inputs, not acceptance of this story.

## Proposed experience

### Register

- Header: Enquiries, secondary Import, primary Add enquiry.
- Page-owned views: All enquiries, Needs follow-up and Converted; these are filtered views, not duplicate module tabs.
- Inline search, compact Filters control and separate labeled Sort control.
- Applied-filter chips, Clear filters, result count and pagination.
- Rows prioritize name/contact, interested course, interest, next follow-up and stage. Use explicit Overdue/Today/Upcoming/Unscheduled labels.
- Default: all enquiries authorized for the current user, without a permanent Branch/Course/Period/Batch bar.

### Detail

- Compact identity/contact/course summary with clear stage and next-follow-up status.
- Prominent Add follow-up, secondary Edit and an explicitly labeled Create admission transition when permitted.
- Chronological activity timeline, grouped details and relevant additional answers; form configuration belongs in Administration → Forms.
- Converted enquiries retain their history and link to the admission; new enquiry follow-ups stop after conversion, with a clear explanation and Open admission action.

### Add and follow-up

- Initial capture uses a short grouped dialog requiring only name. Substantial editing or many additional questions use the full record/page. Save does not require enrollment-stage information.
- Record follow-up captures completed contact: contact date, discussion note, updated interest and optional next-follow-up date. Schedule follow-up creates a future task without inventing a completed discussion; the entry action must make this distinction clear.
- Dates follow an agreed institute-local calendar convention; errors remain beside the affected form and preserve input.

### Import

**Upload → Select source → Map columns → Resolve values → Review → Confirm → Results.**

Customers use their existing supported spreadsheets; a sample template is optional. Column mapping and value resolution are separate steps. No records are created by upload, mapping or preview.

## Accepted product decisions

Accepted by the user on 16 October 2026 in the design discussion. This approves behavior, not mockups, implementation completion or the technical details still open below.

| Decision | Accepted behavior |
|---|---|
| Enquiry identity | One enquiry represents one person's interest in one course. Separate course enquiries link to the same prospective person; each retains independent follow-ups and conversion outcome. Suggest existing candidates before creating a duplicate; never auto-merge by name. |
| Minimum capture | Name alone saves an enquiry. Missing contact/course is visible; required information is completed before Create admission. A course-unspecified draft can be captured and resolved later. |
| Lifecycle | Open, Converted and Closed are distinct from interest and follow-up timing. Closure reasons and reopening rules are specified below. |
| After conversion | Keep enquiry history and link to the admission; stop new enquiry follow-ups. |
| Follow-up semantics | Record follow-up means contact already made; Schedule follow-up means a future task. Use the institute timezone. |
| Form presentation | Short dialog for initial capture; full record/page for substantial editing or many additional questions. |
| Default list | All authorized enquiries, newest first. Needs follow-up is a filtered working view ordered by next-follow-up date. Search is inline; course, interest, stage and follow-up criteria live in Filters. |
| Detail priorities | Add follow-up near identity/contact; next scheduled task and activity timeline before secondary background details. |
| Import formats and mapping | Support `.xlsx` and CSV, editable column suggestions, separate canonical value mapping and explicit duplicate decisions. A template is optional. |
| Import review | Preview and resolve before confirmation; only reviewed valid rows are eligible. Blocked rows must be corrected or explicitly skipped. No silent updates to existing enquiries. |
| Saved mappings | Deliver after the basic mapped import is verified as reliable; remains a follow-on acceptance slice, not a prerequisite to basic import verification. |

## Detailed operating decisions

Recorded on 16 October 2026 following the user's instruction to update this document with the recommendations. These are the implementation baseline. Limits and retention are starting defaults to validate, not measured capacity or a statutory retention policy.

### Closure, reopening and conversion

- Closure reasons: Not interested, Joined elsewhere, Unable to contact, Duplicate entry, Created by mistake, Other. Other requires a note. Closing does not delete the record or merge identities.
- Authorized staff may reopen Closed enquiries, recording actor, time and reason. Reopening creates no automatic pending task; staff schedule a new one explicitly.
- Closing or converting cancels pending enquiry tasks with a recorded reason. Completed activity remains immutable history subject to explicit audited corrections.
- Converted enquiries link to the admission and cannot receive new enquiry follow-ups or reopen through the ordinary enquiry action. Admission cancellation/reversal needs a separately defined workflow; do not add an implicit reversal here.

### Prospect identity and migration

- Create an internal prospect ID independent of name, contact number and student code. Person/contact details belong to the prospect; course interest, stage, follow-ups and conversion belong to each enquiry.
- Present possible matches using available attributes, but require an explicit confirmed link. Shared names or contact details are never proof of identity; separate people may share a number.
- Different courses create independent enquiries for the confirmed same prospect. For a repeat enquiry for the same course, suggest the existing Open enquiry first; a distinct intake/interest episode may create a new enquiry with a recorded explanation.
- Unknown-course drafts are supported and resolved before course-dependent conversion. Do not create placeholder courses to satisfy a form.
- Migrate existing enquiries to separate prospect identities unless an existing reliable relationship establishes identity. Preserve enquiry IDs/history and offer later audited reconciliation without bulk name/phone merges.
- Preserve prospect links through admission and student linking/creation. Changes to shared person fields must explicitly state that related enquiries use the same person details; enquiry-specific history stays independent.

### Calendar and follow-up tasks

- Use an institute-configured IANA timezone. Initial proposed setting for this deployment: **Asia/Kolkata**, confirmed in configuration before enabling date-sensitive workflows.
- Date-only task deadlines use the institute-local calendar date. Store audit instants separately and display them in the institute timezone.
- Start with at most one pending next-follow-up task per enquiry. Rescheduling preserves prior dates, actor and reason/history.
- For Open enquiries: Overdue means pending date before today; Today means pending date today; Upcoming means pending date after today; Unscheduled means no pending task.
- Needs follow-up includes Open enquiries that are Overdue, Today or Unscheduled. It excludes Upcoming, Converted and Closed enquiries.
- Needs follow-up order: overdue oldest deadline first, then today, then unscheduled oldest enquiry first, with stable ID tie-breaking. General next-follow-up sorting places missing dates last in either direction.
- Record follow-up requires contact date no later than today and a discussion note. Schedule follow-up requires today or a future date and does not imply completed contact. Any next task recorded alongside contact must also be today or later.
- Completing contact resolves the explicitly identified pending task when applicable; do not silently complete a different course enquiry's task. Backdated corrections are explicit and audited.

### Files and source selection

- Support `.xlsx` and CSV. Starting configurable limits: **10 MB per file, 10,000 data rows total across selected sheets, 20 selected sheets**. Define MB as 10,000,000 bytes in validation/UI; protect against excessive decompressed content separately.
- Validate these limits with representative hardware, files and transaction durations before release. If unsuitable, revise the limits explicitly rather than silently adopting partial commits.
- CSV supports UTF-8 with/without BOM and detected comma, semicolon or tab delimiters, with a visible delimiter override. Unsupported encodings require a clear conversion instruction; do not guess lossy decoding.
- Users select workbook sheets and each header row; all selected sources enter one reviewed plan. No automatic first-sheet-only import. CSV is one source and needs no sheet selector.

### Duplicate decisions and overwrite policy

- Distinguish candidate same prospect, candidate duplicate enquiry and repeated execution of the same import. Exact repeated source rows and stored matches are reviewed separately.
- Initial actions: Create new prospect and enquiry; Create enquiry for a confirmed existing prospect; Skip row. Linking a prospect creates an enquiry, not a new identity or an overwrite of the old enquiry.
- Same-course/intake duplicate candidates require explicit resolution under the repeat-enquiry rule; name-only candidates never auto-merge. Detection rules must show their supporting match attributes without treating confidence as proof.
- **No updates to existing enquiries through import in this release.** Staff open existing records for explicit edits. No hidden update option or blank-value overwrite is permitted.
- A later update mode requires its own field-level before/after review, preserve-blanks default, concurrent-edit checks, permissions and audit trail; it is outside this story.

### Atomic commit and recoverable outcomes

- Correct or explicitly skip every blocked row before final confirmation. Commit the remaining reviewed eligible set in **one atomic transaction** across all selected sheets.
- At commit, revalidate scope, fields, catalog/questions, identity decisions and the current plan revision. No eligible rows commit if any commit-time blocker remains.
- Use a persistent import operation ID and idempotency key, bound to actor/institute and the confirmed plan revision. Reusing a key for a different payload is rejected.
- Retries return the recorded original result. After a lost response, query operation status before attempting another submission. Failed atomic commits create no partial enquiry/prospect/task set.
- Report committed and explicitly skipped source rows separately. A newly submitted file may raise duplicate candidates even when its operation key differs; idempotency is not a replacement for duplicate review.

### Saved mappings, retention and source-value rules

- Deliver saved mappings after verifying basic import. Mappings are private to their creator by default; authorized administrators may publish institute-shared mappings. Every reuse revalidates fields, question versions and authorized catalog references.
- Proposed configurable retention: **30 days for private source files and detailed error reports**. Confirm the institute policy and implement expiry for temporary copies too. Preview UI shows expiry; expired sources cannot be committed.
- Keep operation summary, mapping version/snapshot, committed record references and audit outcomes separately under the institute's agreed longer-term audit policy. Do not retain full source rows indefinitely merely because they are in an audit payload.
- Treat phone values as text: preserve the source value/leading zeros/plus sign and keep normalized search representation separately. Flag suspected source truncation/scientific notation; do not invent lost digits.
- Ambiguous text dates require an explicit date-format selection; reject invalid dates. Preview original and interpreted values.
- Never execute workbook formulas. Flag formula cells and block mapped use until the user explicitly accepts an available cached value or supplies a plain value. Missing cached results cannot become invented values. Generated CSV/error exports must prevent spreadsheet formula execution as well.

### Search, filter and sort contract

- Search fields: enquiry reference, prospect/person name, contact number and email where stored. Use normalized phone search without replacing the original display value. Notes and arbitrary custom answers are excluded initially.
- Filters: course, lifecycle stage, interest, follow-up state, created-date range, next-follow-up range and applicable closure reason. Date-range endpoints are inclusive institute-local dates; querying timestamps uses the corresponding start-of-day to next-day-exclusive bounds.
- Sort fields: created date, name, next follow-up and last recorded contact, each with ascending/descending direction and unique ID tie-breaking. Default: created date descending. Follow-up preset ordering is defined above; missing next/last-contact dates sort last. Text comparison/collation must be documented consistently in API and tests.
- Filtering and sorting apply to the complete authorized dataset before pagination; counts and result IDs reconcile. No branch filter exists until a real branch-interest relationship is separately designed.
- Inventory API gaps for prospect search/link/migration, close/reopen, scheduling/rescheduling/completion, register querying, private source selection/mapping/validation, duplicate resolution, immutable reviewed-plan commit/status and saved mapping publication/expiry. Reuse existing endpoints where they already satisfy these contracts.

## Validation gates still open

- Confirm institute timezone configuration and the exact longer-term audit retention policy with the institute; implement the proposed defaults only as visibly configurable settings.
- Benchmark proposed upload/row/sheet limits and atomic transaction performance; document compression and parser-resource limits.
- Specify candidate-matching attributes, text collation, prospect reconciliation permissions, closure/reopen permissions and endpoint/versioning details without weakening the decisions above.
- Review desktop/mobile designs. Product decisions are recorded; visual acceptance and implementation evidence remain pending.

## Acceptance criteria

### AC-01 — Register layout and default scope

- [ ] Register presents one clear Add enquiry action and secondary Import; routine question-configuration links and repeated Enquiry/Admission/Student tabs are absent.
- [ ] Default list ordering is newest first; Needs follow-up orders overdue oldest first, then today, then unscheduled oldest enquiry first, excluding Closed/Converted and Upcoming. Open/Converted/Closed are filterable lifecycle states, separate from interest and timing.
- [ ] With no query filters, results contain all and only authorized enquiries. Rows/counts are checked against the actual backend scope, not merely hidden UI actions.
- [ ] Identity, contact, course, interest, next follow-up and stage are readable with long/missing values; contact is secondary to the name where useful.
- [ ] Initial empty, no match, loading and failed requests are distinct; errors offer Retry and never imply zero enquiries.

### AC-02 — Search, filters and sorting

- [ ] Search covers enquiry reference, person name, contact and stored email; filters cover course, interest, stage, follow-up state, created/next-follow-up date ranges and closure reason. Notes/custom answers and invented branch scope are absent. Date ranges follow the documented inclusive local-date contract.
- [ ] Filter drafts do not change results until Apply. Cancel preserves the applied view; Reset clears the draft until applied; Clear filters restores all authorized data.
- [ ] Removable chips expose all selected restrictions. Presets map to documented predicates and become Custom/unselected when their defining criteria change.
- [ ] Sort supports name, creation date, next follow-up and last recorded contact, with explicit direction, stable tie-breaking and defined missing-date placement across the full filtered dataset before pagination.
- [ ] Search/filter/sort/page state survives URL reload, Back/Forward and record return; changing criteria resets pagination. Latest requests win and failed option loads do not silently broaden results.

### AC-03 — Detail and action discoverability

- [ ] On opening a record, staff can identify the person, contact, interested course, stage and next-follow-up status without searching the lower page.
- [ ] Add follow-up is visible near the record header for eligible users/records; unavailable actions have an understandable state or explanation rather than a mysterious disappearance.
- [ ] Contact/institution/referral/notes/additional answers are grouped by meaning. Historical answers remain readable; their configuration is outside the record.
- [ ] Activity is chronological and shows meaningful recorded dates and available actor/context. Do not fabricate actor history unavailable in existing records.
- [ ] Create admission names its actual effect, enforces required contact/course/question checks before conversion and opens the single linked admission; retry does not create a second admission.

### AC-04 — Add/Edit enquiry

- [ ] Separate enquiries for different courses link to the same explicitly resolved prospective person; follow-ups/conversion remain independent and no name-only auto-merge occurs. Unknown-course drafts remain supported.
- [ ] Initial save requires only name; required contact/course/conversion information is shown before transition.
- [ ] Essential fields appear first, optional fields are identifiable and validation follows actual save-versus-convert requirements. Missing conversion requirements do not unnecessarily block draft enquiry creation.
- [ ] Valid data saves once, refreshes the register appropriately and provides a truthful confirmation with an Open enquiry action where useful.
- [ ] Required/invalid fields receive accessible field errors; server/network failures retain typed values and offer recovery.
- [ ] Double clicks/retries cannot create accidental duplicate submissions; save pending state is visible and dismissal during submission has a defined safe behavior.
- [ ] Close/Cancel/Escape/outside/internal navigation and refresh protect changed work; unchanged forms close without unnecessary confirmation.

### AC-05 — Follow-up entry

- [ ] Scheduling future contact and recording completed contact are explicit distinct operations. A scheduled task does not create a fictitious completed activity; recording contact updates/completes the correct task without affecting another course enquiry.
- [ ] Add follow-up opens a bounded accessible dialog; contact date defaults to the agreed institute-local date, not an incidental UTC/browser conversion.
- [ ] Completed contact requires a note and a contact date no later than institute-today; scheduling and optional next dates require today or later. One pending task per enquiry is enforced, including concurrent requests; reschedule/completion retains history.
- [ ] Save updates the timeline and next-follow-up summary and affects the corresponding list/preset counts; a success notice identifies the outcome.
- [ ] Failure preserves entered values and shows error feedback in the dialog; duplicate submission is prevented and unsaved dismissal is guarded.
- [ ] Existing converted enquiries remain readable and prevent new enquiry follow-ups and link to the admission in both UI and API.

### AC-06 — Upload and source selection

- [ ] Both `.xlsx` and CSV are accepted through the reviewed mapping flow; CSV encoding/delimiter errors are recoverable and workbook-only sheet selection is not shown for CSV.
- [ ] Import states the supported formats/limits, provides an optional sample template and accepts customer files that do not use fixed column headings.
- [ ] For workbooks, users select up to 20 sheets and their header rows for one reviewed plan and can inspect source rows before mapping; blank/duplicate headings have stable column identifiers.
- [ ] UTF-8 CSV (with/without BOM), comma/semicolon/tab detection and delimiter override pass fixtures. Configurable 10 MB/10,000 total data-row/20-sheet limits are enforced server-side, with actionable errors for unsupported/empty/oversized/malformed sources. Preview creates no domain records.
- [ ] Preview has visible pending state; replacing a file invalidates its prior rows/mapping/confirmation. Older responses cannot overwrite the newly selected source or remain committable.

### AC-07 — Column mapping

- [ ] Each source column can map to a supported enquiry field/custom question or be explicitly ignored, with sample source values beside the choice.
- [ ] Automatic suggestions remain editable and clearly distinguish confirmed, unmapped and ignored columns; mappings use stable source-column IDs and target-field/question IDs.
- [ ] Required target mappings or explicit supported defaults are resolved before proceeding; ambiguous mappings and multiple columns targeting one single-value field cannot silently overwrite each other.
- [ ] Staff may supply a default such as one interested course for the file. The interface defines whether defaults fill blanks or override columns and exposes their effect in the preview.
- [ ] Mapping preserves the distinction between Name, WhatsApp/contact, Present institution, Interested course, Interest, References, Notes and custom questions; changing source/header invalidates incompatible mappings.

### AC-08 — Value resolution and validation

- [ ] Column matching does not imply value matching: course aliases such as “CA Fdn” resolve explicitly to an authorized canonical course, and “Hot” may map to High through an explicit choice.
- [ ] Unmatched/ambiguous course or option values become visible blockers or intentional skips, not silently created catalog entities or invented values.
- [ ] Blank, No and consent answers retain their defined meanings; type/format validation follows the same business rules as manual entry.
- [ ] Phone values preserve source text and leading zeros; normalized search values remain separate. Ambiguous dates require a chosen format; formula values are blocked until explicit cached/plain-value resolution without execution. Error exports cannot execute formulas. All transformations follow the documented import policy; transformations are previewable and errors identify source sheet/row/column and target field.

### AC-09 — Review, correction and duplicates

- [ ] Review shows mapped name, contact, course, interest and applicable additional values, source row numbers, row status and proposed action—not merely a name and Ready label.
- [ ] Summary counts reconcile with valid, blocked and explicitly skipped rows; errors can be filtered and corrections trigger fresh validation before commit.
- [ ] Users can fix supported mapped values inline or download an error report and replace the source; re-upload cannot commit stale reviewed rows.
- [ ] Duplicate candidates within the file and against existing enquiries are distinguished. Ambiguous matches require an explicit decision and are never automatically merged by name alone.
- [ ] Import offers only create-new-prospect-and-enquiry, create-enquiry-for-confirmed-prospect and skip. Existing enquiries are never overwritten, including with blank values; possible duplicate enquiries require an explicit safe decision.
- [ ] Removing or skipping an error row is deliberate and reflected in final counts; no worksheet/row is silently lost.

### AC-10 — Confirmation, commit and results

- [ ] Final confirmation states exactly how many records will be created and skipped, with zero unresolved blocked rows required before commit, and identifies selected sheet/source/defaults.
- [ ] Commit is enabled only for the current validated reviewed plan; changed mappings/corrections invalidate approval until revalidated.
- [ ] Backend revalidates permissions, question/catalog references and row rules at commit; editing client payloads cannot bypass required mapping or access restrictions.
- [ ] One transaction commits all reviewed eligible rows across selected sheets, or none. Persisted operation ID/idempotency key and plan revision prevent duplicate retries; changed payloads under the same key are rejected, and lost responses recover through operation status.
- [ ] Result summary links to created enquiries and reports skipped/failed rows with reasons. Success is shown only for confirmed outcomes, with no false success after rollback. Explicit skips are not reported as imported records.
- [ ] Source file/sheet/row, transformations and actor/outcome are retained or referenced according to the agreed private retention/audit policy, without exposing uploaded data to unrelated users.

### AC-11 — Reusable mappings

- [ ] Users can save and reuse a named mapping for recurring file structures, with source/target schema and course/value resolutions clearly identified.
- [ ] Mappings default to private; only authorized administrators publish institute-shared mappings. Mapping ownership/sharing respects permissions; loading a saved mapping rechecks current field/question/catalog availability and never grants access.
- [ ] Changed headers, retired questions or missing options require remapping/review rather than silently applying stale assignments.
- [ ] Reusing a mapping still requires inspecting validated data and confirming the import; it never automatically creates records.

### AC-12 — Interaction quality and verification

- [ ] List, detail and dialogs work at 360, 390, 768 and 1280 CSS pixels and at 200% text zoom without unintended page-wide overflow or clipped essential actions.
- [ ] Keyboard users can navigate filters, mapping controls, preview errors and dialogs; modal focus is set/contained/restored with background inertness.
- [ ] Status/errors use text plus accessible announcements. Success notices may time out with hover/focus pause; actionable failures remain accessible until resolved/dismissed.
- [ ] No Add, Import, follow-up or conversion success claim relies solely on API tests: authenticated UI walkthroughs and applicable automated tests cover the scenarios below.

### AC-13 — Lifecycle, migration and retention

- [ ] Close requires a supported reason (Other requires note); authorized reopen records actor/time/reason without restoring old tasks. Close/convert cancels pending tasks and preserves completed history; ordinary reopen is rejected for Converted enquiries.
- [ ] Migration preserves original enquiry IDs/answers/follow-ups and creates separate prospects unless reliable existing relationships prove identity. Name/shared phone alone cannot merge prospects; confirmed cross-course links preserve independent histories and admission/student lineage.
- [ ] Repeat same-course interests suggest the existing Open record; creating a distinct intake/episode records the explanation. Unknown-course drafts save without placeholder catalog records.
- [ ] Source/error-file expiry uses the configured proposed 30-day policy, blocks expired plans and covers temporary copies. Audit summaries/references follow separately confirmed policy without indefinite full-row retention. Mapping publication and source/operation access remain scoped.

## Execution tasks

Sequence: contracts/design → register/detail and manual follow-ups → basic mapped import → verification. Add saved mappings only after the basic flow passes its acceptance slice; retain full final-story verification afterward.

- [ ] **ENQ-T01 — Define contracts and decisions.** Produce field/mapping schemas, duplicate/overwrite/atomicity policy, date convention, filter/sort predicates, file limits and saved-mapping permissions. **Acceptance:** decisions and API gaps are documented for AC-01–13; no unresolved rule is silently assumed.
- [ ] **ENQ-T02 — Design and review the complete experience.** Prepare populated desktop/mobile register/detail/Add/follow-up designs plus all import stages, empty/error states and notifications. **Acceptance:** user review is recorded and each AC has an identified design/behavior; no application implementation precedes design agreement.
- [ ] **ENQ-T03 — Implement register and detail.** Deliver shared list controls, global sorting, stateful navigation, grouped record and activity/action layout. **Acceptance:** AC-01–03 and related AC-12 checks pass with multi-page fixtures and scoped roles. **Depends on:** T01–02.
- [ ] **ENQ-T04 — Implement reliable Add/Edit and follow-ups.** Use consistent forms, validation, dirty/pending handling, truthful notifications and date semantics. **Acceptance:** AC-04–05 and AC-13 pass, including identity migration, close/reopen, failures, duplicates and converted enquiry policy. **Depends on:** T01–02.
- [ ] **ENQ-T05 — Implement source selection and column mapping.** Deliver private upload/preview, sheet/header selection, mapping/defaults and stale-response protection. **Acceptance:** AC-06–07 pass with non-template customer-format fixtures. **Depends on:** T01–02.
- [ ] **ENQ-T06 — Implement resolution and review.** Deliver canonical value matching, row validation/correction, duplicate decisions and error reporting. **Acceptance:** AC-08–09 pass without silent entity creation, overwrite or row loss. **Depends on:** T05.
- [ ] **ENQ-T07 — Implement safe atomic commit.** Deliver confirmed validated import execution, persistent operation/idempotency recovery, result links, provenance and source expiry. Verify basic import before starting T09. **Acceptance:** AC-10 and import-retention parts of AC-13 pass through UI and direct API checks. **Depends on:** T06.
- [ ] **ENQ-T09 — Add reusable mappings after basic import verification.** Deliver private/shared mapping storage, publication permissions, schema revalidation and retirement handling. **Acceptance:** AC-11 passes, mapping/source permissions satisfy AC-13 and reuse still requires review/confirmation. **Depends on:** T07 and recorded basic-import verification.
- [ ] **ENQ-T08 — Verify and accept.** Run the verification matrix, relevant builds/tests and staff sessions; fix and retest blocking issues. **Acceptance:** all ACs have linked evidence and actual staff acceptance is recorded separately from developer verification. **Depends on:** T03–07, T09.

## Verification matrix

| Scenario | Required checks |
|---|---|
| New/edited enquiry | Minimum valid input, optional/custom answers, missing conversion requirements, invalid input, failed save, repeated click, dirty dismissal. |
| Follow-up | Scheduling versus completed contact, midnight/timezone boundaries, one pending task under concurrent requests, reschedule history, validation, failed/retried save, queue refresh and converted/closed records. |
| Lifecycle/identity | All closure reasons, Other note, audited reopen without task resurrection, same/shared names/phones, cross-course links, repeat-course episodes, unknown-course draft and existing-record migration. |
| Register | Combined filters/sorts, ties and missing dates, multi-page results, presets, no match, load failure, reload/Back/return context. |
| Non-template upload | Different headings, shifted header row, multiple sheets, blank/duplicate headings, ignored columns and optional template. |
| Mapped values | Course alias/unmatched course, interest mapping, defaults versus source values, custom questions, phone leading zeros and date/formula policy. |
| Review/correction | Invalid rows, explicit skips, duplicate candidates, no-overwrite enforcement and confirmed prospect linking, error report, re-upload after correction. |
| Concurrent/failed import | Replaced file during preview, stale responses, changed plan, double commit, lost response, retry and atomic rollback, same-key/different-payload rejection and recovered original outcomes. |
| Saved mapping/retention | Private/shared permissions, valid reuse, changed headers, retired questions, missing options, source/temp/report expiry, audit-reference preservation and expired-plan rejection. |
| Permissions | Reader/manager/catalog-role distinctions, direct API denial, source/result access and commit after permissions change. |
| Usability | Actual admissions staff add an enquiry, schedule a follow-up, import a customer-format file and create/open an admission without developer guidance. |

## Definition of done and evidence

All acceptance criteria and execution tasks have passed with evidence. Record design acceptance, implementation references, test commands/results, datasets, role, viewport and screenshots for authenticated checks. Preserve existing records and audit/provenance. Unverified scenarios remain open; existing backend tests do not stand in for Add/Import browser acceptance.

- Named owner and acceptance reviewer: unassigned.
- Product behavior: accepted by the user, 16 October 2026 (table above).
- Detailed operating decisions: recorded above following user instruction.
- Timezone/policy confirmation, capacity benchmarks and final API contract: pending. The institute timezone field is in Settings (default Asia/Kolkata). Enquiry import source files and error reports are kept for 30 days; that period is stated on the import page and in Settings. It is not a configurable retention editor and is not a statutory policy.
- Design and user review: pending.
- Implementation and developer verification, 17 October 2026: the signed-in app imported a customer-format CSV (exact course name matched, alias “CA Fdn” and interest “Hot” resolved explicitly, leading zero kept on 09870000021), created two enquiries, converted one into a single admission, and scheduled a future follow-up that did not invent a completed contact. Register, detail, add dialog, and import were checked at 360, 390, 768, and 1280 CSS pixels without page-wide overflow; 200% text zoom was checked at 1280 CSS pixels. `pytest tests/test_enquiries_story.py tests/test_connected_workflows.py` passed (7) and frontend `tsc --noEmit` passed. These checks are developer verification, not staff acceptance.
- Staff review and unresolved issues: pending. Acceptance criteria above stay unchecked until that review. Capacity limits (10 MB, 10,000 rows, 20 sheets, one transaction) are enforced in code and tests; they have not been benchmarked at those ceilings.
