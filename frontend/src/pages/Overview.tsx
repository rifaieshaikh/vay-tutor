import { Link } from "react-router-dom";

export function OverviewPage({ canImport }: { canImport: boolean }) {
  return (
    <section className="panel">
      <p className="eyebrow">Overview</p>
      <h1>No academic records yet</h1>
      <p>
        Import a marklist to create the branch, course, batch, subjects, and students. Nothing has to be
        entered before that.
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
