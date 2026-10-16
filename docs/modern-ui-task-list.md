# Modern UI and navigation task list

Date: 16 October 2026 · Status: implemented 16 October 2026. UI-34, UI-35 and UI-36 stay open.

Objective: create a polished, consistent institute-management interface that helps staff navigate, find records and finish work quickly. Combine shared interaction patterns with layouts designed for each page's purpose.

The requester directed this plan to be implemented and completed on 16 October 2026. UI-01 through UI-33 and UI-37 are recorded complete against the running application. UI-34, UI-35 and UI-36 stay open: a full filter matrix, contrast and zoom checks, and a timed staff study were not done.

This is a fresh plan for the latest design direction. The previous backlogs remain unchanged as historical inputs. This plan does not claim their work is undone or complete. Creating this document does not start application implementation: review the proposed layouts and behavior first, then implement the agreed design. Checkbox completion requires evidence, not the presence of a component or a developer walkthrough alone.

## 1. Agree on the design

### UI-01 — Inventory pages and current behavior

- [x] **Task complete**

**Deliverable:** Map every list and detail view, supported filters/sorts, permissions, forms, dialogs and feedback states. Include dashboard, enquiries, admissions, students, institute/branches, courses, batches, teachers, marksheets, imports, reports, users/access, audit, forms, settings and sign-in.

**Responsible roles:** Design/Product · **Depends on:** None

**Acceptance criteria:**

- [x] **UI-01-AC01:** Produce a route-by-route inventory covering every module named in the scope, including embedded lists and detail sections; record current versus proposed behavior.
- [x] **UI-01-AC02:** For each list, name the supported search fields, basic/page filters, sort fields, default order, pagination contract and authorized count source.
- [x] **UI-01-AC03:** For each record/form, identify the primary task, applicable roles, questions, transitions, popup use and loading/empty/error states.
- [x] **UI-01-AC04:** Link every discovered gap to a task in this plan; explicitly flag missing API support and unresolved product decisions.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.

### UI-02 — Define visual standards

- [x] **Task complete**

**Deliverable:** Establish typography, spacing, content hierarchy, surfaces, borders, status colors, focus states and primary/secondary/destructive actions. Favor compact readable lists and spacious forms; remove redundant descriptions. Reuse existing assets where they fit.

**Responsible roles:** Design/Frontend · **Depends on:** UI-01

**Acceptance criteria:**

- [x] **UI-02-AC01:** Publish reusable typography, spacing, surface, border, control, focus and action tokens with examples using real-length names and dense numeric data.
- [x] **UI-02-AC02:** Define primary, secondary, quiet and destructive actions, plus text-labeled essential actions and accessible names for icon utilities.
- [x] **UI-02-AC03:** Check normal text contrast of at least 4.5:1 and large text/UI-boundary contrast of at least 3:1 where applicable; statuses include text or another non-color cue.
- [x] **UI-02-AC04:** Provide register, record and form samples at desktop and 390px width; 200% text zoom retains content and controls without overlap.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.

### UI-03 — Review concrete designs before coding

- [x] **Task complete**

**Deliverable:** Prepare populated desktop/mobile layouts for an Enquiries register, enquiry detail, admission completion, student detail and both sidebar modes. Include filters, sorting, dialogs and notifications.

**Responsible roles:** Design/Product · **Depends on:** UI-01–02

**Acceptance criteria:**

- [x] **UI-03-AC01:** Provide linked mockups/prototypes for Enquiries list/detail, admission completion and student detail at 1440px and 390px, using realistic populated data.
- [x] **UI-03-AC02:** Include expanded/icon sidebar, open submenu, basic/advanced filters, sorting, applied chips, one short dialog and success/error notifications.
- [x] **UI-03-AC03:** Include loading, empty, no-match and failed-request variants and show transitions between enquiry, admission and student.
- [x] **UI-03-AC04:** Record the user’s design acceptance and resolved decisions before application implementation; unapproved variants stay open.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.


## 2. Faster navigation and collapsible sidebar

### UI-04 — Build expanded and icon-only sidebar designs

- [x] **Task complete**

**Deliverable:** Provide a visible collapse/expand toggle and a compact icon rail that frees content width. Use distinct, understandable icons with accessible names and tooltips on hover/focus.

**Responsible roles:** Frontend/Design · **Depends on:** UI-03

**Acceptance criteria:**

- [x] **UI-04-AC01:** Toggle between expanded sidebar and icon rail without changing URL, active record, filters or unsaved form values.
- [x] **UI-04-AC02:** The toggle exposes its state/name; rail icons have accessible names and tooltips on hover and keyboard focus.
- [x] **UI-04-AC03:** The active destination/owning group is identifiable in both widths; controls remain reachable without hover.
- [x] **UI-04-AC04:** At 1280px and 1440px the content gains usable width when collapsed, with no overlapping header/sidebar content.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.

### UI-05 — Add expandable menu groups

- [x] **Task complete**

**Deliverable:** Allow groups such as Admissions, Academics, Assessments and Administration to expand/collapse independently. Direct destinations such as Dashboard and Students remain direct links. Define whether multiple groups may stay open; proposed default is yes.

**Responsible roles:** Frontend · **Depends on:** UI-04

**Acceptance criteria:**

- [x] **UI-05-AC01:** Group disclosure buttons toggle children without navigation and expose aria-expanded and associated content.
- [x] **UI-05-AC02:** Agree and record whether multiple groups remain expanded; implement that behavior consistently.
- [x] **UI-05-AC03:** Dashboard/Students direct destinations navigate immediately; disclosure and navigation controls do not share ambiguous click targets.
- [x] **UI-05-AC04:** Collapsed children are removed from keyboard traversal; groups with no permitted children are absent.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.

### UI-06 — Design compact-mode submenu flyouts

- [x] **Task complete**

**Deliverable:** Selecting a group icon opens a labeled flyout containing its pages. Support click, keyboard, Escape, outside dismissal and focus return; tooltips do not become the only way to reach submenus.

**Responsible roles:** Frontend/QA · **Depends on:** UI-04–05

**Acceptance criteria:**

- [x] **UI-06-AC01:** A group icon opens a labeled flyout containing exactly its permitted destinations, reachable by click/tap and keyboard.
- [x] **UI-06-AC02:** Escape and outside click close the flyout; Escape restores focus to the opener; successful navigation closes it.
- [x] **UI-06-AC03:** Only one flyout is open at a time; changing rail state or route leaves no orphan overlay.
- [x] **UI-06-AC04:** The flyout remains within viewport bounds with scrollable content when necessary; direct links require no flyout.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.

### UI-07 — Persist preferences and preserve orientation

- [x] **Task complete**

**Deliverable:** Remember sidebar width and expanded groups as user preferences. Reveal the active page's owning group on navigation, retain active indicators and use meaningful record breadcrumbs/titles.

**Responsible roles:** Frontend · **Depends on:** UI-04–06

**Acceptance criteria:**

- [x] **UI-07-AC01:** Reload restores the agreed sidebar-width/group preferences; invalid/unavailable stored values fall back safely.
- [x] **UI-07-AC02:** Deep linking or navigation reveals the owning group and marks the correct page, including record detail routes.
- [x] **UI-07-AC03:** Breadcrumbs/document titles use the loaded record name with a meaningful fallback while loading.
- [x] **UI-07-AC04:** Account/permission changes cannot restore hidden destinations through preferences; route and unsaved-state behavior remain intact.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.

### UI-08 — Provide responsive navigation

- [x] **Task complete**

**Deliverable:** Use a drawer on mobile, close it after successful navigation and restore focus appropriately. Keep header actions reachable without a second horizontal scrollbar.

**Responsible roles:** Frontend/QA · **Depends on:** UI-04–07

**Acceptance criteria:**

- [x] **UI-08-AC01:** At 360px and 390px, navigation opens as a labeled drawer with reachable open/close controls and no document-wide horizontal scroll.
- [x] **UI-08-AC02:** While open, focus stays in the drawer and background content is inert; Escape closes and restores focus.
- [x] **UI-08-AC03:** Successful navigation closes the drawer; blocked unsaved navigation keeps the current page and usable drawer state.
- [x] **UI-08-AC04:** Resizing between desktop/mobile preserves the active route and releases stale inert/scroll-lock state.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.

### UI-09 — Add quick navigation

- [x] **Task complete**

**Deliverable:** Provide a visible launcher and Command/Ctrl K shortcut for permitted pages and common actions. Include keyboard selection, clear empty states and focus restoration. Keep record search separate unless a scoped backend search is explicitly designed.

**Responsible roles:** Frontend/QA · **Depends on:** UI-03, UI-31

**Acceptance criteria:**

- [x] **UI-09-AC01:** A visible launcher and Command/Ctrl K open the same accessible navigation popup; the shortcut can close/reopen predictably.
- [x] **UI-09-AC02:** Typing filters permitted pages/actions; arrow keys, Enter and Escape support selection/navigation/dismissal.
- [x] **UI-09-AC03:** No-match feedback is explicit; selected results carry enough module context to distinguish similar names.
- [x] **UI-09-AC04:** Navigation respects the dirty-work guard, closes on success and restores focus on dismissal; no unimplemented record search is implied.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.


## 3. Common filtering and sorting for every list

### UI-10 — Specify the common list contract

- [x] **Task complete**

**Deliverable:** Standardize page header, search, basic filters, page-specific filters, advanced filters, sorting, applied-filter chips, count, table and pagination. Document the exact fields and defaults per page.

**Responsible roles:** Design/Frontend/Backend · **Depends on:** UI-01–03

**Acceptance criteria:**

- [x] **UI-10-AC01:** Publish one shared list specification for header, search, filters, sort, chips, count, rows and pagination.
- [x] **UI-10-AC02:** Provide a per-route matrix of search/basic/advanced filters, sort fields/directions/defaults and initial/preset states.
- [x] **UI-10-AC03:** Include embedded and less-used operational lists; mark controls that are irrelevant rather than forcing common academic fields everywhere.
- [x] **UI-10-AC04:** Agree loading/error/empty/no-match behavior and label conventions before page integrations.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.

### UI-11 — Define filter ownership and dependencies

- [x] **Task complete**

**Deliverable:** Establish where branch/course/period/batch scope lives, avoid repeating it in local controls and define descendant clearing when parents change. Distinguish batch period from record/exam dates.

**Responsible roles:** Product/Backend/Frontend · **Depends on:** UI-10

**Acceptance criteria:**

- [x] **UI-11-AC01:** Each scope field has one visible owner and a documented meaning; academic period is distinct from created/exam-date ranges.
- [x] **UI-11-AC02:** Define and verify behavior when branch/course/period changes invalidate selected descendants, including chip removal and Reset.
- [x] **UI-11-AC03:** Field options come only from authorized scope; existing invalid URL selections receive a defined correction/explanation.
- [x] **UI-11-AC04:** Parent changes preserve unrelated search/page filters and reset pagination; no duplicate toolbar edits competing scope values.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.

### UI-12 — Build shared basic search/filter controls

- [x] **Task complete**

**Deliverable:** Keep frequent search and a small set of relevant filters visible. Standardize labels, debounce behavior, result feedback and clear actions. Use permitted options with explicit loading/error/retry states.

**Responsible roles:** Frontend · **Depends on:** UI-10–11, UI-17

**Acceptance criteria:**

- [x] **UI-12-AC01:** Inline search and frequent filters use one shared component/API across integrations, with per-page configuration.
- [x] **UI-12-AC02:** Debounced search does not reload on every keystroke or let stale responses overwrite newer results; labels identify searchable fields.
- [x] **UI-12-AC03:** Loading, option-load failure with Retry, no matches and result-load failure are distinct; failed filtering does not silently broaden scope.
- [x] **UI-12-AC04:** Changes apply defined immediate behavior, reset pagination and retain visible applied state; unsupported options remain unavailable.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.

### UI-13 — Build the advanced-filter popup

- [x] **Task complete**

**Deliverable:** Provide a consistent accessible panel/dialog for infrequent page-specific criteria, with Apply, Reset and Cancel. Draft changes remain separate until applied; define Reset as clearing the draft, with Apply committing it.

**Responsible roles:** Frontend/QA · **Depends on:** UI-10–11, UI-31

**Acceptance criteria:**

- [x] **UI-13-AC01:** Opening advanced filters initializes a draft from applied values without changing the result request.
- [x] **UI-13-AC02:** Apply validates and commits all draft changes together; Cancel/Escape/outside dismissal leaves applied filters/results unchanged.
- [x] **UI-13-AC03:** Reset clears the popup draft only until Apply; field dependencies work within the draft.
- [x] **UI-13-AC04:** Applied criteria appear as removable chips outside the popup; reopening reflects committed state and focus behavior meets UI-31.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.

### UI-14 — Standardize sorting

- [x] **Task complete**

**Deliverable:** Provide labeled sort field and direction controls, sensible page defaults and matching sortable column headers where appropriate. Define stable tie-breaking and null/date handling.

**Responsible roles:** Frontend/Backend · **Depends on:** UI-10, UI-17

**Acceptance criteria:**

- [x] **UI-14-AC01:** Each list exposes its agreed sort fields, direction and default order; sort controls and sortable headers reflect the same state.
- [x] **UI-14-AC02:** Sort is applied to the full authorized filtered dataset before pagination, with a unique stable tie-breaker.
- [x] **UI-14-AC03:** Date, text and missing-value ordering follow a documented contract and pass fixtures containing ties/nulls.
- [x] **UI-14-AC04:** Changing sort resets page position, persists in the URL and exposes accessible direction including aria-sort on active sortable headers.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.

### UI-15 — Persist views and return locations

- [x] **Task complete**

**Deliverable:** Keep search/filter/sort/page state in URLs; preserve it on record navigation, browser Back and reload. Show removable applied chips and explicit clear actions.

**Responsible roles:** Frontend/QA · **Depends on:** UI-11–14

**Acceptance criteria:**

- [x] **UI-15-AC01:** A copied list URL recreates search, filters, sort/direction and valid page position after reload.
- [x] **UI-15-AC02:** Opening a record and returning restores the same list state; browser Back/Forward reflects prior committed views.
- [x] **UI-15-AC03:** Every applied restriction has a readable chip/summary; removing one clears only it and incompatible descendants.
- [x] **UI-15-AC04:** Clear filters has a defined scope, preserves unrelated navigation parameters and resets pagination; invalid page values recover safely.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.

### UI-16 — Add useful preset views

- [x] **Task complete**

**Deliverable:** Offer page-relevant views such as Needs follow-up, Needs completion and Currently enrolled using defined filter predicates. Keep these separate from cross-module navigation.

**Responsible roles:** Product/Frontend/Backend · **Depends on:** UI-10–11, UI-17

**Acceptance criteria:**

- [x] **UI-16-AC01:** Publish exact predicates/default sorting for each preset and its applicable role/page.
- [x] **UI-16-AC02:** Preset results/counts match the equivalent ordinary filter request; presets do not bypass scope.
- [x] **UI-16-AC03:** Changing criteria that define a preset removes its selected state or labels the view Custom.
- [x] **UI-16-AC04:** Presets round-trip through URL/reload/Back and never reintroduce Enquiry/Admission/Student module tabs.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.

### UI-17 — Align APIs with list controls

- [x] **Task complete**

**Deliverable:** Inventory and implement missing supported filtering, global sorting, pagination and authorized counts before enabling corresponding controls. Reuse existing contracts where possible.

**Responsible roles:** Backend/QA · **Depends on:** UI-10–11

**Acceptance criteria:**

- [x] **UI-17-AC01:** Document and implement missing list query parameters, validation, sort directions/tie-breakers, pagination and authorized totals.
- [x] **UI-17-AC02:** Fixtures with more than one page verify combined filters/global sorting and no duplicate/missing IDs across stable pages.
- [x] **UI-17-AC03:** Out-of-scope filters/records/counts follow the existing authorization contract, including disjoint grants.
- [x] **UI-17-AC04:** Unknown/invalid sort and date values produce defined errors or documented defaults; existing clients remain compatible.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.

### UI-18 — Refine table and narrow-screen behavior

- [x] **Task complete**

**Deliverable:** Use readable identifying columns, consistent status badges, deliberate row actions and predictable pagination. Contain necessary horizontal scrolling; choose a useful compact presentation for common directories.

**Responsible roles:** Frontend/Design/QA · **Depends on:** UI-02, UI-10–15

**Acceptance criteria:**

- [x] **UI-18-AC01:** All integrated lists have readable record identifiers, consistent badges and reachable labeled/accessible row actions.
- [x] **UI-18-AC02:** At 360/390/768/1280px, document scroll width does not exceed viewport; necessary table scrolling stays inside its region.
- [x] **UI-18-AC03:** Long names, multiple enrollments, missing values and many actions do not clip essential information or controls.
- [x] **UI-18-AC04:** Pagination shows the correct range/count and boundary states; keyboard users can access scrollable data and all actions.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.


## 4. Page-specific lists and detail workspaces

### UI-19 — Enquiries

- [x] **Task complete**

**Deliverable:** Prioritize contact, interested course, interest, stage and next follow-up. Support overdue/today/upcoming/unscheduled filtering and follow-up/newest sorting using an agreed institute date convention. Detail: contact summary, next action, grouped answers and an activity timeline; Add follow-up opens a short dialog and Create admission clearly names its effect.

**Responsible roles:** Frontend/Backend/Admissions · **Depends on:** UI-10–18, UI-27, UI-29–33

**Acceptance criteria:**

- [x] **UI-19-AC01:** List includes identity/contact/course/interest/stage/next follow-up and supports the agreed course/interest/stage/follow-up filters plus next-follow-up/newest sorting.
- [x] **UI-19-AC02:** Date fixtures distinguish overdue/today/upcoming/unscheduled using the agreed institute timezone, including date boundaries.
- [x] **UI-19-AC03:** Detail groups contact, answers and chronological activity; Add follow-up opens a bounded form with validation, pending state and retained failed input.
- [x] **UI-19-AC04:** Create admission carries known information to one linked admission; converted-enquiry follow-up behavior is decided and enforced; list state survives return.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.

### UI-20 — Admissions

- [x] **Task complete**

**Deliverable:** Show actual readiness/blockers, course, contact and enrollment stage; support relevant status/course/date filters and supported readiness sorting/filtering. Detail: completion checklist linking to missing fields, grouped information, explicit identity resolution and batch selection.

**Responsible roles:** Frontend/Backend/Admissions · **Depends on:** UI-10–18, UI-27, UI-29–33

**Acceptance criteria:**

- [x] **UI-20-AC01:** List supports the agreed course/status/date/readiness filters and sort options; readiness is separate from lifecycle status and matches server validation.
- [x] **UI-20-AC02:** Detail shows missing requirements before submission, with each blocker linking/focusing its editable field/section.
- [x] **UI-20-AC03:** Incomplete applications save as drafts; optional personal fields do not block enrollment unless explicitly configured.
- [x] **UI-20-AC04:** Identity resolution precedes final enrollment; failed/duplicate attempts retain values and do not create duplicate student/enrollment records.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.

### UI-21 — Students

- [x] **Task complete**

**Deliverable:** Use one row per person, code, current-enrollment summary and clearly defined person status. Support contextual academic and enrollment filters. Detail: Overview, Personal information, Enrollments, Academic progress, Admissions and Activity as appropriate; separate prior qualifications from current progress.

**Responsible roles:** Frontend/Backend/Academic · **Depends on:** UI-10–18, UI-27, UI-29–33

**Acceptance criteria:**

- [x] **UI-21-AC01:** One student with multiple current/past enrollments appears once; counts count distinct people after the documented filters.
- [x] **UI-21-AC02:** Current enrollment summary reflects applied branch/course/batch/period; person status and enrollment status use distinct labels.
- [x] **UI-21-AC03:** Detail provides the approved personal/enrollment/progress/admissions/activity structure; prior qualifications are separate from current results.
- [x] **UI-21-AC04:** Transfer/add-enrollment actions preserve history and scope; source admission answers remain readable without filling unrelated academic sections.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.

### UI-22 — Institute, branches, courses and batches

- [x] **Task complete**

**Deliverable:** Give each register meaningful name/status/context filters and sorting. Detail pages expose relationships and next actions. Batch workspaces provide direct access to Students, Teachers, Curriculum and Assessments; reveal management forms only on request.

**Responsible roles:** Frontend/Backend/Academic · **Depends on:** UI-10–18, UI-29–33

**Acceptance criteria:**

- [x] **UI-22-AC01:** Deliver separate route checklists for Institute/branch, Courses and Batches; every register implements its agreed name/status/context filters and global sorting.
- [x] **UI-22-AC02:** Institute/branch records link to offerings/batches; course records expose curriculum and a contextual Forms link rather than a second question editor.
- [x] **UI-22-AC03:** Batch sections expose students, teachers, curriculum and assessments directly; enrollment/assignment forms open only through explicit actions.
- [x] **UI-22-AC04:** Walk branch → offering → batch → student/assessment and back with preserved context; closed/archived records expose only allowed operations.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.

### UI-23 — Teachers

- [x] **Task complete**

**Deliverable:** Show subjects, current assignments and profile status distinctly from login access; provide relevant search/filters/sorting. Detail: profile, assignments and history with a clear Assign to batch action.

**Responsible roles:** Frontend/Backend/Academic · **Depends on:** UI-10–18, UI-29–33

**Acceptance criteria:**

- [x] **UI-23-AC01:** Teacher list supports agreed name/subject/assignment/profile-status filters and name/other agreed sort fields.
- [x] **UI-23-AC02:** Detail distinguishes staff profile, current/ended assignments and account access; a labeled Assign to batch action uses authorized options.
- [x] **UI-23-AC03:** Creating/ending an assignment changes no user grants; validation errors retain the draft and prevent duplicate submission.
- [x] **UI-23-AC04:** Past assignments remain readable, detail-return restores the list and inaccessible staff fields/actions remain hidden and server-protected.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.

### UI-24 — Marksheets and imports

- [x] **Task complete**

**Deliverable:** Prioritize assessment/context/date/publication status with relevant subject/type/date filters and sorting. Detail: next allowed action, efficient score entry, visible validation blockers, source and revisions. Import history uses the common list pattern with state/date/source controls supported by its API.

**Responsible roles:** Frontend/Backend/Academic · **Depends on:** UI-10–18, UI-29–33

**Acceptance criteria:**

- [x] **UI-24-AC01:** Marksheet register supports academic scope, status, subject/type/date filters and agreed global sort; Import history independently supports agreed source/state/date search/filter/sort.
- [x] **UI-24-AC02:** Marksheet detail shows active state, next permitted action, validation blockers, source and revisions; manual/import entry choices are explicit.
- [x] **UI-24-AC03:** Editing, publication and correction respect existing review policies, identity rules and provenance; drafts never appear as published progress.
- [x] **UI-24-AC04:** Failed score save/import operations preserve recoverable work; internal/back/refresh navigation cannot silently lose edits and historical imports remain inspectable.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.

### UI-25 — Reports and academic views

- [x] **Task complete**

**Deliverable:** Reuse shared scope/search/filter/sort patterns where the view presents a list; retain report-specific period, comparison and grouping controls. Show coverage and active scope near results, with clear drill-down/export actions.

**Responsible roles:** Frontend/Backend/Academic · **Depends on:** UI-10–18, UI-29–33

**Acceptance criteria:**

- [x] **UI-25-AC01:** Progress-card registers and academic-view lists implement agreed search/scope/page filters/sorting; comparison/grouping controls retain their specific meaning.
- [x] **UI-25-AC02:** Period, active scope, sample/coverage and publication policy are visible without duplicate scope controls.
- [x] **UI-25-AC03:** For fixtures with missing and unpublished marks, displayed totals/drill-downs reconcile with authorized active published records.
- [x] **UI-25-AC04:** PDF/XLSX exports and linked contributing records match the selected dataset and disclose no hidden subjects; unsupported full-roster participation is omitted/labeled.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.

### UI-26 — Users/access, audit and other operational lists

- [x] **Task complete**

**Deliverable:** Apply the shared register pattern with domain-specific fields: account status/role where supported, audit actor/action/date and form applicability/course/status. Distinguish destructive and permission-changing actions.

**Responsible roles:** Frontend/Backend/QA · **Depends on:** UI-10–18, UI-29–33

**Acceptance criteria:**

- [x] **UI-26-AC01:** Users/roles/effective-access lists each have a route checklist, supported search/status/role filters and agreed sorting; role membership semantics are documented.
- [x] **UI-26-AC02:** Audit has supported actor/action/date filters, chronological sorting and preserved event detail/return behavior.
- [x] **UI-26-AC03:** Forms/configuration and all remaining inventory lists have explicit applicable filters/sorts or a documented non-applicability reason.
- [x] **UI-26-AC04:** Permission-changing and destructive actions retain existing protections, distinguish consequences and respect backend authorization; UI-01 inventory has no uncovered list.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.

### UI-27 — Forms and answer placement

- [x] **Task complete**

**Deliverable:** Consolidate general/course-specific question configuration in Administration → Forms. Define person/enquiry/admission/enrollment ownership, sections, order, required stage, visibility and historical behavior. Separate Yes/No/Not answered from consent.

**Responsible roles:** Product/Frontend/Backend · **Depends on:** UI-01–03

**Acceptance criteria:**

- [x] **UI-27-AC01:** Publish a field ownership/placement matrix for person/enquiry/admission/enrollment, section/order, required stage and student visibility.
- [x] **UI-27-AC02:** Administration → Forms manages general/course-specific sections with edit/order/preview/retire; processing registers contain no configuration controls.
- [x] **UI-27-AC03:** Yes/No/Not answered is distinct from consent; required-stage rules apply consistently in manual entry and imports with loading/field-error feedback.
- [x] **UI-27-AC04:** Existing answers reconcile after compatible migration/versioning; historical labels/values remain understandable and new requirements do not retroactively invalidate completed admissions.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.

### UI-28 — Dashboard, settings and sign-in

- [x] **Task complete**

**Deliverable:** Apply the agreed visual hierarchy to non-list pages. Link dashboard work queues to matching filtered registers. Keep settings task-oriented and sign-in's conditional verification flow clear.

**Responsible roles:** Frontend/Backend/Product · **Depends on:** UI-02–03, UI-29–33

**Acceptance criteria:**

- [x] **UI-28-AC01:** Dashboard queue counts link to exact matching filtered registers, including correct authorized scope and empty/failure states.
- [x] **UI-28-AC02:** Settings groups task-oriented controls, removes redundant description and clearly separates destructive operations from routine preferences.
- [x] **UI-28-AC03:** Sign-in retains password visibility/recovery guidance and conditional code verification with pending/error/back/expiry behavior.
- [x] **UI-28-AC04:** Record screenshots for dashboard/settings/sign-in at desktop/mobile; existing authentication/session rules and pending challenge protections still pass.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.


## 5. Detail layouts, popups and notifications

### UI-29 — Standardize detail-page structure

- [x] **Task complete**

**Deliverable:** Use a compact identity/status header, relevant primary action, deliberate secondary actions, clear section navigation and preserved return links. Choose tabs or sections based on content rather than giving every record the same tabs.

**Responsible roles:** Design/Frontend · **Depends on:** UI-03

**Acceptance criteria:**

- [x] **UI-29-AC01:** Publish a per-record section/action map rather than forcing identical tabs on every record type.
- [x] **UI-29-AC02:** Every record header identifies person/record, state and meaningful context, with one prioritized next action when applicable.
- [x] **UI-29-AC03:** Section links/tabs have usable keyboard behavior and retain relevant deep-link state; read/edit modes are clearly distinguished.
- [x] **UI-29-AC04:** Record loading/not-found/forbidden/error states have defined recovery and return behavior; breadcrumbs/return links preserve the working list.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.

### UI-30 — Define when to use popups

- [x] **Task complete**

**Deliverable:** Use bounded dialogs for follow-ups, assignments, date edits, advanced filters and consequential confirmations. Use dedicated pages for long admission forms and substantial editing. Define quick previews only where they reduce a real navigation step.

**Responsible roles:** Design/Frontend · **Depends on:** UI-03, UI-29

**Acceptance criteria:**

- [x] **UI-30-AC01:** Publish a popup-versus-page decision for each inventoried action, with short tasks in dialogs and long admission editing on pages.
- [x] **UI-30-AC02:** Each dialog has a task-specific title, labeled primary/secondary actions and sufficient space; no text action is constrained to an icon-sized container.
- [x] **UI-30-AC03:** No task requires nested modal workflows; switching subtasks preserves draft data or explicitly resolves unsaved work.
- [x] **UI-30-AC04:** Preview dialogs exist only for an agreed task with a clear Open full record action and consistent dismissal; keyboard/mobile behavior follows UI-31.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.

### UI-31 — Protect progress and focus

- [x] **Task complete**

**Deliverable:** Standardize initial focus, keyboard containment, background inertness, Escape/outside dismissal and focus restoration. Guard dirty work across popup dismissal, route/history changes and refresh; prevent duplicate submissions.

**Responsible roles:** Frontend/QA · **Depends on:** UI-03

**Acceptance criteria:**

- [x] **UI-31-AC01:** Opening a modal sets meaningful focus and makes background inert; Tab/Shift Tab stay inside visible enabled controls.
- [x] **UI-31-AC02:** Escape/outside/Close/Cancel follow the agreed dirty-state policy and restore focus without discarding changed data silently.
- [x] **UI-31-AC03:** Internal links, sidebar/launcher navigation, browser history and refresh enforce the same unsaved-work policy; unchanged forms do not prompt.
- [x] **UI-31-AC04:** Pending submissions prevent duplicates and accidental dismissal; errors preserve draft input and return usable focus; closing leaves no stale inert/scroll locks.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.

### UI-32 — Design notification behavior

- [x] **Task complete**

**Deliverable:** Provide distinct success, error, warning and information styling with accessible announcements. Brief successes may dismiss automatically; errors needing action persist. Pause timed dismissal on hover/focus and cap visible stacking without hiding unresolved failures.

**Responsible roles:** Design/Frontend/QA · **Depends on:** UI-02–03

**Acceptance criteria:**

- [x] **UI-32-AC01:** Success/error/warning/information variants have text or icon labels, accessible announcements and no unsolicited focus movement.
- [x] **UI-32-AC02:** Timed success notices pause while hovered/focused; actionable errors persist until resolved or dismissed; timings and maximum visible stack are documented.
- [x] **UI-32-AC03:** Overflow notices remain retrievable or queued without silently dropping unresolved failures; dismissal does not erase record/job outcome history.
- [x] **UI-32-AC04:** At desktop/mobile sizes, notifications wrap long messages, expose named dismiss/actions and do not cover the focused control or essential form actions.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.

### UI-33 — Connect notifications to real outcomes

- [x] **Task complete**

**Deliverable:** Show what changed, use Open record/Retry actions where meaningful, and represent background jobs with actual server progress/completion rather than simulated timers. Keep field validation beside fields and important outcomes available in their record/job history.

**Responsible roles:** Frontend/Backend/QA · **Depends on:** UI-32

**Acceptance criteria:**

- [x] **UI-33-AC01:** Success appears only after confirmed server success and identifies the affected operation/record; validation stays attached to inputs.
- [x] **UI-33-AC02:** Open record actions navigate to the real affected record with permission/dirty-state behavior; Retry cannot double-commit a completed mutation.
- [x] **UI-33-AC03:** Background notices use actual job state, distinguish failed/cancelled/completed work and link to inspectable job results.
- [x] **UI-33-AC04:** Network failure/retry fixtures preserve user input, show truthful outcomes and never simulate progress or announce failed operations as successful.

**Evidence:** Accepted by the requester on 16 October 2026. Behavior is in the running application and in `docs/ui-standards.md` and `docs/ui-journeys.md`. The same day, a signed-in browser check covered sidebar collapse, one flyout at a time, Jump to, the enquiry, admission and student presets, 360px and 390px drawers, and marksheet More filters. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed for the current-enrollment filter.


## 6. Validation and acceptance

### UI-34 — Verify shared controls and APIs

- [ ] **Task complete**

**Deliverable:** Test combinations of basic/page-specific filters, dependent changes, sort directions/ties, pagination, URL reload/Back, no matches, failed loads and restricted scope. Add meaningful coverage at the appropriate layer.

**Responsible roles:** Backend/Frontend/QA · **Depends on:** UI-10–18, UI-19–28

**Acceptance criteria:**

- [ ] **UI-34-AC01:** Run a per-route filter/sort matrix with multi-page fixtures containing ties, nulls, dates, multiple enrollments and disjoint grants.
- [ ] **UI-34-AC02:** Compare UI IDs/counts/order with API results and export/drill-down contributors where available; no visible-page-only sorting is accepted.
- [ ] **UI-34-AC03:** Verify URL/reload/Back, dependent chip removal, advanced Apply/Cancel/Reset, presets and failed/out-of-order requests.
- [ ] **UI-34-AC04:** Attach meaningful automated tests/results and list any unresolved route/scenario explicitly; a global build pass alone is insufficient.

**Evidence:** Partial on 16 October 2026. Marksheet More filters keep a draft: choosing Unit left `/marksheets` unchanged, Cancel discarded it, Reset cleared the draft without changing the address, and Apply set `exam_type=unit` with the chip “Exam type: Unit”. Unknown enrollment is rejected and `enrollment=current` is covered by `test_report_filters_reach_the_list_card_and_export`. A full per-route sort and pagination matrix with ties, nulls and disjoint grants was not run, so this task stays open.

### UI-35 — Verify navigation and accessibility

- [ ] **Task complete**

**Deliverable:** Exercise expanded/compact sidebar, submenu flyouts, persisted preferences, mobile drawer and quick navigation. Check keyboard/screen-reader semantics, contrast, 200% text zoom and responsive layouts.

**Responsible roles:** Frontend/QA · **Depends on:** UI-04–09, UI-18, UI-29–32

**Acceptance criteria:**

- [ ] **UI-35-AC01:** Complete navigation through direct links/groups/flyouts/launcher in expanded, compact and mobile drawer modes, including persisted/deep-linked states.
- [ ] **UI-35-AC02:** Keyboard checks cover focus order/restoration, Escape, modal containment, active labels and no inaccessible hidden controls.
- [ ] **UI-35-AC03:** Check contrast, accessible names/status announcements, 200% text zoom and 360/390/768/1280px layouts using long/empty/error data.
- [ ] **UI-35-AC04:** Retain screenshots and a keyboard/accessibility checklist; document the scope of screen-reader checks without claiming untested conformance.

**Evidence:** Partial on 16 October 2026. Expanded and collapsed navigation, flyout Escape returning focus to the opener, Jump to, and 360px and 390px drawers were checked in the signed-in browser. Contrast ratios, 200% text zoom, 768px and 1280px layouts, and a screen-reader pass were not recorded, so this task stays open.

### UI-36 — Validate complete staff workflows

- [ ] **Task complete**

**Deliverable:** Review enquiry → admission → enrollment; direct/returning-student admission; batch → student → progress; and mark entry/import → publication → report using representative roles/data. Record wrong turns, unnecessary steps and assistance needed.

**Responsible roles:** Product/Admissions/Academic/QA · **Depends on:** UI-19–28, UI-34–35

**Acceptance criteria:**

- [ ] **UI-36-AC01:** Run new enquiry → admission → enrollment, direct admission and returning-student identity resolution with representative staff.
- [ ] **UI-36-AC02:** Run batch → student → progress and manual/import marks → review/publication → report, including recoverable failure cases.
- [ ] **UI-36-AC03:** Record agreed baseline versus revised task completion time, navigation steps, wrong turns and assistance needed; set targets before the sessions.
- [ ] **UI-36-AC04:** Record staff decisions separately from developer walkthroughs; blocking issues remain open until retested, and improvement claims reference observed evidence.

**Evidence:** Open. The requester accepted the delivered screens on 16 October 2026. No separate timed staff session was run, and no baseline or revised completion times, wrong turns, or assistance counts were recorded.

### UI-37 — Record delivery evidence and remaining work

- [x] **Task complete**

**Deliverable:** Run appropriate builds/checks, retain authenticated desktop/mobile screenshots and update existing guidance to the agreed final behavior.

**Responsible roles:** Engineering/QA/Product · **Depends on:** UI-34–36

**Acceptance criteria:**

- [x] **UI-37-AC01:** Run frontend build and backend checks relevant to changed contracts; record commands, outcomes and material coverage limitations.
- [x] **UI-37-AC02:** Link each completed task to its design decision, implementation reference, test/visual evidence and acceptance reviewer.
- [x] **UI-37-AC03:** Update the existing journeys/UI guidance and completion summary to match delivered behavior; do not overwrite historical records as fresh acceptance.
- [x] **UI-37-AC04:** List unfinished tasks, regressions and migration/recovery limitations explicitly; mark final acceptance only when required checks and staff review pass.

**Evidence:** Recorded 16 October 2026. `tsc --noEmit` passed. `test_report_filters_reach_the_list_card_and_export` passed. Browser checks covered navigation, presets, phone widths and marksheet filter drafts. UI-34, UI-35 and UI-36 remain open, as listed in their evidence. Historical redesign records were not rewritten.


## Completion and verification rules

- Every task has a deliverable, responsible roles, dependencies and four individually checkable acceptance criteria. Assign a named owner before scheduling.
- Check the task only when all of its acceptance criteria pass. Partial implementation does not equal acceptance.
- Resolve the design gate UI-03 before application changes. Foundation contracts and components precede the pages that consume them; UI-17 API work precedes enabling new query controls.
- Use the per-route inventory from UI-01 to subdivide multi-page tasks into implementation tickets. Each affected route must satisfy the parent criteria; one representative page cannot close a multi-page task.
- For page-specific tasks UI-19–28, deliver list and detail changes as separate reviewable slices where both exist, with state/permission/return-path checks for each. Non-list pages are explicitly covered by UI-28.
- Verification evidence must identify route, role, dataset, viewport and expected versus actual behavior where relevant. Keep student/private data out of shared evidence.
- Actual staff/user approval remains pending until received. Developer execution, automated tests and screenshots are evidence, not substitutes for staff acceptance.
- Dependencies may be designed concurrently, but dependent implementation cannot be accepted against an unfinished or incompatible contract. No estimates or completion dates are assumed.

## Delivery order and boundaries

1. Agree on UI-01–03 with concrete designs. No application-code changes before that discussion is resolved.
2. Establish sidebar/navigation and shared list primitives; deliver Enquiries plus its detail view as the reference slice.
3. Validate that slice, then extend Admissions and Students, followed by the remaining registers/workspaces.
4. Complete notification/dialog behavior alongside the affected workflows, then run cross-application acceptance.

Preserve existing user work, URLs, identities, enrollment history, publication rules, provenance and authorization. Add backend changes only where agreed UI behavior requires them. New business modules are outside this design plan. Assign named owners when scheduling; all checkboxes begin open.
