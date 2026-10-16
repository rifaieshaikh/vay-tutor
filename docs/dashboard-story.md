# DASH-01 — Professional institute overview dashboard

Date: 16 October 2026 · Status: implemented; staff acceptance is still open.

## User story

As an institute staff member, I want a clear dashboard showing the institute's current position and work needing attention, so I can understand priorities and reach the right records quickly.

## Intended experience

A compact header shows **Overview**, institute name, the current institute-local date, **Filters** and **Quick actions**. Below it, show lightweight summary figures, a prominent Needs attention section and a secondary Recent activity feed. Use neutral surfaces, readable typography, subtle separators and deliberate spacing. Reserve warning colors for actual exceptions. Avoid decorative charts, unnecessary descriptions and a separate card around every element.

Remove the always-visible Branch / Course / Period / Batch bar from the dashboard. Dashboard filters are branch, course, and batch only. Period is not a dashboard filter. The default view contains all data the signed-in user is authorized to access. Selected filters appear as readable removable chips only after selection.

This story changes the dashboard and its destination-query integration. Removing context bars or redesigning filters on other pages belongs to the broader [modern UI plan](modern-ui-task-list.md).

## Decisions

Decided 16 October 2026:

- Dashboard filters are branch, course, and batch. Period is not a dashboard filter. It stays the batch session key on the registers and reports that already own it. The dashboard does not offer it, does not treat a `period` query as applied scope, and does not send `period` on destination links.
- **Follow-ups due** is one count. It is not also shown as overdue follow-ups. An enquiry is included when it is not yet an admission and its latest follow-up date is before the institute-local today. A missing date, today, and a later date are not due.
- **Admissions awaiting enrollment** is one count. It is not also shown as incomplete admissions. It counts open admissions that are not yet enrolled, including those still missing answers or an identity decision.
- The institute stores a timezone. The header date and follow-up due use that zone's calendar date. They do not use the browser zone or the server's UTC date.
- Failed imports are counted per batch. Branch and course narrow the count through the batches they contain. A selected batch includes only imports attributed to that batch. An import with no batch is not presented as part of a filtered batch.
- Recent activity reads a business-change log. That log is separate from the technical audit log. Audit payloads are not its source.

Still required before coding:

- Inspect existing dashboard contracts, status definitions, record links and permissions before adding endpoints or fields.
- A metric the person cannot access is hidden. A zero is shown only after a successful authorized query. A section that cannot honor a selected filter states its real scope.
- Branch, course, and batch apply to enrolled students, active batches, marksheets awaiting review, and failed imports. Enquiries and open admissions take course only.
- Review populated desktop/mobile designs plus filtered, loading, empty and error states before coding, consistent with UI-03 in the modern UI plan.

## Acceptance criteria

### AC-01 — Header and visual hierarchy

- [ ] Header contains Overview, institute name, institute-local date, Filters and permission-aware Quick actions.
- [ ] No permanently visible academic dropdown bar appears on the dashboard.
- [ ] Summary figures, Needs attention and Recent activity have distinct visual hierarchy without redundant headings or explanatory paragraphs.
- [ ] User-reviewed desktop and mobile designs are linked in the evidence section before application implementation.

### AC-02 — Authorized default scope

- [ ] Opening a dashboard URL without filter parameters shows all authorized data with no selected-filter chips.
- [ ] Options, records, aggregates and activity respect existing action permissions and complete scope tuples, including disjoint grants.
- [ ] Accounts lacking access to a metric/action cannot infer its protected counts or reach it through dashboard controls.

### AC-03 — Filter panel behavior

- [ ] Filters opens an accessible panel initialized from the applied selections, with appropriate labels and permitted options.
- [ ] Changing the panel draft does not change dashboard results. Apply validates and commits selections together; Cancel, Escape and outside dismissal preserve the applied view.
- [ ] Reset clears the panel draft; results change only after Apply. Clear all outside the panel immediately restores all authorized scope.
- [ ] Changing a parent field clears incompatible descendants while retaining unrelated valid selections.
- [ ] Failed option loads show an error and Retry, preserve selections and never appear as an empty set of valid choices.

### AC-04 — Applied scope and section consistency

- [ ] Applied filters appear as readable individually removable chips; removing a parent handles dependent criteria consistently.
- [ ] Every summary/queue/activity section applies exactly the filters supported by its documented relationship mapping.
- [ ] A section that does not support a selected filter clearly states its actual scope; it is never silently presented as fully filtered.
- [ ] Requests that fail or are superseded cannot replace a newer selected view with stale results or silently broaden its scope.

### AC-05 — Summary figures

- [ ] Display the applicable authorized metrics: currently enrolled students, active batches, admissions awaiting enrollment and follow-ups due.
- [ ] Follow-ups due counts enquiries that are not yet admissions and whose latest follow-up date is before the institute-local today. Admissions awaiting enrollment counts open admissions that are not yet enrolled. Student counts use distinct people. Active batches are batches with no end date.
- [ ] Each figure opens a destination whose filters and count reconcile with the figure; any required destination-query support is implemented before enabling the link.
- [ ] No illustrative data, unsupported trend comparisons or unavailable values are presented as live metrics.

### AC-06 — Needs attention

- [ ] Show applicable queues for marksheets awaiting review and failed imports, each with a labeled destination action. Follow-ups due and admissions awaiting enrollment are the summary figures, not second queues.
- [ ] Failed imports are counted per batch and follow the selected branch, course, and batch. Supporting context, such as oldest outstanding date, is shown only when available and accurately calculated.
- [ ] Marksheets awaiting review remain submitted sheets. Drafts stay out.
- [ ] When all successfully loaded authorized queues are empty, show a quiet completion state. Loading/error/unavailable queues never produce a false all-clear.

### AC-07 — Recent activity and quick actions

- [ ] Recent activity shows authorized entries from the business-change log, with record identity, understandable action, context, timestamp and a valid record link.
- [ ] The business-change log is separate from the technical audit log. Audit payloads and sensitive hidden fields are not copied into the feed. Missing or deleted records have a defined non-broken presentation.
- [ ] Quick actions offers only permitted supported tasks, such as Add enquiry, Create admission and Enter marks, without becoming a duplicate sidebar.
- [ ] Navigating through any dashboard action respects existing unsaved-work guards and normal backend authorization.

### AC-08 — Navigation continuity

- [ ] Applied filter state is represented in the dashboard URL so reload and browser Back/Forward recreate the same valid view.
- [ ] Opening a queue, metric or record and returning preserves the dashboard's applied filters.
- [ ] Destination links carry only meaningful supported criteria; unsupported dashboard filters are not sent as though they restricted destination results.
- [ ] Invalid or no-longer-authorized URL selections follow an explicit correction/error policy and do not silently expose broader data.

### AC-09 — Loading, empty and error states

- [ ] Loading placeholders preserve the intended section layout; loading is not displayed as zero.
- [ ] Empty institute, no results under selected filters, no available dashboard permissions and no pending work have distinct appropriate messages/actions.
- [ ] Failed sections show recoverable errors and Retry without hiding successfully loaded sections. If the API is atomic, preserve last successful data with a visible stale/error state rather than claiming current totals.
- [ ] Confirmed mutations use the shared notification system; fetch failures remain visible near their affected content rather than relying solely on transient popups.

### AC-10 — Accessibility and responsive layout

- [ ] Header, figures, rows, filter panel and chips work at 360, 390, 768 and 1280 CSS pixels without unintended document-wide horizontal scrolling.
- [ ] Filters/Quick actions support keyboard opening, selection and dismissal; a modal traps/restores focus and makes the background inert.
- [ ] Controls have accessible names, visible focus and useful status announcements; color alone never conveys state.
- [ ] At 200% text zoom, labels, counts and actions remain readable and reachable without overlap or clipping.

## Execution checklist

- [ ] **1. Inspect and specify.** Inventory current dashboard/frontend/backend behavior; record metric definitions, timezone, permissions, per-section filter mapping and destination contracts.
- [ ] **2. Design and review.** Create realistic desktop/mobile designs and state variants. Record user acceptance of the direction and resolve scope ambiguities.
- [ ] **3. Implement data contracts.** Reuse or extend authorized dashboard aggregation/activity APIs and destination queries; add meaningful fixtures for date boundaries, multiple enrollments and disjoint scopes.
- [ ] **4. Implement presentation and filtering.** Build the header, compact panel, chips, figures, queues and activity using shared UI patterns. Remove the dashboard's persistent context bar.
- [ ] **5. Connect navigation and feedback.** Implement URL state, contextual destination links, return behavior, retry, loading and empty/error states.
- [ ] **6. Verify and review.** Run appropriate builds/tests and authenticated desktop/mobile/keyboard checks, reconcile figures with destinations and record staff feedback before closing the story.

## Required verification

| Scenario | Expected evidence |
|---|---|
| Administrator, no filters | All authorized metrics/queues agree with contributing records; no academic dropdown bar. |
| Scoped staff and disjoint grants | No cross-combination records, options, activity or aggregate leakage through UI or direct API requests. |
| Combined branch/course/batch | Only supported relationships filter each section; exceptions are labeled; linked destination counts agree. A `period` query does not narrow the dashboard or its destination links. |
| Apply/Cancel/Reset/chip removal/Clear all | Correct draft-versus-applied behavior, dependency clearing and URL state. |
| Multiple enrollments and date boundaries | Distinct student counts. Follow-ups due include only dates before the institute timezone's today, and exclude today. |
| Reload, Back/Forward and record return | Applied view is restored without dropped or silently broadened scope. |
| Empty, no match, unavailable and failed requests | Distinct states; no false zero/all-clear; retry recovers without discarding valid state. |
| Slow/out-of-order requests | Latest selected view wins; stale data is not labeled current. |
| Desktop/mobile, keyboard and text zoom | Screenshots/checklist cover AC-10 and panel focus behavior. |

## Definition of done

All acceptance criteria and execution steps are checked with evidence. Relevant frontend build/backend checks pass. A staff review verifies that people can understand the overview and reach the intended work without developer guidance. Developer walkthroughs are recorded separately from user/staff acceptance. Existing identities, publication policies, audit/provenance and authorization remain intact. Any incomplete criteria leave this story open.

## Evidence and completion record

- Metric definitions and section/filter mapping: decided 16 October 2026. Period is excluded. Follow-ups due and admissions awaiting enrollment are single counts. The institute stores a timezone. Failed imports are per batch. Recent activity uses a separate business-change log.
- Design/prototype and user review: pending. The overview was built from the written criteria. A reviewed design file is not linked.
- Implementation references: `frontend/src/pages/Overview.tsx`, `backend/app/dashboard/routes.py`, `backend/app/clock.py`, `backend/app/business.py`, institute timezone on Settings, batch visibility in `backend/app/academics/catalog.py`, and import batch attribution in `backend/app/importing/commit.py`.
- Test commands/results and dataset: `cd backend && PYTHONPATH=. .venv/bin/ruff check app && PYTHONPATH=. .venv/bin/python -m pytest tests/test_dashboard.py tests/test_phase6.py tests/test_m3.py`. Passed 16 October 2026. Frontend `tsc --noEmit` passed. The dataset covers a past follow-up, a follow-up today-or-later, an ended second enrollment, a draft marksheet, an unattributed failed import, disjoint branch-and-course grants, and a failed commit that keeps its batch.
- Authenticated screenshots, viewport and role: checked in the signed-in IAM session on desktop. Narrow widths and text zoom were checked after the layout pass.
- Staff review and unresolved issues: pending. A person who uses the institute has not accepted the overview.
- Named owner / acceptance reviewer: unassigned.
