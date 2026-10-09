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
