import { ReactNode, useEffect, useRef } from "react";

export function StudentDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = panelRef.current;
    const fields = node ? [...node.querySelectorAll<HTMLElement>("button, input, select")].filter((item) => !item.hasAttribute("disabled")) : [];
    (fields.find((item) => item.matches("input:not([type=file])")) || fields[0] || node)?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]")].filter(
        (item) => !item.hasAttribute("disabled"),
      );
      if (!items.length) return;
      const active = document.activeElement;
      const inside = active instanceof Node && node.contains(active);
      const first = items[0];
      const last = items[items.length - 1];
      if (!inside || (event.shiftKey && active === first) || (!event.shiftKey && active === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal compact" role="dialog" aria-modal="true" aria-label={title} ref={panelRef} tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head"><h2>{title}</h2><button type="button" className="quiet" onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  );
}

export function Icon({ name }: { name: "view" | "edit" | "card" | "filter" | "clear" | "sort" | "add" }) {
  const common = { viewBox: "0 0 24 24", width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "view") {
    return (
      <svg {...common}>
        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
        <circle cx="12" cy="12" r="2.5" />
      </svg>
    );
  }
  if (name === "edit") {
    return (
      <svg {...common}>
        <path d="M4 20h4l10-10-4-4L4 16v4z" />
        <path d="M13 7l4 4" />
      </svg>
    );
  }
  if (name === "filter") {
    return (
      <svg {...common}>
        <path d="M4 5h16l-6 7v6l-4 2v-8L4 5z" />
      </svg>
    );
  }
  if (name === "clear") {
    return (
      <svg {...common}>
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    );
  }
  if (name === "sort") {
    return (
      <svg {...common}>
        <path d="M8 7V19M8 19l-3-3M8 19l3-3M16 17V5M16 5l-3 3M16 5l3 3" />
      </svg>
    );
  }
  if (name === "add") {
    return (
      <svg {...common}>
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}
