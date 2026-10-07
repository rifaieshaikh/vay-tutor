export function ImportPage() {
  return (
    <section className="panel">
      <p className="eyebrow">Import Marklist</p>
      <h1>Upload a workbook</h1>
      <ol className="steps">
        <li>Choose branch, course, batch, subject, paper, and exam type, or leave them to be detected.</li>
        <li>Review records that will be created or reused.</li>
        <li>Resolve only the rows that conflict.</li>
        <li>Commit the draft. Publishing happens on a separate review screen.</li>
      </ol>
      <p>The workbook parser is the next build. This screen is the starting point, and an empty institute does not need a setup form first.</p>
    </section>
  );
}
