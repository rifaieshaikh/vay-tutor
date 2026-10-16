# Staff journeys and screen map

Date: 16 October 2026 · Status: Phase 1 audit, kept as the before-state, with the working routes updated after the redesign. See the [task list](ui-ux-redesign-task-list.md).

The friction column records what was awkward before DES-10. It is not the current screen. The stages, routes, and daily workflows below describe the app as it works now. Paths stay the same. The redesign does not add a cancelled or lost status, a new permission, or a second way to resolve identity.

## Roles

Route visibility uses the grants that exist today. An admissions operator is anyone who holds `student.lookup` and `student.manage`. That pair is not a seeded role. A scoped teacher is a user whose grants name a branch, course, batch, or subject. The redesign shows or hides actions for those grants. It does not introduce an admissions permission.

| Grant on the session | What the interface may offer |
|---|---|
| Signed out, institute not created | First-time setup only |
| Signed out, institute exists | Sign-in only |
| `dashboard.view` | Dashboard, Academic Views, Settings |
| `student.lookup` | Read enquiries, admissions, students, institute, courses, and batches |
| `student.manage` | Create and edit those records, follow up, import people, convert, enroll, and transfer |
| `catalog.manage` or `catalog.correct` | Edit institute structure and form questions |
| `user.manage` | Teachers, users, roles, and grants |
| `marksheet.view` | Marksheets and the review queue |
| `marksheet.upload` | Import a marklist and add a marksheet |
| `marksheet.edit_draft` or `marksheet.correct` | Edit scores and bands, as the marksheet status allows |
| `progress_card.view` | Progress cards |
| `audit.view` | Audit |

Reading an enquiry or admission requires `student.lookup` anywhere. Writing requires `student.manage` anywhere. Choosing a branch and batch at enrollment also requires `student.manage` on that branch, course, and batch. Lists do not yet apply that tuple. Later phases must not pretend the list is scoped until the server is.

## Screen map

Each row is one destination or one dialog on that destination. “Primary action” is the action for someone who is allowed to change the record. A reader’s primary action is to open the named next destination.

Context means the branch, course, period, and batch bar. It appears on Dashboard, Students, Batches, a batch, Marksheets, Progress Cards, and Academic Views. It does not appear on enquiries or admissions. Those pages can still be filtered by `course_id` in the address.

### Sign-in and start

| Screen | Path | Purpose | Who | Entry | Primary action | Next | Friction |
|---|---|---|---|---|---|---|---|
| Create the institute | First load, no session | Name the institute and the first administrator | Unsigned, empty database | Open the app before bootstrap | Create institute | Recovery codes | Copy still says branches and students come from a marklist. Manual setup already exists. |
| Recovery codes | Same screen after create | Show one-time codes | The new administrator | Successful setup | Continue | Sign-in | Codes are the only recovery path. The page says they are not shown again. |
| Sign in | No session after bootstrap | Start a session | Unsigned | Open the app | Sign in | Dashboard | Authentication code is always shown. It applies only to cloud administrators. Errors are not announced. Password cannot be revealed. No recovery guidance. |
| Dashboard | `/` | Show queues the user can act on | `dashboard.view`, plus lookup or marksheet grants for each card | Sign-in, sidebar | Open a queue | Filtered Enquiries, Admissions, Marksheets, or Import | “Assigned to you” and “waiting on you” describe institute queues. Failed imports ignore context. A context choice outside access is mentioned, not named. |

### Admissions

| Screen | Path | Purpose | Who | Entry | Primary action | Next | Friction |
|---|---|---|---|---|---|---|---|
| Enquiries | `/students/enquiries` | Find people who are not yet an admission | Lookup to read, manage to add | Sidebar, dashboard `follow_up=due` | Add enquiry | Enquiry record | Sidebar and an Enquiry / Admission / Student strip both navigate. Title says “Enquiry”. Search is a separate submit and is not kept in the address. Dashboard course and due filters have no control on the page. Question editing sits above the list. No pager, though the API pages. |
| Add or edit enquiry | Dialog on the register or record | Record interest | Manage | Add enquiry, or Edit | Save | Stay on the list or record | Backdrop, Escape, and Cancel discard edits with no check. Required questions are marked “required to admit”, which is a later step. |
| Import enquiries | Dialog on the register | Create many enquiries from a workbook | Manage | Import | Save the preview | Enquiry register | No initial focus, containment, or return of focus. |
| Enquiry | `/students/enquiries/:enquiryId` | Follow up or create an admission | Lookup; manage to change | Name in the register | Add follow-up, or Create admission | Admission, or Open admission once it exists | The strip remains. Breadcrumb says “Enquiry”, not the name, and both “Admissions” and “Enquiries” go to the same list. Follow-up dates are raw. The API can delete a follow-up; the page cannot. |
| Enquiry questions | Dialog on the enquiry register | Add a question to the enquiry form | Catalog manage or correct | Add question | Save | Enquiry register | Form setup is on the working register. |
| Admissions | `/students/admissions` | Find open and enrolled admissions | Lookup; manage to add | Sidebar, dashboard `status=open` | Add admission | Admission record | Same strip, hidden course filter, submit-only search, and question editor as enquiries. |
| Add or edit admission | Dialog on the register or record | Record the person and course | Manage | Add admission, or Edit while open | Save | Admission record | One long form. Optional profile fields and answers required only at enrollment look the same. Backdrop and Escape discard edits. A converted admission cannot be edited; the server says to edit the student. |
| Import admissions | Dialog on the register | Create admissions, and resolve people who already match | Manage | Import | Save after each match is attach or create | Admission register | Same focus gap as enquiry import. A matching name and phone blocks the row until the operator chooses. |
| Admission | `/students/admissions/:admissionId` | Finish requirements and enroll | Lookup; manage to enroll | Register, or Create admission from an enquiry | Enroll, once branch and batch are chosen | Student record | Enrollment fields sit under the whole biography. Missing required answers appear only after Continue. Match confirmation is a second dialog. Sidebar highlight is correct; the breadcrumb title is “Admission”. |
| Possible duplicate | Dialog on the admission | Attach this course to an existing student, or create one | Manage | Continue when name and phone match | Add to this student, or Create a new student | Student record | Cancel returns to the admission with branch and batch still selected. The page does not explain which fields will be left unchanged on attach. |

### Students

| Screen | Path | Purpose | Who | Entry | Primary action | Next | Friction |
|---|---|---|---|---|---|---|---|
| Students | `/students` | Find an enrolled person | Lookup | Sidebar, or return from a record | Open a student | Student record | The people strip repeats the sidebar. Search, branch, course, and batch live in a Filters dialog and also in the context bar. |
| Sort students | Dialog | Choose sort field and direction | Lookup | Sort icon | Apply | Register | Icon-only, which is acceptable for this utility. |
| Merge students | Dialog on the register | Keep one identity and archive the other | Manage | Merge students | Confirm the merge | Register | High-consequence action uses the same button weight as routine actions. |
| Student | `/students/:studentId` | Profile, enrollments, admissions, and published progress | Lookup; manage to edit or enroll; card grant for progress | Directory, batch, or admission | Edit, or open the relevant section | Admission, enquiry, batch, marksheets, card, or views | Students in the sidebar does not stay highlighted, because that item is exact-match only so it will not light up on enquiries. Edit, add enrollment, and the card are icon-only. Personal, Academics, and History are real section tabs and stay. Back to the batch checks unsaved edits; other navigation does not. |
| Edit student | On the record, not a dialog | Correct profile, address, academic records, and answers | Manage, and not on History | Edit | Save | The same section | Contact and address are hidden from staff who cannot manage the student. |
| Add enrollment | Dialog | Enroll this student in another open batch | Manage on that batch | Add enrollment | Save | Academics | Empty search is a separate problem on the batch page. |
| Edit enrollment dates | Dialog | Set started and ended dates | Manage on that enrollment | Edit dates | Save | Academics | Ending a date makes the enrollment historical. It is not labeled as the transfer path. |
| Transfer | Dialog | End the current enrollment and open another | Manage | Transfer on a current enrollment | Transfer | Academics | Copy correctly says the old batch and its results remain. The control is easy to miss among icon actions. |

### Academics

| Screen | Path | Purpose | Who | Entry | Primary action | Next | Friction |
|---|---|---|---|---|---|---|---|
| Institute | `/institute` | See the institute and its branches | Lookup; catalog to edit | Sidebar | Add branch, or open a branch | Branch | Add and edit are icon-only. |
| Edit institute | Dialog | Name and code | Catalog | Edit | Save | Institute | |
| Add branch | Dialog | Create a branch | Catalog | Add branch | Save | Institute | |
| Branch | `/institute/branches/:branchId` | Place, courses offered, and students | Lookup; catalog to change | Institute | Offer a course, or add a batch | Course or batch | Details, Courses, and Students are section tabs and stay. Offer and add are icon-only. |
| Offer a course | Dialog | Attach an existing course to this branch | Catalog | Offer a course | Save | Branch courses | |
| Add batch on a branch | Dialog | Open a cohort for an offered course | Catalog | Add batch | Save | Batch | |
| Courses | `/courses` | List courses | Lookup; catalog to add | Sidebar | Add course | Course | |
| Add course | Dialog | Name a course | Catalog | Add course | Save | Course list | |
| Course | `/courses/:courseId` | Subjects, papers, and a link to course questions | Lookup; catalog to edit | Courses, or a batch curriculum link | Add subject or paper | Subject’s papers, batches of this course, or Forms | Admission questions are edited here as well as on the admissions register. |
| Add subject, paper, or edit item | Dialogs | Change the curriculum | Catalog | Add or edit | Save | Course | |
| Batches | `/batches` | List cohorts in the current context | Lookup; catalog to add | Sidebar | Add batch | Batch | Context bar and any local batch filters must not both be treated as the scope. The filter contract is DES-15. |
| Add batch | Dialog | Create a cohort under a branch offering | Catalog | Add batch | Save | Batch list | |
| Batch | `/batches/:batchId` | Students, curriculum, teachers, and marksheets for one cohort | Lookup; manage to enroll; user manage to assign teachers; upload to import | Batches, or the admission’s batch link | Enroll, assign, or open a marksheet | Student, teacher, marksheet, cards, views, import, or this course’s admissions | Students, enroll, teachers, assign, curriculum, and assessments are all expanded. Dates are ISO. A search with no matches shows nothing. Closed batches reject new enrollment. |

### Staff

| Screen | Path | Purpose | Who | Entry | Primary action | Next | Friction |
|---|---|---|---|---|---|---|---|
| Teachers | `/teachers` | Find teaching staff | User manage | Sidebar | Add teacher | Teacher | Search is inside Filters. A teacher is not a login. |
| Add teacher | Dialog | Record a teacher without granting access | User manage | Add teacher | Save | Teacher list | |
| Teacher | `/teachers/:teacherId` | Courses this teacher takes | User manage | Teachers, or a batch assignment | Add course | Batch, via the assignment | Ending a course keeps the row. |
| Add or edit course | Dialog | Assign the teacher to a subject on a batch | User manage | Add course | Save | Teacher | Does not create a user or a grant. |
| Remove course | Dialog | End the assignment | User manage | Remove | Confirm | Teacher | |

### Assessments

| Screen | Path | Purpose | Who | Entry | Primary action | Next | Friction |
|---|---|---|---|---|---|---|---|
| Import history | `/import` | See marklist jobs and start another | Upload, or view for history | Sidebar, dashboard `state=failed`, batch | Import marklist | The new job’s preview, then Marksheets | Failed filter is a lead sentence, not a removable chip. The import dialog has no initial focus or focus trap. |
| Marksheets | `/marksheets` | Find assessments | View; upload to add | Sidebar, dashboard `status=submitted`, batch, student | Add marksheet | Marksheet | Context bar repeats branch, course, and batch, which also appear under Filters. The lead paragraph explains drafts. |
| Add marksheet | Dialog | Enter marks, or go to import | Upload | Add | Choose entry | New draft, or Import | The two entry choices exist and should stay distinct. |
| Filter or sort marksheets | Dialog and inline controls | Narrow the register | View | Filters | Done | Register | Immediate updates. Branch and course here compete with context. |
| Marksheet | `/marksheets/:marksheetId` | Scores, status, and the next publication step | View; edit draft or correct to change scores | Register or batch | The status action: edit, publish, or withdraw | Progress card or academic view after publish | Results and Details are section tabs and stay. The back link warns about score edits. Sidebar navigation does not. Publish is available for draft and submitted. |
| Add student, withdraw, edit bands | Dialogs | Change membership, retract a published sheet, or set bands | As the status and grant allow | Those actions | Save or confirm | Marksheet | Withdraw is destructive and shares routine styling. |

### Reports

| Screen | Path | Purpose | Who | Entry | Primary action | Next | Friction |
|---|---|---|---|---|---|---|---|
| Progress cards | `/cards` | Read a student’s published results | Progress card view | Sidebar, student, batch | Open or print a card | The card | Uses published results only. Empty and unpublished must stay different. Print layout is not specified yet; DES-20 must say what printing keeps. |
| Academic views | `/views` | Compare published results by institute, branch, course, or batch | Dashboard view | Sidebar, batch, student | Change level or filters | A deeper level, or a student card | Level and report controls are section navigation and stay. |

### Administration

| Screen | Path | Purpose | Who | Entry | Primary action | Next | Friction |
|---|---|---|---|---|---|---|---|
| Users and access | `/access` | Accounts and roles | User manage | Sidebar | Add user or add role | User, or the role editor | Users and Roles are section tabs and stay. Search is in a dialog. |
| Add user, add or edit role | Dialogs | Create an account or a role bundle | User manage | Add | Save | The list | |
| User | `/access/:userId` | Grants for one account | User manage | Users | Add grant | The user | Removing the last active institute administrator stays denied. |
| Add or remove grant | Dialogs | Change what this person can do | User manage | Add grant, or remove | Save or confirm | User | A grant is not a teaching assignment. |
| Audit | `/audit` | Read recorded actions | Audit view | Sidebar | Filter | A related record only where the event already links one | Search, action, and date are in a dialog. |
| Settings | `/settings` | Bands, ranking, blank-mark policy, and dangerous operations | Dashboard view; catalog to edit policy | Sidebar | Edit settings, or factory reset | Settings | Preferences, Academic policy, and Operations are section tabs and stay. Factory reset keeps its typed confirmation. |
| Forms | `/forms` | Enquiry, admission, and course questions | Catalog manage or correct | Sidebar, or the link on an enquiry, admission, or course | Add question | The same page, with a preview of the enquiry or admission form | |

## Navigation

One sidebar item is the way into each register. The Enquiry / Admission / Student strip on those registers and on enquiry and admission records is a second way into the same three URLs. DES-10 removes that strip. Section tabs inside a record stay: student Personal, Previous education, Enrollments, Progress, Admissions, and Activity; branch Details / Courses / Students; marksheet Results / Details; access Users / Roles; settings Preferences / Academic policy / Operations; and the level controls on reports. Forms is the administration page for questions.

### Destinations

| Sidebar item | Path | Records it owns |
|---|---|---|
| Dashboard | `/` | None |
| Enquiries | `/students/enquiries` | `/students/enquiries/:enquiryId` |
| Admissions | `/students/admissions` | `/students/admissions/:admissionId` |
| Students | `/students` | `/students/:studentId` only. Not enquiries or admissions. |
| Institute | `/institute` | `/institute/branches/:branchId` |
| Courses | `/courses` | `/courses/:courseId` |
| Batches | `/batches` | `/batches/:batchId` |
| Teachers | `/teachers` | `/teachers/:teacherId` |
| Import Marklist | `/import` | The import dialog |
| Marksheets | `/marksheets` | `/marksheets/:marksheetId` |
| Progress Cards | `/cards` | The opened card on this page |
| Academic Views | `/views` | Levels on this page |
| Users and Access | `/access` | `/access/:userId` |
| Audit | `/audit` | None |
| Settings | `/settings` | None |
| Forms | `/forms` | None |

Highlight the item whose path is this page or is the parent of this record. Students highlights on `/students` and on a student record, and stays off Enquiries and Admissions. Enquiry and admission records highlight their own sidebar item.

### Breadcrumbs and titles

The visible title and the browser title are the record’s name: the person, batch, course, branch, teacher, user, or marksheet. Registers keep their sidebar label, with Enquiries plural.

Crumbs are the register, then the record. The register crumb keeps the current context query. Do not add a module crumb that links to the same place as the register. An enquiry crumb is Enquiries, then the person’s name. An admission crumb is Admissions, then the person’s name. A new admission crumb stays “New admission”.

### Links between stages

These links stay. They are how a person moves between stages after the strip is gone.

| From | Link | To |
|---|---|---|
| Dashboard queue | The card | The filtered register |
| Enquiry, once admitted | Open admission | That admission |
| Admission | Open enquiry, when it has one | That enquiry |
| Admission, once enrolled | Open student, Open batch | That student and batch |
| Student, Academics | The admission and enquiry | Those records |
| Batch student row | The name | Student, with return to this batch |
| Batch | Marksheets, cards, views, import, admissions for this course | Those registers with context |
| Enrollment row | Card, Marksheets, Views | Those reports with this branch, course, and batch |

Back from a student uses `returnTo` when the batch supplied one, and otherwise returns to Students.

## Enquiry through enrollment

An enquiry is interest in a course. An admission is the decision to enroll that person in one batch of that course. A student is the institute identity. An enrollment is that student in one batch. Repeating a convert returns the admission or student already stored. It does not create a second person or a second enrollment in the same batch.

Staff do not re-enter a value the previous record already has. Enquiry conversion copies name, WhatsApp number as the contact number, course, present institution into an academic record’s institution, and any answer whose question also exists on the admission form. The admission then asks only for what is still empty. Attaching to an existing student fills only empty profile fields.

### Field placement

Built-in fields stay where they are collected. Extra questions are configured in Administration → Forms.

| Information | Collected on | Shown later | Required |
|---|---|---|---|
| Name, WhatsApp, present institution, course, interest, references, other details | Enquiry | Copied into the admission and, for the institution, into previous education | Name to save. A required enquiry question before Create admission. |
| Follow-up date, discussion, interest, next date | Enquiry, through Add follow-up | The enquiry’s follow-up list. The register shows the latest next date. | Date and discussion to save a follow-up. |
| Name, contact number, date of birth, gender, blood group, email, address, guardian | Admission | The student Personal section. Empty fields are filled when an admission attaches to an existing student. | Name, contact number, and course to save. |
| Previous education | Admission | Student → Previous education. This is not current performance. | Optional. |
| General questions | Enquiry, admission, or both, in the section chosen in Forms | Admission answers on the admission and on Student → Admissions. A question marked for the student profile also appears under Personal. | Optional, required to create the admission, or required to enroll. |
| Course questions | The admission for that course | That admission, and the course block on Student → Admissions | Optional, required to create the admission, or required to enroll. |
| Branch and batch | Enrollment | Student → Enrollments, and the Students register summary | Both, and an open batch, to enroll. |

Yes/No stores Yes, No, or Not answered. A consent checkbox stores Yes only when ticked. A blank consent is not a No. Dropdown options are one per line, so an option may contain a comma. Removing a question that already has answers retires it: new forms hide it, and the stored answer keeps its label. A newly required question applies to the next save or enrollment. It does not reopen an admission that is already enrolled. Follow-up timing uses the institute date, which is the UTC calendar date: overdue is before that date, today is that date, and upcoming is after it. Due remains the dashboard queue: not yet admitted, and unscheduled or due today or earlier. After Create admission, the enquiry keeps its follow-up history and does not offer another follow-up.

### Stages

| Stage | Stored as | What staff can do | Required before the next step | Validation | Next |
|---|---|---|---|---|---|
| Enquiry | No `admission_id` | Add, edit, import, record a follow-up, create an admission | Name. WhatsApp and every required enquiry question before Create admission. Course is optional and, once set, must exist. | Name present. Interest is High, Medium, Low, or blank. | Admission |
| Follow-up | Rows on the enquiry | Add a contact. The latest row drives the queue. | Date and what was discussed. Interest and next date are optional. | Dates are real dates. Interest is the same three values or blank. | Stay on the enquiry. Due when there is no follow-up, no next date, or the next date is today or earlier. |
| Admitted | Enquiry has `admission_id`. Admission status `open`. | Edit the admission. Enroll. Open the enquiry. | Name, phone, and course to save. To enroll: branch, open batch of that course, required admission questions, required course questions. | Phone present. Email, PIN, date of birth, gender, and blood group follow the current field rules when filled. | Student |
| Enrolled | Admission status `converted`, with `student_id` and `enrollment_id` | Open the student or the batch. Edit the student, not the admission. | Nothing further on the admission. | A second convert returns the same student. | Student record |

There is no cancelled, lost, or closed enquiry. Recording a future next date is the only way to leave the follow-up queue without admitting. A person who will not join stays in that queue. This redesign does not add a status for that. Copy may say so later. It must not invent the status.

### Routes

**New enquiry.** Enquiries → Add enquiry → Save → open the row → Add follow-up when contact happens → Create admission. Create admission fails with the WhatsApp message when the number is empty, or with the question message when a required enquiry answer is empty. The new admission opens with the copied fields. The operator completes what enrollment requires and chooses branch and batch.

**Direct admission.** Admissions → Add admission, which opens `/students/admissions/new`. There is no enquiry. Course, name, and phone are required to save. Enrollment uses Enroll.

**Returning student.** Enroll on an open admission. If an active student has the same normalized name and the same phone, the server returns `admission.match` and the dialog title is “This student may already exist”. Add to this student creates an enrollment on that identity and fills only empty profile fields. Create a new student is explicit and is allowed while a match is showing. The same name with a different phone is not a match. An archived student is not a match. A merged source stays archived and points at the surviving student.

**Incomplete admission.** Save is allowed without date of birth, address, academic detail, or required answers. Enroll lists every missing requirement before the request. The page keeps the branch and batch the operator chose. Changing either clears the previous gap list.

**Duplicate attempt.** Create admission on an enquiry that already has an admission opens that admission. Enroll on a converted admission opens the student. Neither writes a second record.

**Unavailable batch.** The batch must belong to the selected branch and the admission’s course, and it must have no ended date. Otherwise Enroll stops with the context or closed-batch message and the admission stays open. A closed batch says “This batch is closed. New enrollments stay out.”

**Import.** Enquiry import creates enquiries and does not admit them. Admission import creates open admissions. A row that matches name and phone is saved only after attach or create. Rows with errors are not saved.

**Permission.** A reader can open every screen in this journey and cannot add, edit, import, follow up, or enroll. A manager can write. Enrollment also checks `student.manage` on the chosen branch, course, and batch. A failure says the action is not permitted and leaves the form as it was. A manager without that tuple can still see the admission, because the read path is not scoped.

## Other daily workflows

Each journey uses the shortest path the app already supports. Empty means there is nothing to show. Failure means the request did not succeed; the page keeps what the operator entered and offers retry where a load failed. Role limits are the grants above.

Academic rules that stay: one student code per person; a second batch is a second enrollment; transfer sets `ended_on` on the source and creates the destination; results stay on the enrollment that sat the assessment; a batch with `ended_on` is closed and rejects a new enrollment; a teaching assignment does not grant login; cards and views use authorized published results; a draft stays off progress cards; manual entry and import use the same identity and enrollment rules; import rollback does not remove records that existed before the import.

### Find and edit a student

Students → type a name or student id in Search. The query is `q` in the address and updates after a short pause or Enter. Branch, course, period, and batch come from the context bar, not a second filter dialog. Open the name → Personal, Academics, or History → Edit → Save. Return goes to the batch when `returnTo` is set, otherwise to Students. Empty register: no students match this search, or this context, and Clear removes the search. Load failure shows the error and Try again. History is absent when the user cannot see it. Contact and address are absent when the user cannot manage the student. Published progress is absent without the card grant, and an empty progress state stays distinct from a failed load.

### Transfer or add a batch

Student → Academics → Transfer on a current enrollment, or Add enrollment. Choose branch, course, and an open batch, then save. Transfer keeps the source enrollment and its results. Add enrollment refuses a batch the student is already in and a closed batch. Cancel closes the dialog. A failed save leaves the dialog open with the error.

### Set up a branch, course, and batch

Institute → Add branch → open the branch → Courses → Offer a course → Add batch. Alternatively, Courses → Add course → open the course → add subjects and papers, then Batches → Add batch under an existing offering. Curriculum belongs to the course. The batch links to it and does not copy it. Empty branch: it offers no course yet. Empty course: no subjects yet. Duplicate or mismatched relationships are rejected and the dialog stays. A reader with only lookup can open the pages and cannot add.

### Assign a teacher

Teachers → Add teacher → open the teacher → Add course, or from the batch → Add a teacher → choose teacher, subject, and optional paper → Assign. End keeps the assignment as history. The batch must be open to assign. Empty: no teacher is assigned. Failure stays on the form. This does not create a user.

### Enter or import marks

Marksheets → Add marksheet → Enter here, or Import a workbook. Enter here creates a draft. The marksheet states the next step: enter scores then publish, publish a submitted sheet, or withdraw a published sheet to correct it. A draft can take an exam date, score edits, and added students. Submitted is waiting for review and is what the dashboard counts. Publish makes it available to cards and views. Withdraw retracts the published revision. Leaving unsaved scores, including by a sidebar link, asks “Discard the unsaved changes?”. Empty marksheet list: no marksheets yet. A filtered empty list says nothing matched and how to clear it. A failed load is an error, not an empty table. Branch, course, period, and batch are the context bar. Paper, exam type, and exam dates are More filters.

### Report progress

From the student, the enrollment card, the batch, or Progress Cards / Academic Views. Filters use the context already chosen. Results that are not published are not in the totals. An unpublished or unauthorized empty state says why. Print evidence is part of DES-24; the card’s content and the chrome that printing drops are part of DES-20.

### Start from the dashboard

Open Dashboard → open a figure or a queue. Currently enrolled opens Students with `enrollment=current`. Active batches opens Batches with `active=1`. Admissions awaiting enrollment opens Admissions with `status=open`. Follow-ups due opens Enquiries with `follow_up=overdue`. Marksheets awaiting review opens Marksheets with `status=submitted`. Failed imports opens Import with `state=failed`. Branch, course, and batch travel with students, batches, marksheets, and imports. Enquiries and admissions take the course only. A zero count still opens that filtered register. The register shows the filter that produced the count. Queues are institute work the grant can see. They are not described as personally assigned.

## What the redesign changed

The people strip is gone. Students stays highlighted on a student record and does not highlight on Enquiries or Admissions. Record titles use the person’s name. Search on the registers is inline and kept in the address. The context bar is the only branch, course, period, and batch control on the pages that show it. Enroll lists missing requirements before it sends. Unsaved enquiry, admission, student, and score edits ask before a sidebar link, Cancel, or Escape discards them. Batch enrollment and teacher assignment open from Add a student and Add a teacher. Sign-in shows email and password first. An authentication code appears only when the server requires it. Questions are configured in Forms. Create admission is the enquiry action, and an open admission shows its readiness instead of a blanket enroll label. The friction column above is the audit of the earlier screens.

## Acceptance walk

On 16 October 2026 these three paths were completed in the running app:

1. Add enquiry, record a follow-up, Admit, choose North Branch and Morning, Enroll. The student record opened with Students highlighted.
2. Open the batch, open the student, open the progress card. Before publication the card said drafts stay off it.
3. Add marksheet → Enter here, add the enrolled student with a score, set the exam date after publication named that gap, Publish. The card and Academic Views then showed the published result.

Publishing without an exam date is a stated requirement, not a blocked path. The page names the missing date and keeps the scores.
