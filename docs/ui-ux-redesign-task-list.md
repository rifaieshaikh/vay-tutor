# UI and UX redesign task list

Date: 15 October 2026 · Status: planned; all tasks pending.

Objective: make Vay Tutor clear, consistent and easy for institute staff to use. Address the user's concerns about typography, unnecessary descriptions, repeated Enquiry/Admission/Student tabs, inadequate filters, inconsistent buttons and difficult workflows.

This is the active experience-design backlog alongside the [institute management restructuring](institute-management-task-list.md). Existing implementation and previous task completion do not imply acceptance of this redesign. No application changes are authorized by a checked planning item alone; this document records the work to implement and verify when undertaken.

## Phase 1 — Define the staff journeys

- [ ] **DES-01 — Audit all screens and interactions.** Inventory navigation, register/detail screens, forms, dialogs, descriptions, filters and actions across admissions, students, academics, staff, assessments, reports and administration, including sign-in. **Done when:** a screen map identifies each screen's purpose, intended role, entry point, primary action, next destination and current friction. **Owner:** Design/Product.
- [ ] **DES-02 — Define enquiry through enrollment.** Map enquiry creation, follow-up, admission creation, requirement completion, batch selection and enrollment into the student record. Include direct admission without an enquiry, existing students, incomplete details, duplicates, cancellation and permission restrictions. **Done when:** each stage has a clear status, available actions, required fields, validation and next step, without forcing staff to re-enter known information. **Owner:** Product/Admissions/Design.
- [ ] **DES-03 — Define other daily workflows.** Map student lookup/edit/transfer, branch-course-batch setup, teacher assignment, manual/imported marks, review/publication/correction and progress reporting. **Done when:** each journey includes its shortest supported route, return path, empty state, failure recovery and role restrictions; existing academic policies are retained. **Owner:** Product/Academic/Design.
- [ ] **DES-04 — Define navigation and record orientation.** Establish one destination for each module, meaningful breadcrumbs and record titles, active sidebar behavior and contextual links between lifecycle stages. **Done when:** the screen map removes competing routes/tabs and makes each record's owner clear while preserving existing URLs. **Owner:** Design/Frontend.

Exit: reviewable screen maps and journeys establish how staff finish tasks before broad visual changes begin.

## Phase 2 — Establish UI and writing standards

Depends on the screen inventory and initial workflow definitions.

- [ ] **DES-05 — Replace the typography.** Compare a small set of readable UI fonts using actual names, forms, tables, numbers and headings; select one family with sensible system fallbacks. Define font sizes, weights and line heights, including tabular numerals where useful. Bundle any selected font for offline use and verify its license. **Done when:** representative desktop/mobile screens have a coherent hierarchy, legible dense data and no clipping at 200% text zoom. **Owner:** Design/Frontend.
- [ ] **DES-06 — Define layout and visual tokens.** Standardize spacing, content widths, section hierarchy, colors, borders, status indicators, focus states and control sizes in shared styles. **Done when:** a representative register, detail page and dialog use the same rules, text/control contrast is checked and status meaning is available without color alone. **Owner:** Design/Frontend.
- [ ] **DES-07 — Standardize buttons and actions.** Define primary, secondary, quiet and destructive styles. Use visible text for important actions such as Add enquiry, Save and Enroll; reserve icon-only controls for familiar compact utilities or repeated row actions with accessible names. Use one consistent footer pattern within dialogs. **Done when:** each screen/state has a clear primary action where applicable, equivalent actions look alike and no essential action depends on hover to explain itself. **Owner:** Design/Frontend.
- [ ] **DES-08 — Remove unnecessary descriptions.** Audit page leads, helper text, notices and repeated explanations. Remove redundant headings, implementation commentary and obvious instructions; move occasional guidance into appropriate help. Retain consequences, prerequisites, missing-data limitations and actionable errors. **Done when:** every remaining description helps a user make a decision or complete the current task; common terminology, date formats and labels are consistent. **Owner:** Product/Design.
- [ ] **DES-09 — Define shared interaction patterns.** Specify forms, field validation, search, filters, sort, tables, pagination, tabs, dialogs and loading/empty/error/success states. Choose full pages for long multi-step work and dialogs for bounded tasks. **Done when:** patterns specify behavior as well as appearance, including keyboard interaction, dismissal and unsaved changes. **Owner:** Design/Frontend.

Exit: a compact UI specification and shared components/styles can support a complete reference workflow.

## Phase 3 — Redesign enquiry through enrollment first

Depends on DES-02 and DES-04–09. This is the reference implementation for the rest of the application.

- [ ] **DES-10 — Remove repeated people tabs.** Remove the Enquiry/Admission/Student tab strip from registers and related screens. Use primary navigation for destinations and explicit contextual actions for stage transitions. Fix owning-section highlighting on detail pages. **Done when:** each destination has one clear navigation entry and a person can advance through admissions without using duplicate module tabs. **Owner:** Frontend/Design.
- [ ] **DES-11 — Simplify the enquiry register and record.** Provide inline name/contact search, relevant filters, readable status/next-follow-up information and labeled creation/follow-up actions. Show only the information needed to choose or act on a record. **Done when:** staff can add, find, follow up and advance an enquiry without hunting through menus or re-entering known data. **Owner:** Frontend/Backend/Admissions.
- [ ] **DES-12 — Simplify admission and enrollment.** Organize fields into meaningful sections, distinguish optional information from enrollment requirements and show missing requirements at the point of action. Preserve entered values after errors and prefill linked information. **Done when:** direct and enquiry-based admissions both reach one correct student/enrollment record, with clear recovery for missing details, duplicate identity or unavailable batches. **Owner:** Frontend/Backend/Admissions.
- [ ] **DES-13 — Protect progress and explain outcomes.** Apply consistent dirty-state handling to Close, Cancel, backdrop, Escape, route navigation and browser history/refresh. Prevent duplicate submission and show pending/success/failure feedback. **Done when:** accidental dismissal cannot silently lose changed forms, failures retain data and successful enrollment offers a clear next destination. **Owner:** Frontend/Backend.
- [ ] **DES-14 — Validate the reference journey with staff.** Walk through a new enquiry, direct admission, returning student and incomplete admission using representative data. Record wrong turns, avoidable clicks, repeated entry and help needed. **Done when:** operators complete the agreed scenarios without developer guidance and blocking usability issues are resolved; retain desktop/mobile evidence. **Owner:** Product/Admissions/QA.

Exit: an accepted admissions workflow provides concrete typography, copy, filters, actions and interaction patterns for reuse.

## Phase 4 — Fix filtering and roll out the patterns

- [ ] **DES-15 — Define the filter contract.** Document available filters for each register and report, distinguishing shared academic context from page-specific search/status/date/subject filters. Define scope semantics, default values, dependent clearing, URL persistence, browser Back behavior and reset. Keep one meaning for each value if shown in multiple places. **Done when:** staff can understand what dataset is shown and how to broaden or narrow it without competing filter layers. **Owner:** Product/Design/Backend.
- [ ] **DES-16 — Implement consistent search and filters.** Put frequent search inline; expose common filters and place infrequent ones behind a labeled More filters control. Show removable applied filters, result count, clear actions and useful no-results recovery. Choose predictable immediate-update versus Apply behavior and handle loading/error/retry explicitly. **Done when:** Students, Enquiries, Admissions, Batches and Marksheets follow the same interaction rules with appropriate fields; context failures never appear as empty choices. **Owner:** Frontend/Backend.
- [ ] **DES-17 — Improve directories and tables.** Prioritize identifying fields, make record names easy to open, standardize sort/pagination and reduce repeated row actions. Contain overflow within table regions and provide a useful narrow-screen layout. **Done when:** key information and actions remain reachable at 360, 390, 768 and 1280 CSS pixels without unintended page-wide horizontal scrolling. **Owner:** Frontend/Design.
- [ ] **DES-18 — Streamline student and batch workspaces.** Provide a concise summary and direct access to relevant sections. Reveal enrollment, editing and teacher-assignment forms through explicit actions instead of permanently expanding every form. Preserve context and return destinations. **Done when:** users can find a student's enrollment/progress and a batch's students/teachers/assessments without traversing unrelated setup controls. **Owner:** Frontend/Backend/Academic.
- [ ] **DES-19 — Simplify assessment entry and publication.** Make manual entry and import clear entry choices; show draft/submitted/published status and the next allowed action. Keep revision and correction behavior understandable and preserve edits across failures. **Done when:** operators can enter/import, resolve blockers, review and publish without inferring steps from scattered buttons; navigation cannot silently discard score edits. **Owner:** Frontend/Backend/Academic.
- [ ] **DES-20 — Apply standards to remaining screens.** Update dashboard, academic setup, staff, reports, access, audit, settings and sign-in using the accepted patterns. Make dashboard language reflect actual queues rather than implying personal assignment where none exists. Show authentication fields only when applicable, with persistent guidance when needed. **Done when:** typography, descriptions, action placement and interaction behavior are consistent across every inventoried screen and state. **Owner:** Frontend/Product.

Exit: consistent interactions cover the application, including less-frequent administration tasks.

## Phase 5 — Verify accessibility, usability and regressions

- [ ] **DES-21 — Complete keyboard and focus behavior.** Ensure dialogs set, contain and restore focus; background controls are unavailable while modal; actual tabs support expected keyboard interaction and linked panels. Use navigation-link semantics for route changes. Verify focus after route changes and errors. **Done when:** representative admissions, import, score editing and reporting journeys are completable using keyboard only with visible focus and understandable labels. **Owner:** Frontend/QA.
- [ ] **DES-22 — Verify forms and feedback.** Associate field errors with inputs, announce asynchronous outcomes, distinguish loading/empty/failed states and retain user work. Check touch targets and avoid icon/color-only meaning for essential actions. **Done when:** users can identify and correct invalid fields and distinguish a failed request from no matching records. **Owner:** Frontend/QA.
- [ ] **DES-23 — Verify role and data scenarios.** Exercise administrator, admissions operator and scoped teacher journeys with empty/populated datasets and restricted actions. Confirm that redesigned navigation, filters and counts preserve server-enforced access and published-result rules. **Done when:** UI actions match permissions and direct API checks still reject unauthorized operations. **Owner:** Backend/QA.
- [ ] **DES-24 — Run focused regression and visual checks.** Run the frontend build and relevant backend checks for changed contracts; add meaningful tests for changed dirty-state, filter and lifecycle behavior. Capture authenticated desktop/mobile screens, text zoom and print reports. **Done when:** checks pass and each regression scenario below has evidence of a fix or a documented unresolved disposition. **Owner:** Engineering/QA.
- [ ] **DES-25 — Accept and document the redesign.** Repeat the three core journeys—admissions to enrollment, batch/student to progress, and marks entry to publication/report—with representative staff. Update screenshots, developer UI guidance and backlog status. **Done when:** staff accept the revised flows, blocking issues are resolved and unfinished items remain explicitly open. **Owner:** Product/Academic/Admissions/QA.

## Execution rules

- All tasks start open. Record evidence before marking acceptance complete; role labels are responsibilities, not assigned individuals.
- Implement one coherent reference journey before changing every screen. Do not treat cosmetic changes alone as workflow completion.
- Preserve current work, canonical identities, enrollment history, audit records, access boundaries, assessment policies and existing links.
- Prefer shared components and style tokens over local visual fixes; do not introduce a second competing pattern.
- This backlog reorganizes and improves existing capabilities. New fees, attendance, payroll or portal modules need separate requirements.

## Regression scenarios carried forward from the review

These implementation-backed concerns require authenticated visual and interaction verification; they were not previously accepted as resolved.

| Scenario | Task coverage |
|---|---|
| Wide register tables lack general overflow containment; verify far-right actions on small screens. | DES-17, DES-24 |
| Score edits have refresh protection and a guarded back link, but sidebar navigation can bypass the warning. | DES-13, DES-19 |
| Changed enquiry forms can dismiss through backdrop or Escape without a dirty-state check. | DES-13 |
| Import dialog lacks initial focus, focus containment and restoration. | DES-21 |
| Shared context and local filters repeat scope controls; student search is hidden in a dialog. | DES-15, DES-16 |
| Failed context-option requests are suppressed and can look like empty choices. | DES-16, DES-22 |
| Detail-page navigation loses the owning highlight; repeated people tabs compete with module navigation. | DES-04, DES-10 |
| Batch management forms lengthen the page; enrollment search needs explicit no-results feedback and consistent date formatting. | DES-08, DES-18, DES-22 |
| Tab roles lack complete keyboard/panel behavior; route links should use navigation semantics. | DES-21 |
| Destructive actions share routine button styling; important creation actions rely on icons. Preserve existing typed reset confirmation. | DES-07, DES-20 |
| Local sign-in shows a cloud-only authentication-code field; improve persistent guidance, password visibility, recovery guidance and error announcements. | DES-20, DES-22 |
