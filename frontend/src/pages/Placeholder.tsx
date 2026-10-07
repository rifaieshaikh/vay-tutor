export function PlaceholderPage({ title, body }: { title: string; body: string }) {
  return (
    <section className="panel">
      <h1>{title}</h1>
      <p>{body}</p>
    </section>
  );
}
