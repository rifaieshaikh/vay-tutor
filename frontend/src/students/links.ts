export type StudentEnrollment = {
  id?: string;
  branch_id?: string;
  course_id?: string;
  batch_id?: string;
  branch_name: string;
  course_name: string;
  batch_name: string;
  started_on: string | null;
  ended_on: string | null;
  status: "current" | "historical" | null;
  manage?: boolean;
};

export type StudentFilters = { q: string; branch_id: string; course_id: string; batch_id: string };

export function safeBatchWorkspace(value: string | null) {
  if (!value || value.startsWith("//") || value.includes("://") || value.includes("\\")) return "";
  const [path, query = ""] = value.split("?");
  if (!/^\/batches\/[A-Za-z0-9]+$/.test(path)) return "";
  const incoming = new URLSearchParams(query);
  const next = new URLSearchParams();
  for (const key of ["branch_id", "course_id", "batch_id", "period", "student_page", "assessment_page", "section"]) {
    const item = incoming.get(key) || "";
    if (!item || item.includes("/")) continue;
    if (key === "section" && !["students", "teachers", "curriculum", "assessments"].includes(item)) continue;
    next.set(key, item);
  }
  const search = next.toString();
  return search ? `${path}?${search}` : path;
}

export function safeBatchList(value: string | null) {
  if (!value || !value.startsWith("/batches") || value.startsWith("//") || value.includes("://") || value.includes("\\")) return "";
  const path = value.split("?")[0];
  if (path !== "/batches") return "";
  return value;
}

export function safeAcademicReturn(value: string | null) {
  const list = safeBatchList(value);
  if (list) return list;
  if (!value || value.startsWith("//") || value.includes("://") || value.includes("\\")) return "";
  const path = value.split("?")[0];
  if (path === "/institute" || path === "/courses") return value;
  if (/^\/institute\/branches\/[A-Za-z0-9]+$/.test(path) || /^\/courses\/[A-Za-z0-9]+$/.test(path)) return value;
  return "";
}

export function safeStudentList(value: string | null) {
  if (!value || !value.startsWith("/students") || value.startsWith("//") || value.includes("://") || value.includes("\\")) return "";
  const path = value.split("?")[0];
  if (path !== "/students") return "";
  return value;
}

export function recordedDate(value: string | null | undefined) {
  return value || "Not recorded";
}

export function recordedStatus(value: string | null | undefined) {
  if (value === "current") return "Current";
  if (value === "historical") return "Historical";
  return "Not recorded";
}

export function recordedName(value: string | null | undefined) {
  return value || "Not recorded";
}

export function studentRecordHref(id: string, listPath: string, context: StudentFilters, edit = false) {
  const next = new URLSearchParams();
  if (context.branch_id) next.set("branch_id", context.branch_id);
  if (context.course_id) next.set("course_id", context.course_id);
  if (context.batch_id) next.set("batch_id", context.batch_id);
  if (edit) next.set("edit", "1");
  const back = safeStudentList(listPath);
  if (back) next.set("returnTo", back);
  const query = next.toString();
  return query ? `/students/${id}?${query}` : `/students/${id}`;
}
