import { Link } from "react-router-dom";

const TABS = [
  ["enquiries", "Enquiry", "/students/enquiries"],
  ["admissions", "Admissions", "/students/admissions"],
  ["students", "Students", "/students"],
] as const;

export function IntakeTabs({ current }: { current: (typeof TABS)[number][0] }) {
  return (
    <div className="page-tabs" role="tablist" aria-label="Students">
      {TABS.map(([id, label, to]) => (
        <Link key={id} role="tab" aria-selected={current === id} to={to}>{label}</Link>
      ))}
    </div>
  );
}
