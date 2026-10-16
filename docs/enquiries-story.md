# ENQ-01 — Modern enquiry management and mapped import

Date: 16 October 2026 · Status: recommended product behavior accepted by the user on 16 October 2026; visual design, technical decisions and implementation pending.

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
| Lifecycle | Open, Converted and Closed are distinct from interest and follow-up timing. Closure reasons still need definition. |
| After conversion | Keep enquiry history and link to the admission; stop new enquiry follow-ups. |
| Follow-up semantics | Record follow-up means contact already made; Schedule follow-up means a future task. Use the institute timezone. |
| Form presentation | Short dialog for initial capture; full record/page for substantial editing or many additional questions. |
| Default list | All authorized enquiries, newest first. Needs follow-up is a filtered working view ordered by next-follow-up date. Search is inline; course, interest, stage and follow-up criteria live in Filters. |
| Detail priorities | Add follow-up near identity/contact; next scheduled task and activity timeline before secondary background details. |
| Import formats and mapping | Support `.xlsx` and CSV, editable column suggestions, separate canonical value mapping and explicit duplicate decisions. A template is optional. |
| Import review | Preview and resolve before confirmation; only reviewed valid rows are eligible. Blocked rows must be corrected or explicitly skipped. No silent updates to existing enquiries. |
| Saved mappings | Deliver after the basic mapped import is verified as reliable; remains a follow-on acceptance slice, not a prerequisite to basic import verification. |

## Technical and lifecycle details still to resolve

- Define closure reasons and whether/how Closed enquiries reopen, including scheduled-task behavior on closure/conversion.
- Define prospective-person identity/linking and compatible migration of existing enquiries; preserve links through admission/student creation without treating a shared phone or name as proof of identity. Define handling of unknown-course drafts and repeat enquiries for the same course.
- Confirm institute timezone configuration, exact Needs follow-up predicate, unscheduled-task ordering and validation for completed versus scheduled contact.
- Confirm file-size/row/sheet limits, CSV encoding/delimiter handling and whether selected sheets commit sequentially or in one plan. Both accepted formats must be implemented and tested before advertising support.
- Define duplicate candidate rules within a file and against stored enquiries. Expose create/link/skip decisions only where safe; updates require an explicit field-level overwrite policy and audit record.
- Choose atomicity for the reviewed eligible set and define idempotent retry/outcome recovery. Explicitly skipped rows never count as committed; no blocked row may slip into the commit.
- Define saved-mapping ownership/sharing and source-file retention, plus phone/date/formula policies. Preserve leading zeros where present; never claim to recover information lost in the source.
- Record API gaps and the final per-field search/sort contract; do not invent branch relationships for enquiries.

## Acceptance criteria

### AC-01 — Register layout and default scope

- [ ] Register presents one clear Add enquiry action and secondary Import; routine question-configuration links and repeated Enquiry/Admission/Student tabs are absent.
- [ ] Default list ordering is newest first; Needs follow-up uses next-follow-up order with explicit unscheduled placement. Open/Converted/Closed are filterable lifecycle states, separate from interest and timing.
- [ ] With no query filters, results contain all and only authorized enquiries. Rows/counts are checked against the actual backend scope, not merely hidden UI actions.
- [ ] Identity, contact, course, interest, next follow-up and stage are readable with long/missing values; contact is secondary to the name where useful.
- [ ] Initial empty, no match, loading and failed requests are distinct; errors offer Retry and never imply zero enquiries.

### AC-02 — Search, filters and sorting

- [ ] Search names the supported identity/contact fields. Filters offers applicable course, interest, stage and follow-up criteria, with explicit date-range semantics where supported.
- [ ] Filter drafts do not change results until Apply. Cancel preserves the applied view; Reset clears the draft until applied; Clear filters restores all authorized data.
- [ ] Removable chips expose all selected restrictions. Presets map to documented predicates and become Custom/unselected when their defining criteria change.
- [ ] Sort supports the agreed fields, including name, creation date and next follow-up where implemented, with explicit direction, stable tie-breaking and defined missing-date placement across the full filtered dataset before pagination.
- [ ] Search/filter/sort/page state survives URL reload, Back/Forward and record return; changing criteria resets pagination. Latest requests win and failed option loads do not silently broaden results.

### AC-03 — Detail and action discoverability

- [ ] On opening a record, staff can identify the person, contact, interested course, stage and next-follow-up status without searching the lower page.
- [ ] Add follow-up is visible near the record header for eligible users/records; unavailable actions have an understandable state or explanation rather than a mysterious disappearance.
- [ ] Contact/institution/referral/notes/additional answers are grouped by meaning. Historical answers remain readable; their configuration is outside the record.
- [ ] Activity is chronological and shows meaningful recorded dates and available actor/context. Do not fabricate actor history unavailable in existing records.
- [ ] Create admission names its actual effect, preserves existing conversion requirements and opens the single linked admission; retry does not create a second admission.

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
- [ ] Date and discussion are validated according to agreed rules; updated interest and next date are clearly optional or required as defined. Impossible dates and invalid scheduling sequences receive explicit feedback.
- [ ] Save updates the timeline and next-follow-up summary and affects the corresponding list/preset counts; a success notice identifies the outcome.
- [ ] Failure preserves entered values and shows error feedback in the dialog; duplicate submission is prevented and unsaved dismissal is guarded.
- [ ] Existing converted enquiries remain readable and prevent new enquiry follow-ups and link to the admission in both UI and API.

### AC-06 — Upload and source selection

- [ ] Both `.xlsx` and CSV are accepted through the reviewed mapping flow; CSV encoding/delimiter errors are recoverable and workbook-only sheet selection is not shown for CSV.
- [ ] Import states the supported formats/limits, provides an optional sample template and accepts customer files that do not use fixed column headings.
- [ ] For workbooks, users select a sheet and header row and can inspect source rows before mapping; blank/duplicate headings have stable column identifiers.
- [ ] Unsupported, unreadable, empty, oversized or malformed files fail with actionable errors. No records are created during preview.
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
- [ ] Phone/date/formula handling follows the documented import policy; transformations are previewable and errors identify source sheet/row/column and target field.

### AC-09 — Review, correction and duplicates

- [ ] Review shows mapped name, contact, course, interest and applicable additional values, source row numbers, row status and proposed action—not merely a name and Ready label.
- [ ] Summary counts reconcile with valid, blocked and explicitly skipped rows; errors can be filtered and corrections trigger fresh validation before commit.
- [ ] Users can fix supported mapped values inline or download an error report and replace the source; re-upload cannot commit stale reviewed rows.
- [ ] Duplicate candidates within the file and against existing enquiries are distinguished. Ambiguous matches require an explicit decision and are never automatically merged by name alone.
- [ ] If updating existing records is supported, preview shows before/after values and requires the agreed overwrite decision. Otherwise only supported create/skip/resolution actions appear.
- [ ] Removing or skipping an error row is deliberate and reflected in final counts; no worksheet/row is silently lost.

### AC-10 — Confirmation, commit and results

- [ ] Final confirmation states exactly how many records will be created, updated if supported, skipped or blocked, and identifies selected sheet/source/defaults.
- [ ] Commit is enabled only for the current validated reviewed plan; changed mappings/corrections invalidate approval until revalidated.
- [ ] Backend revalidates permissions, question/catalog references and row rules at commit; editing client payloads cannot bypass required mapping or access restrictions.
- [ ] Agreed transaction/partial-outcome behavior is enforced. Double clicks, retries and lost responses do not create duplicate records; users can recover the recorded outcome.
- [ ] Result summary links to created/updated enquiries and reports skipped/failed rows with reasons. Success is shown only for confirmed outcomes, with no false all-success message after partial failure.
- [ ] Source file/sheet/row, transformations and actor/outcome are retained or referenced according to the agreed private retention/audit policy, without exposing uploaded data to unrelated users.

### AC-11 — Reusable mappings

- [ ] Users can save and reuse a named mapping for recurring file structures, with source/target schema and course/value resolutions clearly identified.
- [ ] Mapping ownership/sharing respects permissions; loading a saved mapping rechecks current field/question/catalog availability and never grants access.
- [ ] Changed headers, retired questions or missing options require remapping/review rather than silently applying stale assignments.
- [ ] Reusing a mapping still requires inspecting validated data and confirming the import; it never automatically creates records.

### AC-12 — Interaction quality and verification

- [ ] List, detail and dialogs work at 360, 390, 768 and 1280 CSS pixels and at 200% text zoom without unintended page-wide overflow or clipped essential actions.
- [ ] Keyboard users can navigate filters, mapping controls, preview errors and dialogs; modal focus is set/contained/restored with background inertness.
- [ ] Status/errors use text plus accessible announcements. Success notices may time out with hover/focus pause; actionable failures remain accessible until resolved/dismissed.
- [ ] No Add, Import, follow-up or conversion success claim relies solely on API tests: authenticated UI walkthroughs and applicable automated tests cover the scenarios below.

## Execution tasks

Sequence: contracts/design → register/detail and manual follow-ups → basic mapped import → verification. Add saved mappings only after the basic flow passes its acceptance slice; retain full final-story verification afterward.

- [ ] **ENQ-T01 — Define contracts and decisions.** Produce field/mapping schemas, duplicate/overwrite/atomicity policy, date convention, filter/sort predicates, file limits and saved-mapping permissions. **Acceptance:** decisions and API gaps are documented for AC-01–11; no unresolved rule is silently assumed.
- [ ] **ENQ-T02 — Design and review the complete experience.** Prepare populated desktop/mobile register/detail/Add/follow-up designs plus all import stages, empty/error states and notifications. **Acceptance:** user review is recorded and each AC has an identified design/behavior; no application implementation precedes design agreement.
- [ ] **ENQ-T03 — Implement register and detail.** Deliver shared list controls, global sorting, stateful navigation, grouped record and activity/action layout. **Acceptance:** AC-01–03 and related AC-12 checks pass with multi-page fixtures and scoped roles. **Depends on:** T01–02.
- [ ] **ENQ-T04 — Implement reliable Add/Edit and follow-ups.** Use consistent forms, validation, dirty/pending handling, truthful notifications and date semantics. **Acceptance:** AC-04–05 pass, including failures, duplicates and converted enquiry policy. **Depends on:** T01–02.
- [ ] **ENQ-T05 — Implement source selection and column mapping.** Deliver private upload/preview, sheet/header selection, mapping/defaults and stale-response protection. **Acceptance:** AC-06–07 pass with non-template customer-format fixtures. **Depends on:** T01–02.
- [ ] **ENQ-T06 — Implement resolution and review.** Deliver canonical value matching, row validation/correction, duplicate decisions and error reporting. **Acceptance:** AC-08–09 pass without silent entity creation, overwrite or row loss. **Depends on:** T05.
- [ ] **ENQ-T07 — Implement safe commit and reusable mappings.** Deliver confirmed validated import execution, retry/outcome recovery, result links, provenance and saved mapping lifecycle. **Acceptance:** AC-10–11 pass through UI and direct API checks. **Depends on:** T06.
- [ ] **ENQ-T08 — Verify and accept.** Run the verification matrix, relevant builds/tests and staff sessions; fix and retest blocking issues. **Acceptance:** all ACs have linked evidence and actual staff acceptance is recorded separately from developer verification. **Depends on:** T03–07.

## Verification matrix

| Scenario | Required checks |
|---|---|
| New/edited enquiry | Minimum valid input, optional/custom answers, missing conversion requirements, invalid input, failed save, repeated click, dirty dismissal. |
| Follow-up | Discoverable entry, local-date boundary, note/date validation, interest update, no next date, failed/retried save, timeline/count refresh, converted record. |
| Register | Combined filters/sorts, ties and missing dates, multi-page results, presets, no match, load failure, reload/Back/return context. |
| Non-template upload | Different headings, shifted header row, multiple sheets, blank/duplicate headings, ignored columns and optional template. |
| Mapped values | Course alias/unmatched course, interest mapping, defaults versus source values, custom questions, phone leading zeros and date/formula policy. |
| Review/correction | Invalid rows, explicit skips, duplicate candidates, before/after updates if supported, error report, re-upload after correction. |
| Concurrent/failed import | Replaced file during preview, stale responses, changed plan, double commit, lost response, retry and agreed partial/atomic outcomes. |
| Saved mapping | Valid reuse, changed headers, retired questions, missing course/option and mapping access revocation. |
| Permissions | Reader/manager/catalog-role distinctions, direct API denial, source/result access and commit after permissions change. |
| Usability | Actual admissions staff add an enquiry, schedule a follow-up, import a customer-format file and create/open an admission without developer guidance. |

## Definition of done and evidence

All acceptance criteria and execution tasks have passed with evidence. Record design acceptance, implementation references, test commands/results, datasets, role, viewport and screenshots for authenticated checks. Preserve existing records and audit/provenance. Unverified scenarios remain open; existing backend tests do not stand in for Add/Import browser acceptance.

- Named owner and acceptance reviewer: unassigned.
- Product behavior: accepted by the user, 16 October 2026 (table above).
- Technical/lifecycle details and API contract: pending.
- Design and user review: pending.
- Implementation and test evidence: pending.
- Staff review and unresolved issues: pending.
