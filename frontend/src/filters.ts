export type Option = {
  id: string;
  label: string;
  parents?: {
    branch_id?: string;
    course_id?: string;
    subject_id?: string;
    branch_ids?: string[];
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
