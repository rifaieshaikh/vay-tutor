# Institute management baseline

Date: 15 October 2026 · Status: Accepted as the Phase 1 baseline · Plan: [institute-management-task-list.md](institute-management-task-list.md)

This is the IMS-02 inventory, the IMS-03 entity model, the IMS-04 permission contract, and the IMS-05 migration record. It does not implement navigation, workflows, or database changes. Historical completion records stay in [task-list.md](task-list.md). Decision changes are listed in [m0-decisions.md](m0-decisions.md) under IMS-01.

No collection rewrite is required. Existing collections stay. Later phases reuse them and migrate only where a check below shows a real gap.

## IMS-02 — Inventory

Mapped from the application on 15 October 2026, including the intake and teacher work committed that day. A capability’s current entry point is not its destination.

### Destinations

| Module | Owns | Current entry | Destination | Owner now |
|---|---|---|---|---|
| Dashboard | Pending operational work | `/` Overview, aimed at import | Dashboard | Frontend `Overview.tsx`; no count API |
| Admissions | Enquiries, follow-up, admissions, conversion | `/students/enquiries`, `/students/admissions` | Admissions | `Intake.tsx`, `intake.py` |
| Students | Identity, profile, enrollments, progress | `/students`, `/students/:studentId` | Students | `Catalog.tsx` list, `Student.tsx`, student routes in `importing/routes.py` |
| Academics | Branches, courses, offerings, batches, curriculum | `/institute`, `/courses`, `/batches`, branch page | Academics | `Catalog.tsx`, `Branch.tsx`, `catalog_pages.py` |
| Staff | Teacher identity and teaching assignments | `/teachers`, `/access` | Staff | `Access.tsx`, teacher routes in `http.py` |
| Assessments | Import, marksheets, review, publication | `/import`, `/marksheets` | Assessments | `Import.tsx`, `Marksheets.tsx`, `importing/` |
| Reports | Cards, academic views, exports | `/cards`, `/views` | Reports | `Cards.tsx`, `Views.tsx`, `reporting.py` |
| Administration | Accounts, grants, audit, policy, recovery | `/access`, `/audit`, `/settings` | Administration | `Access.tsx`, `Audit.tsx`, `Settings.tsx` |

### Pages and routes

Primary navigation is still a flat list in `Shell.tsx`: Overview, Import Marklist, Marksheets, Progress Cards, Academic Views, Students, Teachers, Institute, Courses, Batches, Users and Access, Audit, Settings. Visibility is a single action on the link, not the full scope tuple.

| Route | Gate | Notes |
|---|---|---|
| `/` | session | Import call-to-action when the user has `marksheet.upload`. |
| `/import` | `marksheet.upload` | Marklist wizard. |
| `/marksheets`, `/marksheets/:id` | `marksheet.view` | Register and review. Manual add needs `marksheet.upload`. |
| `/cards` | `progress_card.view` | |
| `/views` | `dashboard.view` | Six academic levels. |
| `/students` | `student.lookup` | Enrolled directory. |
| `/students/enquiries`, `/students/enquiries/:id` | `student.lookup` | Enquiry list and follow-up. |
| `/students/admissions`, `/students/admissions/:id` | `student.lookup` | Admission list and conversion. |
| `/students/:studentId` | `student.lookup` | Profile, enrollments, history. |
| `/teachers`, `/teachers/:teacherId` | `user.manage` | Staff record. Login is optional. |
| `/institute`, `/institute/branches/:branchId` | `student.lookup` | Institute and branch, including offerings and batches. |
| `/courses`, `/courses/:courseId` | `student.lookup` | Course curriculum. |
| `/batches` | `student.lookup` | Batch list. |
| `/access`, `/access/:userId` | `user.manage` | Users and grants. |
| `/audit` | `audit.view` | |
| `/settings` | `dashboard.view` | Policy. Editing is enforced on the server. |

### API entry points

All routes are under `/api/v1`. Routers: `http.py`, `importing/routes.py`, `catalog_pages.py`, `intake.py`.

| Area | Routes |
|---|---|
| Session | `POST /bootstrap`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/session`, `POST /auth/password`, `POST /auth/recovery/redeem`, `POST /factory-reset` |
| Access | `GET/POST /users`, `PATCH /users/{id}`, `GET/POST /roles`, `PATCH /roles/{id}`, `POST /grants`, `DELETE /grants/{id}`, `GET /users/{id}/effective-access`, `PUT /users/{id}/teaching` |
| Staff | `GET/POST /teachers`, `GET/PATCH /teachers/{id}`, `PUT /teachers/{id}/teaching` |
| Academics | `GET/PATCH /institute`, `POST /branches`, `POST /courses`, `POST /courses/{id}/subjects`, `GET /branches/{id}`, `POST /branches/{id}/courses`, `POST /branches/{id}/batches`, `POST /subjects/{id}/items`, `PATCH /subjects/{id}/items/{itemId}`, `GET /catalog`, `PATCH /catalog/{kind}/{id}`, `GET /context/options` |
| Admissions | `GET/POST /enquiries`, `GET/PATCH /enquiries/{id}`, follow-ups, `POST /enquiries/{id}/convert`, enquiry import preview and commit; the same shape for `/admissions`, plus `POST /admissions/{id}/convert` |
| Forms | Course questions and `/form-questions` for enquiry and admission forms |
| Students | `GET /students`, `GET /students/options`, `PATCH /students/{id}`, photo, aliases, `GET /students/{id}/enrollments`, `POST /students/{id}/enrollments`, enrollment dates, `GET /students/{id}/history`, `GET /students/{id}/card`, merge preview and merge |
| Assessments | Import job routes, `GET/POST /marksheets`, result edits, submit, reject, publish, correct, withdraw, `POST /rosters/confirm` |
| Reports | `GET /views/{level}`, `POST /reports/cards`, `GET /files/{id}`, `GET /jobs/{id}` |
| Administration | `GET /audit`, `GET /policies/active`, `POST /policies`, `GET /health`, `GET /compatibility` |

### Collections in use

`institutes`, `users`, `sessions`, `roles`, `grants`, `audit_events`, `policies`, `counters`, `schema_meta`, `branches`, `courses`, `offerings`, `batches`, `subjects`, `papers`, `students`, `aliases`, `enrollments`, `enrollment_names`, `assessments`, `attempts`, `marksheets`, `results`, `rosters`, `import_jobs`, `files`, `jobs`, `teachers`, `enquiries`, `admissions`, `course_questions`, `form_questions`.

`exam_types` and `assessment_links` from the M1 collection table are not written by the application. Exam type is a field on the assessment and the marksheet. Chapters and modules are items on the subject, not their own collection.

### Permissions in force

The action catalog in `acl.py` is unchanged: `dashboard.view`, `student.lookup`, `student.manage`, `marksheet.view`, `marksheet.upload`, `marksheet.edit_draft`, `marksheet.submit`, `marksheet.publish`, `marksheet.correct`, `marksheet.withdraw`, `import.create_scope`, `progress_card.view`, `export.pdf`, `export.xlsx`, `catalog.correct`, `catalog.manage`, `user.manage`, `grant.manage`, `audit.view`, `backup.admin`.

Seed bundles: `institute_admin` (every action), `branch_admin` (academic and student actions, no user or grant management), `academic_coordinator` (import, review, publish, catalog correct, no `student.manage`), `teacher` (view, upload, draft edit, submit, lookup, card), `viewer` (dashboard, lookup, marksheet view, card).

Scope is still one complete tuple: institute, branch, course, batch, subject, paper. A null dimension means every descendant. Grants do not cross disjoint tuples.

### Tests

| File | Covers |
|---|---|
| `test_m2.py` | Bootstrap, session, disjoint grants, escalation, revocation, jobs, audit |
| `test_m3.py` | Sample workbook import, conflicts, revisions, catalog reuse |
| `test_m4.py` | Policy, cards, exports, views, roster participation |
| `test_policy.py` | Policy versions and who may change settings |
| `test_catalog_pages.py` | Manual branch, course, and subject details |
| `test_student_profile.py` | Photo, enrollment dates, another enrollment |
| `test_mod30.py`, `test_mod31.py` | Student directory scope, edits, history |
| `test_intake.py` | Enquiry to admission to student, spreadsheet intake, form questions |
| `test_teachers.py` | Teacher list and course assignment |

### Duplicate responsibilities

- Student creation has three writers: marklist commit, admission conversion, and `POST /students/{id}/enrollments` for an existing student. Each has its own match rule.
- Academic creation has two writers: import commit, and the catalog posts (`/branches`, `/courses`, offerings, batches, subjects, papers).
- Marksheet creation has two writers: import commit, and `POST /marksheets`. Both can leave a draft.
- Teaching work for a login user is stored as `teacher`-role grants. The same screen stores `teachers.assignments` only when the teacher has no login.
- Enquiry and admission pages live under Students. The enrolled directory is a different list on the same module.
- Catalog correction exists both as `PATCH /catalog/{kind}/{id}` and as the newer institute, branch, and course pages.

### Gaps

- No admissions action. Enquiry and admission routes allow anyone who holds `student.lookup` or `student.manage` anywhere, and they do not apply the scope tuple.
- No admissions-operator seed role. `student.manage` exists only on the institute and branch admin bundles.
- Saving teaching for a teacher who can log in deletes and recreates that user’s `teacher` grants for the course. That grants the teacher role’s marksheet actions. A teacher without a login keeps assignments and receives no grant.
- `unit_ids` are stored on grants and assignments. `allows` does not consult them.
- A batch `ended_on` is stored and does not block a new enrollment.
- There is no transfer operation. Ending one enrollment and adding another are separate calls.
- Dashboard counts for follow-up, admissions, marksheet review, and failed imports do not exist. Enquiry follow-up has `next_on` and interest. Admissions are `open` or `converted`. Marksheets use draft, submitted, published, and withdrawn. Import jobs use the states in M1. Those are the statuses a later dashboard may count. Do not invent a new status to make a count.
- Directory and intake lists use page and page size. The M1 list contract is still cursor pagination for marksheets and jobs.
- `backup.admin` has no backup route yet. That remains OPS-02.

### Release work this plan does not close

Still open in [task-list.md](task-list.md): MOD-21 acceptance, MOD-23, MOD-29, MOD-30, MOD-31, M5 desktop and cloud tasks (DSK-01–05, OPS-01–03, CLD-01–02), QA-03–06, and REL-01–04. MOD-23 and MOD-29 stay open until academic acceptance, even where an implementation note exists.

## IMS-03 — Entities and lifecycles

### Relationships

```text
institute
  branches
  courses
    subjects
      papers
      chapters and modules (subject items, not a second hierarchy)
  branch + course → offering
    offering + session → batch
  student
    enrollments → one branch, course, and batch each
  teacher
    teaching assignments → course, subject, and paper or chapter
    optional user, only when the person is given a login
  assessment → one branch, course, subject, paper, and one or more eligible batches
    attempt → marksheet → results
      each result → one enrollment
enquiry → at most one admission
admission → at most one student, chosen at conversion
```

Curriculum belongs to the course. A batch does not own a private copy of subjects or papers. An offering is the only link from a branch to a course. A batch belongs to one offering.

The academic period is the batch `session_key`. September 2026 is `2026-09`. January 2027 is `2027-01`. A batch name that does not parse uses its normalized name as the key. Uniqueness is offering plus `session_key`. Do not add a separate period collection unless one period must group batches that do not already share a session key.

### Lifecycles

**Enquiry.** Created manually or from a spreadsheet. It stores interest, a course of interest, and follow-ups. Follow-up `next_on` is the awaiting-follow-up signal. Convert creates one admission and stores `admission_id`. Converting again returns that admission.

**Admission.** Status is `open`, then `converted`. An open admission can be edited. Conversion asks for a branch and a batch of the admission’s course. The batch must belong to that branch and course. On success the admission stores `student_id` and status `converted`, and it is no longer editable. The student profile is filled only into empty fields when the person already exists.

**Student.** One institute identity, code `IAM-` plus six digits, allocated once. Profile, academic records, and course answers hang off that identity. Archive and merge keep the surviving student. A merged source is archived and points at `merged_into`. Archived students are excluded from admission name-and-phone matches.

**Enrollment.** One student in one batch. A second batch is a second enrollment, not a second student. `started_on` and `ended_on` are optional. An `ended_on` makes the enrollment historical. Results stay on the enrollment that sat the assessment.

**Returning student.** The same person joins a later batch. Admission matching looks across the institute for the same normalized name and phone. The operator chooses attach or create. Attach adds an enrollment on the existing student. Create is allowed only as an explicit choice when a match is present. A name match without the same phone is not a match.

**Transfer.** The person leaves one batch and continues in another. The source enrollment receives `ended_on` and stays historical. A new enrollment is created on the destination batch. Results already stored on the source enrollment stay there. The student code does not change. There is no automatic transfer in the current API; the two enrollment writes are the lifecycle. A later workflow may wrap them. It must not delete either enrollment or its results.

**Batch closure.** A batch with `ended_on` is closed. Closed batches remain readable with their enrollments, marksheets, and results. New enrollments and new admission conversions into that batch are rejected once this rule is enforced. Today `ended_on` is stored and the rejection is not enforced. That is a rule to add, not a new field.

**Archive.** Referenced branches, courses, subjects, papers, and students are not deleted. Archive sets the record aside. Renames change the display name and do not move results.

**Assessment.** Identity is branch, course, subject, paper, exam type, normalized title, maximum, and the eligible batches. One assessment may list more than one batch in the same branch and course. Each result row resolves to one enrollment in one of those batches. A mark is never copied into every eligible batch. A similarly named exam at another branch is a different assessment. Cross-branch comparison still requires an explicit comparable link, which the application does not write yet.

**Teacher.** The `teachers` document is the staff identity. `assignments` record course, subject, paper, and chapters. A login exists only when an operator creates an app user, which writes a `users` row and stores `user_id` on the teacher. Deactivating a login user is done on the user, not on the teacher row.

**Marksheet.** Draft, then submitted, then published. Rejection returns a submission to draft. Correction and withdrawal keep history. Only one active published revision contributes to cards and views. Drafts stay out of those outputs. Import and manual creation both enter as draft.

### Worked examples

These use the approved CA Foundation papers. They are the acceptance stories for the model. They do not require a data rewrite.

**Two branches.** IAM Tirur and IAM Kozhikode both offer CA Foundation, so there are two offerings. Accounting and paper 1 exist once, on the course. Each branch has its own September 2026 batch. A student enrolled only at Tirur does not appear on the Kozhikode batch. An Accounting result at Tirur is not a result at Kozhikode.

**Two enrollments.** Aisha is `IAM-000010`. Her first enrollment is Tirur, CA Foundation, September 2026. She returns for January 2027 at Tirur. That is a second enrollment on the same student. September papers stay on the September enrollment. January papers stay on the January enrollment. Her profile, phone, and academic records exist once.

**A transfer.** Aisha moves from the Tirur September 2026 batch to the Kozhikode September 2026 batch on 1 August 2026. The Tirur enrollment is historical with `ended_on` of that date. The Kozhikode enrollment starts that date. Papers already published for her Tirur enrollment remain Tirur results. She is still `IAM-000010`. Kozhikode does not get a second person with the same code.

**A shared assessment.** Economics Unit Exam 3, maximum 25, is one assessment eligible for the Tirur September 2026 batch and the Tirur January 2027 batch. Each scored row stores one of those enrollments. The combined rank is labeled as combined. Each batch rank is labeled as that batch. Branch and course totals count each result once. The Kozhikode exam of the same title is a different assessment unless someone later marks the pair comparable.

**Same name, unresolved.** Two different people named Shifa sit in different batches, with different phones. Import of a marklist does not merge them, matching DEC-03. An admission with that name and one of the phones must be attached explicitly or created explicitly. It must not pick a student by name alone.

## IMS-04 — Module permissions

Grants stay an action bundle plus one complete scope tuple. Modules do not replace that check. Staff identity and login stay separate: a `teachers` row grants nothing.

| Module | Actions that allow the work | Scope |
|---|---|---|
| Dashboard | `dashboard.view` for the shell; each count uses the action of the records it links to | The tuple of those records |
| Admissions | `student.lookup` to read, `student.manage` to create, edit, import, follow up, and convert | Branch, course, and batch named on the operation. An enquiry has a course of interest and no batch until conversion |
| Students | `student.lookup` to read, `student.manage` to edit, enroll, and merge | The enrollment’s branch, course, and batch. Subject and paper still hide results the grant does not cover |
| Academics | `catalog.correct` to edit, `catalog.manage` to create branches, courses, offerings, batches, and curriculum. `import.create_scope` still allows an import to create a missing branch, course, or subject inside the tuple | Parent tuple. Creating a record does not insert a grant |
| Staff | `user.manage` to keep teacher records. `grant.manage` to give or remove login actions | Institute for the staff list. A teaching assignment is not a grant |
| Assessments | `marksheet.view`, `marksheet.upload`, `marksheet.edit_draft`, `marksheet.submit`, `marksheet.publish`, `marksheet.correct`, `marksheet.withdraw` | Full tuple, including every batch on a shared assessment before publish |
| Reports | `dashboard.view`, `progress_card.view`, `export.pdf`, `export.xlsx` | Same tuple as the underlying results. Hidden rows are not counted |
| Administration | `user.manage`, `grant.manage`, `audit.view`, `backup.admin`, plus policy changes through the settings checks already in force | Institute, narrowed by the same delegation rules as today |

An admissions operator is a custom or future seed bundle with `student.lookup` and `student.manage` only. That bundle is not seeded today. Branch admin already includes those two actions plus marksheet and catalog actions, so a branch admin is not the admissions example.

### Allowed and denied

**Administrator.** Institute-wide grant of every action. Allowed: create the Kozhikode branch and its CA Foundation offering, record an enquiry, convert an admission into the Kozhikode September batch, and publish a marksheet there. Also allowed: create a teacher without a login and store a teaching assignment, which writes no grant. Denied: removing the last active institute administrator, and granting an action the actor does not hold. Those existing rules stay.

**Admissions operator.** `student.lookup` and `student.manage` on IAM Kozhikode only, all courses and batches there, no subject restriction. Allowed: create an enquiry for CA Foundation, convert it into a Kozhikode batch of that course, and open the new student’s Kozhikode enrollment. Denied: a Tirur enrollment, publishing a marksheet, opening Users and Access, creating a grant, and creating a branch. A direct API call uses the same denial. Today’s enquiry routes do not enforce this tuple yet; this example is the contract those routes must meet.

**Scoped teacher.** `marksheet.view`, `marksheet.upload`, `marksheet.edit_draft`, `marksheet.submit`, `student.lookup`, and `progress_card.view` on Tirur, CA Foundation, Accounting. Allowed: import or open an Accounting marksheet for a Tirur batch, and see Accounting on that student’s card. Denied: Law, Accounting at Kozhikode, publish, export, admission conversion, and grant management. A second staff record that names this person as the Law teacher, with no login change, does not add Law.

**Disjoint grants.** Grant A is Accounting at Tirur. Grant B is Law at Kozhikode. Allowed: Accounting at Tirur, and Law at Kozhikode, for the actions on each grant. Denied: Law at Tirur, and Accounting at Kozhikode, including lists, totals, cards, source files, and exports. This is the existing AT-10 rule, restated for the new modules.

**Teaching without access.** An operator with `user.manage` saves Law at Kozhikode on a teacher who has no `user_id`. Allowed: the assignment is visible on the teacher. Denied: any marksheet, student, or admission request from that person, because there is no user and no grant. If that teacher later receives a login, the login starts with no grants until `grant.manage` adds some. Copying the assignment into grants is not implied.

## IMS-05 — Migration

Compared with the collections and indexes in `backend/app/db.py` and the writers above. Phase 1 changes no data.

### No document migration

The model fits the current documents.

- Course, subject, and paper already match the curriculum hierarchy. Chapters and modules already live on the subject.
- Offering and batch already link a branch and a course to a cohort. `session_key` is the period.
- Students and enrollments already allow more than one batch per student. `ended_on` already marks history.
- Admissions already store `student_id` after conversion. Enquiries already store `admission_id`.
- Assessments already store `batch_ids`. Results already store one enrollment.
- Teachers already exist apart from users. Assignments already exist for teachers without a login.
- `schema_meta` stays at version 1. Indexes for teachers, enquiries, admissions, and questions are created on startup before that version check, and they do not rewrite documents. Dropping one of those indexes is the reversal. Take the usual backup first if an operator drops an index on a populated database.

### Do not backfill

- Do not copy `teacher` grants into `teachers.assignments`, and do not copy assignments into grants. A grant is permission. An assignment is a teaching post. Merging them would repeat the coupling IMS-04 forbids.
- Do not auto-merge students who share a name. DEC-03 still forbids that for marklists. Admission attach is an operator decision.
- Do not add an academic-period collection or a batch-closed flag. Use `session_key` and `ended_on`.

### Checks before any later write

Run these against a copy of a populated database. They are reads. A clean database returns no rows. A row is an exception to repair or accept before a later migration, not an automatic update.

1. **Enrollment drift.** An enrollment whose `batch_id` is missing, or whose `branch_id` or `course_id` disagrees with that batch.
2. **Offering drift.** A batch whose `offering_id` is missing, or whose offering names a different branch or course.
3. **Result drift.** A result whose `enrollment_id` is missing, or whose student is not the student on that enrollment.
4. **Shared assessment drift.** A marksheet `batch_ids` value that is not a batch, or a result enrollment whose batch is not in that list.
5. **Admission link.** An admission with status `converted` and no `student_id`, or a `student_id` that is not a student. An enquiry `admission_id` that is not an admission.
6. **Teacher link.** A teacher `user_id` that is not a user in the same institute.
7. **Possible duplicate people.** Two active students in the institute with the same `name_key` and the same `phone_key`. Report them. Do not merge them in this check.

Identity, publication, and grant documents are not rewritten by these checks. Counts of students, enrollments, and active results before and after any future migration must match, except where a recorded repair says which row changed and why.

### Check on 15 October 2026

The installed `vay_tutor` database had an institute and no academic, admission, or teacher rows, so it could not exercise the relationships. The check used a temporary database loaded from the four sample workbooks, then added IAM Kozhikode with a CA Foundation September 2026 batch, one teacher without a login, and one enquiry converted into an admission and enrolled in that batch. The temporary database was dropped after the reads. Nothing in `vay_tutor` was written.

| Check | Result |
|---|---|
| Students / enrollments / results | 65 / 65 / 490 |
| Branches / batches / marksheets | 2 / 3 / 29, of which 5 marksheets list more than one batch |
| Enquiries / admissions / teachers | 1 / 1 / 1 |
| Enrollment, offering, result, shared-assessment, admission, and teacher drift | 0 |
| Active students sharing a name and phone | 0 |

No document migration follows from this check.

### Recovery

Phase 1 has no migration to roll back. Any later migration uses the existing backup: a `mongodump` of the replica set plus the private files directory, taken before the write, as in the architecture’s upgrade and restore rules. Restore replaces the database and the files, then checks the manifest counts. Import commit and publication keep their current transaction boundaries. A failed later migration restores that backup rather than deleting pre-existing manual records.

## Shared academic context (Phase 2)

Academic period is the batch `session_key` already stored on a batch (`2026-09`, `2027-01`). There is no period collection and no new field on the batch.

The shared context is four URL parameters: `branch_id`, `course_id`, `batch_id`, and `period`. An empty value means all authorized records for that dimension. Changing branch clears course and batch. Changing course or period clears a batch that no longer fits. The bar is shown on Dashboard, Students, Marksheets, Progress Cards, Academic Views, and Batches.

Admissions and the course catalog keep those parameters in the address so the context survives navigation, and they do not send `batch_id` or `period` to their APIs. Enquiry and admission lists use `course_id` only. A selected id the caller cannot use is dropped and the authorized set remains. A period with no matching batches matches no rows.

Dashboard queues use the statuses that already exist. An enquiry is awaiting follow-up when it is not yet an admission and the latest follow-up has no next date or a next date on or before today. An admission is awaiting conversion while its status is `open`. A marksheet is awaiting review while its status is `submitted`. A failed import is an import job whose state is `failed`. Draft marksheets are not in review. Import jobs are not narrowed by branch.

## Batch workspace (Phase 3)

A batch page at `/batches/{id}` links the batch to its branch, course curriculum, enrolled students, teaching posts, and marksheets. Curriculum stays on the course. Creating a branch, offering, or batch still uses the existing academic pages and does not require an import.

A teaching post is an assignment on the teacher: batch, subject, optional paper, from date, until date, and status `current` or `ended`. Ending a post keeps the row. The same teacher can hold posts on more than one batch. Saving a post does not create or change grants. The older course teaching screen can still write teacher-role grants for an app user; that screen is access, and the batch post is not.

A batch with `ended_on` is closed. New enrollments and new teaching posts into that batch are rejected. Existing enrollments, posts, and marksheets stay readable.

## Connected records (Phase 4)

An enquiry shows its stage and the next action. Admitting it opens the admission. Enrolling that admission creates or reuses one student and one enrollment in the chosen batch. Doing it again does not create a second student or a second enrollment. The same name with a different phone is a different person. The same name and phone asks the operator to attach or create.

A transfer ends the source enrollment and opens another. Both enrollments stay. Results stay on the enrollment that sat the assessment. A closed batch rejects a new enrollment and a new admission conversion. Import of a historical workbook can still reuse a closed batch, and a failed import does not remove students that were already saved.

Contact and address on the student page are shown to staff who can manage that student. A lookup-only grant sees the identity, enrollments, and published results. Progress cards and academic views count the active published revision. Draft rows stay out of those totals.

Import opened from a batch or the marksheet list keeps that branch, course, and batch. If the workbook names a different one, the operator confirms the selected context before the import can be saved. A workbook opened with no selected context still uses its own headings.
