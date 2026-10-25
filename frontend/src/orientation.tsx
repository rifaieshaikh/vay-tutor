import { useEffect, useSyncExternalStore } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { contextSearch } from "./context";

type Crumb = { label: string; to?: string };

const RULES: [RegExp, Crumb[]][] = [
  [/^\/students\/enquiries\/import$/, [
    { label: "Enquiries", to: "/students/enquiries" },
    { label: "Import" },
  ]],
  [/^\/students\/enquiries\/[^/]+$/, [
    { label: "Enquiries", to: "/students/enquiries" },
    { label: "Enquiry" },
  ]],
  [/^\/students\/enquiries$/, [
    { label: "Enquiries" },
  ]],
  [/^\/students\/admissions\/new$/, [
    { label: "Admissions", to: "/students/admissions" },
    { label: "New admission" },
  ]],
  [/^\/students\/admissions\/[^/]+$/, [
    { label: "Admissions", to: "/students/admissions" },
    { label: "Admission" },
  ]],
  [/^\/students\/admissions$/, [{ label: "Admissions" }]],
  [/^\/students\/[^/]+$/, [
    { label: "Students", to: "/students" },
    { label: "Student" },
  ]],
  [/^\/students$/, [{ label: "Students" }]],
  [/^\/marksheets\/[^/]+$/, [
    { label: "Assessments", to: "/marksheets" },
    { label: "Marksheets", to: "/marksheets" },
    { label: "Marksheet" },
  ]],
  [/^\/marksheets$/, [
    { label: "Assessments", to: "/marksheets" },
    { label: "Marksheets" },
  ]],
  [/^\/ecr\/import$/, [
    { label: "Assessments", to: "/ecr" },
    { label: "ECR", to: "/ecr" },
    { label: "Import exams" },
  ]],
  [/^\/ecr\/exams\/[^/]+\/import$/, [
    { label: "Assessments", to: "/ecr" },
    { label: "ECR", to: "/ecr" },
    { label: "Upload marklist" },
  ]],
  [/^\/ecr\/[^/]+$/, [
    { label: "Assessments", to: "/ecr" },
    { label: "ECR", to: "/ecr" },
    { label: "Register" },
  ]],
  [/^\/ecr$/, [
    { label: "Assessments", to: "/ecr" },
    { label: "ECR" },
  ]],
  [/^\/import$/, [
    { label: "Assessments", to: "/ecr" },
    { label: "ECR", to: "/ecr" },
  ]],
  [/^\/cards$/, [
    { label: "Reports", to: "/cards" },
    { label: "Progress Cards" },
  ]],
  [/^\/views$/, [
    { label: "Reports", to: "/views" },
    { label: "Academic Views" },
  ]],
  [/^\/institute\/branches\/[^/]+$/, [
    { label: "Academics", to: "/institute" },
    { label: "Institute", to: "/institute" },
    { label: "Branch" },
  ]],
  [/^\/institute$/, [
    { label: "Academics", to: "/institute" },
    { label: "Institute" },
  ]],
  [/^\/courses\/[^/]+$/, [
    { label: "Academics", to: "/institute" },
    { label: "Courses", to: "/courses" },
    { label: "Course" },
  ]],
  [/^\/courses$/, [
    { label: "Academics", to: "/institute" },
    { label: "Courses" },
  ]],
  [/^\/batches\/[^/]+$/, [
    { label: "Academics", to: "/institute" },
    { label: "Batches", to: "/batches" },
    { label: "Batch" },
  ]],
  [/^\/batches$/, [
    { label: "Academics", to: "/institute" },
    { label: "Batches" },
  ]],
  [/^\/teachers\/[^/]+$/, [
    { label: "Staff", to: "/teachers" },
    { label: "Teachers", to: "/teachers" },
    { label: "Teacher" },
  ]],
  [/^\/teachers$/, [
    { label: "Staff", to: "/teachers" },
    { label: "Teachers" },
  ]],
  [/^\/access\/[^/]+$/, [
    { label: "Administration", to: "/access" },
    { label: "Users and Access", to: "/access" },
    { label: "User" },
  ]],
  [/^\/access$/, [
    { label: "Administration", to: "/access" },
    { label: "Users and Access" },
  ]],
  [/^\/audit$/, [
    { label: "Administration", to: "/audit" },
    { label: "Audit" },
  ]],
  [/^\/settings$/, [
    { label: "Administration", to: "/settings" },
    { label: "Settings" },
  ]],
  [/^\/forms$/, [
    { label: "Administration", to: "/forms" },
    { label: "Forms" },
  ]],
  [/^\/$/, [{ label: "Dashboard" }]],
];

let recordLabel = "";
const recordListeners = new Set<() => void>();

function publishRecord(label: string) {
  recordLabel = label;
  recordListeners.forEach((listener) => listener());
}

export function useRecordLabel(label: string) {
  useEffect(() => {
    publishRecord(label);
    return () => {
      if (recordLabel === label) publishRecord("");
    };
  }, [label]);
}

export function useRecordTitle() {
  return useSyncExternalStore(
    (listener) => {
      recordListeners.add(listener);
      return () => recordListeners.delete(listener);
    },
    () => recordLabel,
  );
}

export function pageOrientation(pathname: string, record = "") {
  const match = RULES.find(([pattern]) => pattern.test(pathname));
  const crumbs = match ? match[1].map((crumb) => ({ ...crumb })) : [{ label: "Vay Tutor" }];
  if (record && crumbs.length > 1) crumbs[crumbs.length - 1] = { label: record };
  return { title: crumbs[crumbs.length - 1].label, crumbs };
}

export function Breadcrumbs() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const record = useRecordTitle();
  const { crumbs } = pageOrientation(pathname, record);
  const search = contextSearch(params).toString();
  if (crumbs.length < 2) return null;
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <ol>
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          const href = crumb.to ? { pathname: crumb.to, search } : undefined;
          return (
            <li key={`${crumb.label}-${index}`}>
              {last || !href ? <span aria-current={last ? "page" : undefined}>{crumb.label}</span> : <Link to={href}>{crumb.label}</Link>}
              {last ? null : <span aria-hidden="true"> / </span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
