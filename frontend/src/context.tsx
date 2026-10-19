import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "./api";
import { Option, optionFits } from "./filters";

export const CONTEXT_KEYS = ["branch_id", "course_id", "batch_id", "period"] as const;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function showsContext(pathname: string) {
  return pathname === "/marksheets" || pathname === "/cards" || pathname === "/views" || pathname === "/batches" || pathname.startsWith("/batches/");
}

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

export function ContextBar() {
  const [params, setParams] = useSearchParams();
  const [options, setOptions] = useState<Record<string, Option[]>>({});
  const [ready, setReady] = useState(false);
  const [optionsError, setOptionsError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const branchId = params.get("branch_id") || "";
  const courseId = params.get("course_id") || "";
  const batchId = params.get("batch_id") || "";
  const period = params.get("period") || "";
  const selected = { branch_id: branchId, course_id: courseId };

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      ["branch", "course", "batch"].map(async (dimension) => {
        const page = await api<{ items: Option[] }>(`/api/v1/context/options?dimension=${dimension}`);
        return [dimension, page.items] as const;
      }),
    )
      .then((pairs) => {
        if (cancelled) return;
        setOptions(Object.fromEntries(pairs));
        setOptionsError("");
        setReady(true);
      })
      .catch((reason: Error) => {
        if (cancelled) return;
        setOptionsError(reason.message || "The context choices could not be loaded.");
        setReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    if (!ready) return;
    const next = new URLSearchParams(params);
    let changed = false;
    const branches = options.branch || [];
    const courses = options.course || [];
    const batches = options.batch || [];
    if (next.get("branch_id") && !branches.some((item) => item.id === next.get("branch_id"))) {
      next.delete("branch_id");
      next.delete("course_id");
      next.delete("batch_id");
      changed = true;
    }
    const filters = { branch_id: next.get("branch_id") || "", course_id: next.get("course_id") || "" };
    if (next.get("course_id") && !courses.some((item) => item.id === next.get("course_id") && optionFits(item, filters))) {
      next.delete("course_id");
      next.delete("batch_id");
      changed = true;
    }
    const periodValue = next.get("period") || "";
    const batch = batches.find((item) => item.id === next.get("batch_id"));
    const batchFilters = { branch_id: next.get("branch_id") || "", course_id: next.get("course_id") || "" };
    if (
      batch &&
      (!optionFits(batch, batchFilters) || (periodValue && batch.parents?.session_key !== periodValue))
    ) {
      next.delete("batch_id");
      changed = true;
    } else if (next.get("batch_id") && !batch) {
      next.delete("batch_id");
      changed = true;
    }
    if (changed) setParams(next, { replace: true });
  }, [ready, options, params, setParams]);

  function write(field: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(field, value);
    else next.delete(field);
    if (field === "branch_id") {
      next.delete("course_id");
      next.delete("batch_id");
    }
    if (field === "course_id") next.delete("batch_id");
    if (field === "period") {
      const batch = (options.batch || []).find((item) => item.id === next.get("batch_id"));
      if (value && batch?.parents?.session_key !== value) next.delete("batch_id");
    }
    next.delete("page");
    setParams(next);
  }

  function clear(event: FormEvent) {
    event.preventDefault();
    const next = new URLSearchParams(params);
    for (const key of CONTEXT_KEYS) next.delete(key);
    next.delete("page");
    setParams(next);
  }

  const courses = (options.course || []).filter((item) => optionFits(item, { branch_id: branchId }));
  const periods = Array.from(
    new Set(
      (options.batch || [])
        .filter((item) => optionFits(item, selected) && item.parents?.session_key)
        .map((item) => item.parents?.session_key || ""),
    ),
  ).filter(Boolean).sort();
  const periodChoices = period && !periods.includes(period) ? [period, ...periods] : periods;
  const batches = (options.batch || []).filter((item) => {
    if (!optionFits(item, selected)) return false;
    return !period || item.parents?.session_key === period;
  });
  const active = Boolean(branchId || courseId || batchId || period);

  return (
    <form className="context-bar" aria-label="Academic context" onSubmit={clear}>
      {optionsError ? (
        <p className="error span-2" role="alert">
          {optionsError}{" "}
          <button type="button" className="quiet" onClick={() => setAttempt((value) => value + 1)}>Try again</button>
        </p>
      ) : null}
      <label>
        Branch
        <select value={branchId} onChange={(event) => write("branch_id", event.target.value)}>
          <option value="">All authorized</option>
          {(options.branch || []).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <label>
        Course
        <select value={courseId} onChange={(event) => write("course_id", event.target.value)}>
          <option value="">All authorized</option>
          {courses.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <label>
        Period
        <select value={period} onChange={(event) => write("period", event.target.value)}>
          <option value="">All authorized</option>
          {periodChoices.map((key) => <option key={key} value={key}>{periodLabel(key)}</option>)}
        </select>
      </label>
      <label>
        Batch
        <select value={batchId} onChange={(event) => write("batch_id", event.target.value)}>
          <option value="">All authorized</option>
          {batches.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      {active ? <button type="submit" className="text-button">Clear context</button> : null}
    </form>
  );
}
