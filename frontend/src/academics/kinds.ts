import { useEffect, useState } from "react";
import { api } from "../api";

export type CurriculumKind = {
  key: string;
  label: string;
  storage: "paper" | "unit";
  locked: boolean;
  archived: boolean;
};

const FALLBACK: CurriculumKind[] = [
  { key: "paper", label: "Paper", storage: "paper", locked: true, archived: false },
  { key: "part", label: "Part", storage: "unit", locked: false, archived: false },
  { key: "chapter", label: "Chapter", storage: "unit", locked: false, archived: false },
  { key: "module", label: "Module", storage: "unit", locked: false, archived: false },
];

export function useCurriculumKinds() {
  const [kinds, setKinds] = useState<CurriculumKind[]>(FALLBACK);
  useEffect(() => {
    let cancelled = false;
    api<{ items: CurriculumKind[] }>("/api/v1/curriculum-kinds")
      .then((body) => {
        if (!cancelled && body.items.length) setKinds(body.items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return kinds;
}

export function kindLabel(kinds: CurriculumKind[], key: string) {
  return kinds.find((item) => item.key === key)?.label || key.slice(0, 1).toUpperCase() + key.slice(1);
}

export type ExamType = { key: string; label: string; archived: boolean; weight?: number; part_heading?: string };

const EXAM_FALLBACK: ExamType[] = [
  { key: "test-series", label: "Test series", archived: false, weight: 1, part_heading: "Part" },
  { key: "module-exam", label: "Module exam", archived: false, weight: 2, part_heading: "Part" },
];

export function useExamTypes() {
  const [types, setTypes] = useState<ExamType[]>(EXAM_FALLBACK);
  useEffect(() => {
    let cancelled = false;
    api<{ items: ExamType[] }>("/api/v1/exam-types")
      .then((body) => {
        if (!cancelled && body.items.length) setTypes(body.items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return types;
}
