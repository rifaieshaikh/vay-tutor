import { Link, useLocation, useSearchParams } from "react-router-dom";
import { contextSearch } from "./context";

type Crumb = { label: string; to?: string };

const RULES: [RegExp, Crumb[]][] = [
  [/^\/students\/enquiries\/[^/]+$/, [
    { label: "Admissions", to: "/students/enquiries" },
    { label: "Enquiries", to: "/students/enquiries" },
    { label: "Enquiry" },
  ]],
  [/^\/students\/enquiries$/, [
    { label: "Admissions", to: "/students/enquiries" },
    { label: "Enquiries" },
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
  [/^\/import$/, [
    { label: "Assessments", to: "/import" },
    { label: "Import Marklist" },
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
  [/^\/$/, [{ label: "Dashboard" }]],
];

export function pageOrientation(pathname: string) {
  const match = RULES.find(([pattern]) => pattern.test(pathname));
  const crumbs = match ? match[1] : [{ label: "Vay Tutor" }];
  return { title: crumbs[crumbs.length - 1].label, crumbs };
}

export function Breadcrumbs() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const { crumbs } = pageOrientation(pathname);
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
