export const CONTEXT_KEYS = ["branch_id", "course_id", "batch_id", "period"] as const;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function contextSearch(params: URLSearchParams) {
  const next = new URLSearchParams();
  for (const key of CONTEXT_KEYS) {
    const value = params.get(key);
    if (value) next.set(key, value);
  }
  return next;
}

export function periodLabel(key: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return key;
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${month} ${match[1]}` : key;
}
