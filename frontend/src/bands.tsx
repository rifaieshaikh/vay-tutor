import { CSSProperties } from "react";
import { Icon } from "./ui";

export type Band = { key?: string; name: string; through?: number | null; phrase?: string; color?: string | null };
export type BandDraft = { name: string; through: string; color: string };

const LEGACY: Record<string, string> = { danger: "Danger", "fifty-fifty": "Fifty-fifty", safe: "Safe" };
const PALETTE = ["#d6453d", "#e07a2f", "#e6b325", "#8fce6a", "#1b7f4a"];

export const DEFAULT_BANDS: Band[] = [
  { key: "emerging", name: "Emerging", through: 40, phrase: "Below 40%", color: "#d6453d" },
  { key: "progressing", name: "Progressing", through: 60, phrase: "40% through 60%", color: "#e07a2f" },
  { key: "developing", name: "Developing", through: 75, phrase: "Above 60% through 75%", color: "#e6b325" },
  { key: "proficient", name: "Proficient", through: 90, phrase: "Above 75% through 90%", color: "#8fce6a" },
  { key: "outstanding", name: "Outstanding", phrase: "Above 90%", color: "#1b7f4a" },
];

function draftColor(item: Band, index: number, total: number) {
  if (item.color && /^#[0-9a-fA-F]{6}$/.test(item.color)) return item.color;
  if (index === total - 1) return PALETTE[PALETTE.length - 1];
  return PALETTE[Math.min(index, PALETTE.length - 2)];
}

export function draftsFrom(bands: Band[] | null | undefined): BandDraft[] {
  const source = bands && bands.length >= 2 ? bands : DEFAULT_BANDS;
  return source.map((item, index) => ({
    name: item.name,
    through: index === source.length - 1 || item.through == null ? "" : String(item.through),
    color: draftColor(item, index, source.length),
  }));
}

export function bandsReady(rows: BandDraft[]) {
  if (rows.length < 2) return false;
  const names = new Set<string>();
  let previous = -1;
  for (let index = 0; index < rows.length; index += 1) {
    const name = rows[index].name.trim();
    if (!name || names.has(name.toLowerCase())) return false;
    names.add(name.toLowerCase());
    if (index === rows.length - 1) continue;
    const through = Number(rows[index].through);
    if (rows[index].through.trim() === "" || !Number.isFinite(through) || through < 0 || through > 100 || through <= previous) return false;
    previous = through;
  }
  return true;
}

export function bandsPayload(rows: BandDraft[]) {
  return rows.map((item, index) => (
    index === rows.length - 1
      ? { name: item.name.trim(), color: item.color }
      : { name: item.name.trim(), through: Number(item.through), color: item.color }
  ));
}

export function bandFor(value: number | null, bands?: Band[]) {
  const list = bands && bands.length >= 2 ? bands : DEFAULT_BANDS;
  if (value == null) return { band: null as string | null, name: null as string | null, place: null as string | null };
  const last = list[list.length - 1];
  let chosen = last;
  let place: "low" | "middle" | "high" = "high";
  if (value < Number(list[0].through)) {
    chosen = list[0];
    place = "low";
  } else {
    for (let index = 1; index < list.length - 1; index += 1) {
      if (value <= Number(list[index].through)) {
        chosen = list[index];
        place = "middle";
        break;
      }
    }
  }
  return { band: chosen.key || chosen.name, name: chosen.name, place };
}

export function bandTone(band: string | null | undefined, place?: string | null) {
  if (band === "danger" || band === "fifty-fifty" || band === "safe") return band;
  if (place === "low") return "danger";
  if (place === "high") return "safe";
  if (place === "middle" || band) return "fifty-fifty";
  return "";
}

export function bandText(band: string | null | undefined, name?: string | null) {
  if (name) return name;
  if (!band) return "";
  return LEGACY[band] || band;
}

export function bandClass(band: string | null | undefined, place?: string | null, color?: string | null) {
  return color ? "toned" : bandTone(band, place);
}

export function bandStyle(color?: string | null): CSSProperties | undefined {
  if (!color) return undefined;
  return { "--band-color": color } as CSSProperties;
}

export function BandMark({ band, name, place, color }: { band?: string | null; name?: string | null; place?: string | null; color?: string | null }) {
  const label = bandText(band, name);
  if (!label) return "—";
  return <span className={`chip ${bandClass(band, place, color)}`} style={bandStyle(color)}>{label}</span>;
}

export function BandFields({ rows, onChange }: { rows: BandDraft[]; onChange: (rows: BandDraft[]) => void }) {
  function edit(index: number, patch: Partial<BandDraft>) {
    onChange(rows.map((item, position) => position === index ? { ...item, ...patch } : item));
  }
  function add() {
    const next = rows.slice();
    const used = new Set(rows.map((item) => item.color.toLowerCase()));
    const color = PALETTE.find((item) => !used.has(item)) || "#0f6e6b";
    next.splice(Math.max(rows.length - 1, 0), 0, { name: "", through: "", color });
    onChange(next);
  }
  function remove(index: number) {
    onChange(rows.filter((_, position) => position !== index));
  }
  return (
    <div className="band-rows span-2">
      {rows.map((item, index) => {
        const last = index === rows.length - 1;
        return (
          <div className="band-row" key={index}>
            <label>{index === 0 ? "Lowest band" : last ? "Highest band" : "Band"}
              <input aria-label={last ? "Highest band name" : `Band ${index + 1} name`} value={item.name} onChange={(event) => edit(index, { name: event.target.value })} />
            </label>
            {last ? <p className="meta">Above the previous line</p> : (
              <label>Through
                <input type="number" min={0} max={100} step="0.01" aria-label={`Line for ${item.name || `band ${index + 1}`}`} value={item.through} onChange={(event) => edit(index, { through: event.target.value })} />
              </label>
            )}
            <label>Color
              <input type="color" aria-label={`Color for ${item.name || `band ${index + 1}`}`} value={item.color} onChange={(event) => edit(index, { color: event.target.value })} />
            </label>
            {rows.length > 2 && !last ? (
              <div className="icon-actions">
                <button type="button" aria-label={`Remove ${item.name || "band"}`} title="Remove" onClick={() => remove(index)}><Icon name="clear" /></button>
              </div>
            ) : <span />}
          </div>
        );
      })}
      <button type="button" onClick={add}>Add band</button>
    </div>
  );
}
