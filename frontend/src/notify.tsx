import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

type Tone = "success" | "error" | "warning" | "information";

type NoticeAction = { label: string; to: string };

type Notice = {
  id: number;
  text: string;
  tone: Tone;
  persist: boolean;
  remaining: number;
  deadline: number | null;
  action?: NoticeAction;
};

type Snapshot = { visible: Notice[]; waiting: number };

const MAX_VISIBLE = 4;
const TIMEOUT = 6000;
const TONE_LABEL: Record<Tone, string> = {
  success: "Success",
  error: "Error",
  warning: "Warning",
  information: "Information",
};

let visible: Notice[] = [];
let queued: Notice[] = [];
let nextId = 1;
const timers = new Map<number, number>();
const listeners = new Set<(items: Snapshot) => void>();

function snapshot(): Snapshot {
  return { visible: visible.map((item) => ({ ...item })), waiting: queued.length };
}

function publish() {
  const next = snapshot();
  listeners.forEach((listener) => listener(next));
}

function clearTimer(id: number) {
  const timer = timers.get(id);
  if (timer === undefined) return;
  window.clearTimeout(timer);
  timers.delete(id);
}

function arm(item: Notice) {
  clearTimer(item.id);
  if (item.persist) return;
  item.deadline = Date.now() + item.remaining;
  const timer = window.setTimeout(() => {
    timers.delete(item.id);
    const current = visible.find((entry) => entry.id === item.id);
    if (!current || current.deadline === null) return;
    dismissNotice(item.id);
  }, item.remaining);
  timers.set(item.id, timer);
}

function fill() {
  while (visible.length < MAX_VISIBLE && queued.length > 0) {
    const next = queued.shift();
    if (!next) break;
    visible.push(next);
    arm(next);
  }
}

export function dismissNotice(id: number) {
  clearTimer(id);
  visible = visible.filter((item) => item.id !== id);
  queued = queued.filter((item) => item.id !== id);
  fill();
  publish();
}

export function pauseNotice(id: number) {
  const item = visible.find((entry) => entry.id === id);
  if (!item || item.persist || item.deadline === null) return;
  item.remaining = Math.max(800, item.deadline - Date.now());
  item.deadline = null;
  clearTimer(id);
}

export function resumeNotice(id: number) {
  const item = visible.find((entry) => entry.id === id);
  if (!item || item.persist || item.deadline !== null) return;
  arm(item);
}

export function notify(text: string, tone: Tone = "success", action?: NoticeAction) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const item: Notice = {
    id: nextId,
    text: trimmed,
    tone,
    persist: tone === "error",
    remaining: TIMEOUT,
    deadline: null,
    action,
  };
  nextId += 1;
  if (visible.length >= MAX_VISIBLE && !item.persist) queued.push(item);
  else {
    visible.push(item);
    arm(item);
  }
  publish();
}

export function NoticePopup() {
  const [items, setItems] = useState<Snapshot>({ visible: [], waiting: 0 });

  useEffect(() => {
    listeners.add(setItems);
    setItems(snapshot());
    return () => {
      listeners.delete(setItems);
    };
  }, []);

  if (items.visible.length === 0) return null;

  return (
    <div className="notice-popup-stack">
      {items.visible.map((item) => (
        <div
          key={item.id}
          className={`notice-popup tone-${item.tone}`}
          role={item.tone === "error" ? "alert" : "status"}
          onMouseEnter={() => pauseNotice(item.id)}
          onMouseLeave={() => resumeNotice(item.id)}
          onFocus={() => pauseNotice(item.id)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) resumeNotice(item.id);
          }}
        >
          <div>
            <p className="notice-kicker">{TONE_LABEL[item.tone]}</p>
            <p>{item.text}</p>
            {item.action ? <p><Link to={item.action.to} onClick={() => dismissNotice(item.id)}>{item.action.label}</Link></p> : null}
          </div>
          <button type="button" className="quiet" onClick={() => dismissNotice(item.id)}>Dismiss {TONE_LABEL[item.tone].toLowerCase()}</button>
        </div>
      ))}
      {items.waiting > 0 ? <p className="notice-waiting">{items.waiting} more waiting</p> : null}
    </div>
  );
}
