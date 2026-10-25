export type Option = {
  id: string;
  label: string;
  parents?: {
    branch_id?: string;
    course_id?: string;
    subject_id?: string;
    branch_ids?: string[];
    session_key?: string;
  };
};

export function optionFits(option: Option, filters: Record<string, string>) {
  const parents = option.parents || {};
  if (filters.branch_id) {
    if (parents.branch_id && parents.branch_id !== filters.branch_id) return false;
    if (parents.branch_ids && !parents.branch_ids.includes(filters.branch_id)) return false;
  }
  if (filters.course_id && parents.course_id && parents.course_id !== filters.course_id) return false;
  if (filters.subject_id && parents.subject_id && parents.subject_id !== filters.subject_id) return false;
  return true;
}

export const CONTEXT_FIELDS = [
  ["branch_id", "Branch", "branch"],
  ["course_id", "Course", "course"],
  ["batch_id", "Batch", "batch"],
  ["subject_id", "Subject", "subject"],
  ["paper_id", "Paper", "paper"],
] as const;

const CHILD_FIELDS: Record<string, string[]> = {
  branch_id: ["course_id", "batch_id", "subject_id", "paper_id"],
  course_id: ["batch_id", "subject_id", "paper_id"],
  subject_id: ["paper_id"],
};

export function clearIncompatible(filters: Record<string, string>, options: Record<string, Option[]>, changed: string) {
  const next = { ...filters };
  const cleared: string[] = [];
  for (const field of CHILD_FIELDS[changed] || []) {
    const dimension = CONTEXT_FIELDS.find(([key]) => key === field)?.[2];
    const selected = next[field];
    if (!selected || !dimension) continue;
    const match = (options[dimension] || []).find((option) => option.id === selected);
    if (match && !optionFits(match, next)) {
      next[field] = "";
      cleared.push(field);
    }
  }
  return { filters: next, cleared };
}

export function clearDescendants(filters: Record<string, string>, changed: string) {
  const next = { ...filters };
  const cleared: string[] = [];
  if (next[changed]) return { filters: next, cleared };
  for (const field of CHILD_FIELDS[changed] || []) {
    if (!next[field]) continue;
    next[field] = "";
    cleared.push(field);
  }
  return { filters: next, cleared };
}

export function scopeOptions(draft: Record<string, string>, options: Record<string, Option[]>) {
  const branchId = draft.branch_id || "";
  const courseId = draft.course_id || "";
  const period = draft.period || "";
  const selected = { branch_id: branchId, course_id: courseId };
  const courses = (options.course || []).filter((item) => optionFits(item, { branch_id: branchId }));
  const periods = Array.from(
    new Set(
      (options.batch || [])
        .filter((item) => optionFits(item, selected) && item.parents?.session_key)
        .map((item) => item.parents?.session_key || ""),
    ),
  ).filter(Boolean).sort();
  const periodChoices = period && !periods.includes(period) ? [period, ...periods] : periods;
  const batches = (options.batch || []).filter((item) => optionFits(item, selected) && (!period || item.parents?.session_key === period));
  return { courses, periodChoices, batches };
}

export function applyScopeChange(filters: Record<string, string>, options: Record<string, Option[]>, key: string, value: string) {
  const merged = { ...filters, [key]: value };
  const manual: string[] = [];
  if (key === "branch_id") {
    for (const field of ["course_id", "batch_id"]) {
      if (!merged[field]) continue;
      merged[field] = "";
      manual.push(field);
    }
  } else if (key === "course_id" && merged.batch_id) {
    merged.batch_id = "";
    manual.push("batch_id");
  } else if (key === "period" && merged.batch_id) {
    const batch = (options.batch || []).find((item) => item.id === merged.batch_id);
    if (!value || batch?.parents?.session_key !== value) {
      merged.batch_id = "";
      manual.push("batch_id");
    }
  }
  const fitted = clearIncompatible(merged, options, key);
  const opened = value ? { filters: fitted.filters, cleared: [] as string[] } : clearDescendants(fitted.filters, key);
  return {
    filters: value ? fitted.filters : opened.filters,
    cleared: [...new Set([...manual, ...fitted.cleared, ...opened.cleared])],
  };
}
