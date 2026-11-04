import { CSSProperties } from "react";
import { Icon } from "./ui";

export type Band = { key?: string; name: string; through?: number | null; phrase?: string; description?: string | null; color?: string | null; needs_attention?: boolean };
export type BandDraft = { name: string; through: string; color: string; needsAttention: boolean };

const LEGACY: Record<string, string> = { danger: "Danger", "fifty-fifty": "Fifty-fifty", safe: "Safe" };
const PALETTE = ["#d6453d", "#e07a2f", "#e6b325", "#8fce6a", "#1b7f4a"];
const ATTENTION_DEFAULTS = new Set(["emerging", "progressing", "danger", "fifty-fifty"]);

export const BAND_DESCRIPTIONS: Record<string, string> = {
  emerging: "Beginning to understand new concepts and needing regular one to one guidance",
  progressing: "Building understanding and completing tasks with some support and doubt clearing",
  developing: "Applying learning more independently and improving through practice of more questions",
  proficient: "Demonstrating strong understanding and practice more advanced questions including previous exam questions independently and consistently",
  outstanding: "Applying learning to unfamiliar challenges, explain reasoning, and explore deeper ideas.",
};

export const DEFAULT_BANDS: Band[] = [
  { key: "emerging", name: "Emerging", through: 40, phrase: "Below 40%", description: BAND_DESCRIPTIONS.emerging, color: "#d6453d", needs_attention: true },
  { key: "progressing", name: "Progressing", through: 60, phrase: "40% through 60%", description: BAND_DESCRIPTIONS.progressing, color: "#e07a2f", needs_attention: true },
  { key: "developing", name: "Developing", through: 75, phrase: "Above 60% through 75%", description: BAND_DESCRIPTIONS.developing, color: "#e6b325", needs_attention: false },
  { key: "proficient", name: "Proficient", through: 90, phrase: "Above 75% through 90%", description: BAND_DESCRIPTIONS.proficient, color: "#8fce6a", needs_attention: false },
  { key: "outstanding", name: "Outstanding", phrase: "Above 90%", description: BAND_DESCRIPTIONS.outstanding, color: "#1b7f4a", needs_attention: false },
];

export function bandDescription(band: Band | null | undefined) {
  if (!band) return "";
  if (band.description) return band.description;
  const key = (band.key || band.name || "").trim().toLowerCase().replace(/\s+/g, "-");
  return BAND_DESCRIPTIONS[key] || BAND_DESCRIPTIONS[(band.name || "").trim().toLowerCase()] || "";
}

function defaultNeedsAttention(item: Band) {
  if (item.needs_attention != null) return Boolean(item.needs_attention);
  const key = (item.key || item.name || "").trim().toLowerCase();
  return ATTENTION_DEFAULTS.has(key);
}

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
    needsAttention: defaultNeedsAttention(item),
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
      ? { name: item.name.trim(), color: item.color, needs_attention: item.needsAttention }
      : { name: item.name.trim(), through: Number(item.through), color: item.color, needs_attention: item.needsAttention }
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

function bandInk(color: string) {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return "#1c2430";
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  const light = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return light > 0.55 ? "#1c2430" : "#ffffff";
}

export function bandStyle(color?: string | null): CSSProperties | undefined {
  if (!color) return undefined;
  return { "--band-color": color, "--band-ink": bandInk(color) } as CSSProperties;
}

export function BandMark({ band, name, place, color }: { band?: string | null; name?: string | null; place?: string | null; color?: string | null }) {
  const label = bandText(band, name);
  if (!label) return "—";
  return <span className={`chip ${bandClass(band, place, color)}`} style={bandStyle(color)}>{label}</span>;
}

export function BandKey({ bands }: { bands?: Band[] | null }) {
  // Descriptions stay on the PDF progress card only — UI shows chips alone.
  const rows = bands && bands.length ? bands : DEFAULT_BANDS;
  if (rows.length === 0) return null;
  return (
    <section className="band-key" aria-label="Band key">
      <h2>Band key</h2>
      <ul>
        {rows.map((item) => (
          <li key={item.key || item.name}>
            <BandMark band={item.key || item.name} name={item.name} color={item.color} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function BandFields({ rows, onChange }: { rows: BandDraft[]; onChange: (rows: BandDraft[]) => void }) {
  function edit(index: number, patch: Partial<BandDraft>) {
    onChange(rows.map((item, position) => position === index ? { ...item, ...patch } : item));
  }
  function add() {
    const next = rows.slice();
    const used = new Set(rows.map((item) => item.color.toLowerCase()));
    const color = PALETTE.find((item) => !used.has(item)) || "#0f6e6b";
    next.splice(Math.max(rows.length - 1, 0), 0, { name: "", through: "", color, needsAttention: false });
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
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={item.needsAttention}
                aria-label={`Needs attention for ${item.name || `band ${index + 1}`}`}
                onChange={(event) => edit(index, { needsAttention: event.target.checked })}
              />
              Needs attention
            </label>
            {rows.length > 2 && !last ? (
              <div className="icon-actions">
                <button type="button" aria-label={`Remove ${item.name || "band"}`} title="Remove" onClick={() => remove(index)}><Icon name="clear" /></button>
              </div>
            ) : <span />}
          </div>
        );
      })}
      <p className="meta">Bands marked Needs attention appear on the progress-card Needs attention tab.</p>
      <button type="button" onClick={add}>Add band</button>
    </div>
  );
}
