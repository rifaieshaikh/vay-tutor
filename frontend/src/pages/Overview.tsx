import { Link } from "react-router-dom";

export function OverviewPage({ canImport }: { canImport: boolean }) {
  return (
    <section className="panel">
      <p className="eyebrow">Overview</p>
      <h1>Start with a marklist</h1>
      <p>
        Import a workbook to create the branch, course, batch, subjects, and students. The wizard shows
        what will be inserted or updated before anything is saved. Nothing has to be entered before that.
      </p>
      {canImport ? (
        <Link className="button" to="/import">
          Import Marklist
        </Link>
      ) : (
        <p>A person who can upload marklists starts that import.</p>
      )}
    </section>
  );
}
