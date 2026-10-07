import { useEffect, useState } from "react";
import { api, Session } from "../api";

type Student = { id: string; student_code: string; display_name: string };
type Result = {
  id: string;
  title: string | null;
  status: string;
  score: number | null;
  maximum: number | null;
  percentage: number | null;
  band: string | null;
  rank: number | null;
  batch_rank: number | null;
  exam_date: string | null;
  attempt: string;
};
type Card = {
  student_code: string;
  display_name: string;
  partial: boolean;
  coverage_note: string | null;
  policy_version: number;
  performance: { percentage: number | null; scored: number; expected: number; missing: number; absent: number; label: string };
  retests: { title: string | null; original_percentage: number | null; latest_percentage: number | null; change: number | null }[];
  results: Result[];
};

export function CardsPage({ session }: { session: Session }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    api<{ items: Student[] }>("/api/v1/students")
      .then((page) => setStudents(page.items))
      .catch((reason: Error) => setError(reason.message));
  }, []);

  async function open(student: Student) {
    setError("");
    setCard(await api<Card>(`/api/v1/students/${student.id}/card`));
  }

  async function exportCards(format: "pdf" | "xlsx") {
    setError("");
    try {
      const job = await api<{ id: string }>("/api/v1/reports/cards", {
        method: "POST",
        body: JSON.stringify({ format, scope: {} }),
      });
      if (session.actions.includes("backup.admin")) {
        await api("/api/v1/jobs/process", { method: "POST" });
        const finished = await api<{ state: string; file_id: string | null }>(`/api/v1/jobs/${job.id}`);
        if (finished.file_id) {
          setMessage("Export ready.");
          window.location.href = `/api/v1/files/${finished.file_id}`;
          return;
        }
      }
      setMessage("Export queued. It is checked again against your access when it runs.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not export.");
    }
  }

  return (
    <section className="panel">
      <p className="eyebrow">Students</p>
      <h1>Progress cards</h1>
      <p>Drafts stay off the card. Totals use the active published revision and policy version {card?.policy_version ?? 1}.</p>
      {session.actions.includes("export.pdf") ? <button type="button" onClick={() => exportCards("pdf")}>Export PDF</button> : null}
      {session.actions.includes("export.xlsx") ? <button type="button" onClick={() => exportCards("xlsx")}>Export spreadsheet</button> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {message ? <p className="ok">{message}</p> : null}
      {students.length === 0 ? <p>No students yet. Cards appear after a marklist is published.</p> : null}
      <ul className="people">
        {students.map((student) => (
          <li key={student.id}>
            <button type="button" onClick={() => open(student)}>{student.student_code} · {student.display_name}</button>
          </li>
        ))}
      </ul>
      {card ? (
        <article>
          <h2>{card.display_name}</h2>
          <p>{card.student_code}</p>
          {card.partial ? <p>{card.coverage_note} Cohort rank is hidden.</p> : null}
          <p>
            {card.performance.label}: {card.performance.percentage ?? "—"}%. Coverage {card.performance.scored}/{card.performance.expected}. Missing {card.performance.missing}. Absent {card.performance.absent}.
          </p>
          {card.retests.map((item) => (
            <p key={item.title}>{item.title}: {item.original_percentage}% then {item.latest_percentage}% ({item.change} points).</p>
          ))}
          <div className="table-wrap">
            <table>
              <caption>Published results for {card.display_name}. Bands are named, not shown by color alone.</caption>
              <thead>
                <tr><th>Assessment</th><th>Date</th><th>Attempt</th><th>Score</th><th>%</th><th>Band</th><th>Rank</th></tr>
              </thead>
              <tbody>
                {card.results.map((result) => (
                  <tr key={result.id}>
                    <td>{result.title}</td>
                    <td>{result.exam_date || "—"}</td>
                    <td>{result.attempt}</td>
                    <td>{result.score ?? "—"}/{result.maximum ?? "—"}</td>
                    <td>{result.percentage ?? "—"}</td>
                    <td>{result.band || result.status}</td>
                    <td>{result.rank ?? "—"}{result.batch_rank ? ` · batch ${result.batch_rank}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ) : null}
    </section>
  );
}
