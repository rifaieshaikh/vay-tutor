# UI standards

Date: 16 October 2026 · Status: shared rules for the [UI and UX redesign](ui-ux-redesign-task-list.md), including the register filter contract. Builds on the [staff journeys](ui-journeys.md).

Shared styles live in `frontend/src/styles.css`. The dialog is `StudentDialog` in `frontend/src/ui.tsx`. Display dates use `formatDisplayDate` in `frontend/src/format.ts`. The font file is `frontend/src/fonts/source-sans-3-latin.woff2`, licensed under the SIL Open Font License 1.1 (`frontend/src/fonts/OFL.txt`). The reserved name Source is unchanged. Later phases use these rules on the reference journey and then on the remaining screens. They do not add a second visual pattern.

The target is WCAG 2.2 AA: text contrast at least 4.5:1, large text and interface components at least 3:1, visible focus, 200% text resize without clipping, and a target at least 24 by 24 CSS pixels. Status is never color alone.

## Typography

Compared on the same enquiry heading, WhatsApp field, and score table:

| Family | What the sample showed | License |
|---|---|---|
| Source Sans 3 | Compact at table size, clear names, even figure widths with tabular numerals | OFL 1.1, Adobe |
| IBM Plex Sans | Clear, slightly wider, so fewer columns fit in a register | OFL 1.1 |
| Atkinson Hyperlegible | Very open letterforms, too wide for dense mark tables | OFL 1.1 |

Use Source Sans 3, then Segoe UI, Noto Sans, and the generic sans-serif. Noto Sans covers letters the Latin subset does not. One variable file is bundled, weights 200–900, so the interface does not fetch a font at runtime.

| Role | Size | Weight | Line height |
|---|---|---|---|
| Page title | 1.75rem | 650 | 1.2 |
| Section | 1.25rem | 650 | 1.3 |
| Subsection | 1.05rem | 650 | 1.35 |
| Body, fields, table cells | 1rem | 400 | 1.45 |
| Eyebrow, column label, fact label | 0.75–0.8rem | 650 | 1.35 |

Tables, counts, codes, and pager text use tabular numerals. Headings wrap instead of clipping. At 200% root font size, controls grow with `rem` and long names wrap.

## Layout and color

Spacing steps are 0.25, 0.5, 0.75, 1, and 1.5rem. A narrow form is 46rem. The sidebar is 16rem. Panels and dialogs use a 12px radius; controls use 8px. A register is a full-width panel. A detail page is the same panel with a title, facts, then sections. A dialog is at most 40rem wide, scrolls inside the panel, and keeps its footer with the actions.

| Token | Value | Checked pair | Contrast |
|---|---|---|---|
| Ink on surface | #1c2430 on #ffffff | Body text | 15.6:1 |
| Ink on canvas | #1c2430 on #f4f1ea | Page background | 13.9:1 |
| Muted on surface | #5d6b66 on #ffffff | Labels and secondary text | 5.6:1 |
| Accent on soft | #0f6e6b on #e7f3f2 | Selected navigation | 5.3:1 |
| White on accent | #ffffff on #0f6e6b | Primary button | 6.1:1 |
| White on danger | #ffffff on #8d2f2f | Destructive button | 8.1:1 |
| Danger on surface | #8d2f2f on #ffffff | Errors | 8.1:1 |
| Focus | #0b4f4c outline, 3px, offset 2px | On white | above 7:1 |

Status words, always with text: Enquiry, Admitted, Open, Enrolled, Draft, Submitted, Published, Withdrawn, Closed, Current, Active, Archived, Ended, Failed. Color may reinforce the word. A bar chart keeps its label or number beside the color.

Primary form controls are at least 2.75rem tall. Icon utilities, section tabs, and table sort controls are at least 2rem, above the 24px minimum. Spreadsheet cells stay compact because the cell itself is the target and the control is inline in a data grid.

## Buttons and actions

| Class | Look | Use |
|---|---|---|
| `button` or `.button` | Teal fill | The one primary action |
| `.secondary` or `.text-button` | Outline | A real alternative: Import, Edit, Back, Apply |
| `.quiet` | Text, accent color | Navigation and dismissal: Cancel, Close, row links |
| `.destructive` | Red fill | Irreversible or publication-retracting confirmation |

A dialog footer is `.dialog-actions`, aligned to the end. Order is Cancel or Close, then the primary or destructive button. Both are at least 2.75rem. Pending labels use the gerund: Saving…, Signing in…. The button is disabled while the request is in flight.

Visible text is required for Add enquiry, Add admission, Save, Enroll, Admit, and Import. Icon-only is limited to Filter, Sort, Clear, and a repeated row Edit or card link, each with an accessible name. A creation action does not rely on a tooltip. Factory reset, Wipe all data, Confirm merge, and Withdraw use `.destructive`. Typed confirmation for factory reset stays: the operator types RESET.

Where a screen has a primary action, it is the one from the [screen map](ui-journeys.md#screen-map). Registers that are read-only for the current grant have no primary button. Their action is opening a row.

## Writing

Dates shown to staff use `15 Oct 2026`. Date inputs keep ISO values. An empty value reads “Not recorded”. Do not invent a cancelled or lost stage.

Use these names: Enquiry, Enquiries, Admission, Admissions, Student, Enrollment, Batch, Branch, Course, Follow-up, Admit, Enroll. An enquiry stores a WhatsApp number. An admission stores a Contact number. Conversion copies one into the other.

A description stays only when it changes what the person does next, warns about a consequence, states a prerequisite, or explains missing data. Errors name the field and the correction.

Removed because they repeated the screen or described the implementation:

| Was | Where |
|---|---|
| Branches and students come from a marklist | Setup |
| Enter marks here, or import a workbook | Marksheets. The draft consequence stays |
| Current batch | Batch. Closed batch stays, and says new enrollments stay out |
| Marklists use Unit, Part, and Chapter | Course |
| Apply changes to update the entire view | Academic view filters. The note that choices change on Apply stays |
| Assigned to you / waiting on you | Dashboard. Queues are institute work the grant can see, not a personal assignment |

These stay: follow-up and open-admission filter leads, failed-import lead, draft-versus-published, closed batch, curriculum owned by the course, teaching work is not login, merge and reset consequences, role versus grant, audit immutability, transfer keeps the old results, unpublished or partial report limits, and recovery codes shown once.

## Interaction

**Page or dialog.** A dialog is one bounded task of about a screenful: add an enquiry, resolve a duplicate, confirm a merge. A long or multi-step task is a page: the admission form, student edit, and the marklist import wizard. Import stays on `/import`. New dialogs use `StudentDialog`. The local dialog copies in marksheets, cards, and views move to it when those screens are updated.

**Forms.** Labels are visible. Required is expressed by the control and by the error, not by a placeholder. A failed save keeps every entered value. The field error sits with the field. One error summary is allowed at the top when several fields fail. The first invalid field is focused.

**Unsaved changes.** `confirmDiscard` asks “Discard the unsaved changes?”. `StudentDialog` asks on Close, backdrop, and Escape when `dirty` is set. Cancel in the footer calls `confirmDiscard` before close. The same question covers sidebar navigation, in-app links, and browser refresh. One guard handles all of them. Phase 3 wires it for admissions; score editing uses that same guard rather than a second one. A successful save clears the dirty flag before navigating.

**Submit.** The primary button disables on submit and shows the pending label. A second click does not send a second request. Success uses the existing notice and moves to the next record from the journey. Failure leaves the form in place and announces the error.

**Search and filters.** Name or contact search is an inline field. It updates the list shortly after typing pauses, and on Enter. The query is in the address, so Back restores it. Common filters sit inline and update immediately. Less common ones sit behind a button labeled More filters. Applied filters are removable chips, with the result count and a Clear action. The context bar is the only control for branch, course, period, and batch on pages that show it. A page does not repeat those four. Academic views keep an Apply button because the report is heavy; other registers do not. A failed option request shows the error and a retry. It does not look like an empty list. An empty successful result says that nothing matched and how to clear the filter.

### Register filters

One value has one meaning. `branch_id`, `course_id`, `batch_id`, and `period` are the context bar on Dashboard, Students, Batches, Marksheets, progress cards, and academic views. Clearing context removes those four and the page number. It leaves a page search in place. A page Clear removes that page’s own filters and leaves the context. Changing a filter resets the page number. Back restores the address, including the search.

| Register | Context bar | Inline, immediate | More filters | Address keys |
|---|---|---|---|---|
| Students | Branch, course, period, batch | Name or student id, about 300ms and Enter | None | `q` plus the context keys |
| Enquiries | None. Course is a page filter | Search, follow-up, course | None. These three are the daily set | `q`, `follow_up`, `course_id`, `page` |
| Admissions | None. Course is a page filter | Search, status, course | None | `q`, `status`, `course_id`, `page` |
| Batches | Branch, course, period, batch | None beyond the context bar | None | Context keys only |
| Marksheets | Branch, course, period, batch | Search, status, subject | Paper, exam type, exam dates | Page keys plus context keys |
| Academic views | Branch, course, period, batch | Level tabs | The report filters, applied together | Context keys and the view’s own keys |

Dependent clearing stays in the context bar: a new branch clears course and batch; a new course clears batch; a period that does not contain the batch clears the batch. Enquiry and admission course filters do not write the context keys used by the bar, because those pages do not show the bar. A failed context or filter-option request shows the error and Try again. It does not present an empty choice list as if the institute had no branches.

**Tables.** The name opens the record. Sort is a column control with the direction in the accessible name. Pages show previous, next, and “n of m”. Wide tables scroll inside the table region. The page itself does not scroll sideways at 360, 390, 768, or 1280 CSS pixels. That containment is DES-17; the pattern here is the scroll region, not a second layout.

**Section tabs.** Personal, Academics, History, and the other in-page tabs stay. They are tabs: arrow keys move between them, Home and End move to the ends, and the selected tab controls its panel. The Enquiry / Admission / Student strip is not a tab set. DES-10 removes it. Route changes are links.

**Dialog keyboard.** On open, focus moves to the first field, then to the first control, then to the dialog. Tab stays inside. Escape closes through the dirty check. On close, focus returns to the control that opened it. The rest of the page is inert while the dialog is open.

**Loading, empty, error.** Loading names the thing loading. Empty names the zero result. Error is an alert with retry when the load can be repeated. A notice confirms a completed save. These three are not interchangeable.

## Reference workflow

Enquiry through enrollment uses this type scale, these buttons, `StudentDialog`, `confirmDiscard`, and `formatDisplayDate`. Add enquiry stays a dialog. The admission form becomes a page in DES-12. Admit and Enroll are the labeled primary actions. Missing requirements show at Enroll, and the entered branch and batch remain after a failure.
