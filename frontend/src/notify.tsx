import { useEffect, useState } from "react";

type Notice = { id: number; text: string };

let notices: Notice[] = [];
let nextId = 1;
const listeners = new Set<(items: Notice[]) => void>();

function publish(items: Notice[]) {
  notices = items;
  listeners.forEach((listener) => listener(notices));
}

export function dismissNotice(id: number) {
  publish(notices.filter((item) => item.id !== id));
}

export function notify(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const id = nextId;
  nextId += 1;
  publish([...notices, { id, text: trimmed }]);
  window.setTimeout(() => dismissNotice(id), 6000);
}

export function NoticePopup() {
  const [items, setItems] = useState(notices);

  useEffect(() => {
    listeners.add(setItems);
    setItems(notices);
    return () => {
      listeners.delete(setItems);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="notice-popup-stack" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className="notice-popup" role="status">
          <p>{item.text}</p>
          <button type="button" className="quiet" onClick={() => dismissNotice(item.id)}>Close</button>
        </div>
      ))}
    </div>
  );
}
