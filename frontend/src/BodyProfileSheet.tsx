// Profile > Body & fit profile: the shape of the model in your looks' AI photos.
import { useState, type ReactNode } from "react";
import { api, type BodyProfile, type Me } from "./lib/api";

const BUILDS = ["Slim", "Athletic", "Average", "Curvy", "Plus size"];
const SKIN = [["Fair", "#f1d3bd"], ["Wheatish", "#ddb08a"], ["Medium", "#c48f66"], ["Dusky", "#9c6a45"], ["Deep", "#6e4a32"]] as const;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="mt-6"><div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#737a70]">{label}</div>{children}</div>;
}

const chip = (on: boolean) => `rounded-full px-4 py-2 text-xs font-semibold transition ${on ? "bg-[#20251f] text-white" : "border border-[#d9ddd5] bg-white hover:border-[#aeb5aa]"}`;

export default function BodyProfileSheet({ me, onSaved, onClose }: { me?: Me; onSaved: (me: Me) => void; onClose: () => void }) {
  const [body, setBody] = useState<BodyProfile>(me?.bodyProfile ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch: Partial<BodyProfile>) => setBody((b) => ({ ...b, ...patch }));
  const num = (v: string) => (v === "" ? undefined : Math.round(Number(v)));

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const save = () => run(async () => {
    const { faceUrl: _, ...rest } = body;
    if (rest.heightCm && (rest.heightCm < 120 || rest.heightCm > 220)) throw new Error("Height should be between 120 and 220 cm");
    if (rest.weightKg && (rest.weightKg < 30 || rest.weightKg > 250)) throw new Error("Weight should be between 30 and 250 kg");
    onSaved(await api.updateMe({ bodyProfile: rest }));
    onClose();
  });

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" aria-label="Body and fit profile" onClick={onClose}>
    <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-[32px] bg-[#f8f7f2] p-6 pb-10 sm:rounded-[32px] sm:p-8" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-start justify-between gap-4"><div><div className="font-serif text-3xl">Body & fit</div><p className="mt-1 text-xs leading-5 text-[#737a70]">Your looks are shown on a model with this shape, standing where you're going.</p></div><button onClick={onClose} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-lg">×</button></div>

      <Field label="Model"><div className="flex gap-2">{(["Woman", "Man"] as const).map((m) => <button key={m} onClick={() => set({ model: m })} aria-pressed={body.model === m} className={chip(body.model === m)}>{m}</button>)}</div></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Height (cm)"><input type="number" inputMode="numeric" min={120} max={220} value={body.heightCm ?? ""} onChange={(e) => set({ heightCm: num(e.target.value) })} placeholder="165" className="w-full rounded-2xl border border-[#d9ddd5] bg-white px-4 py-3 text-sm outline-none focus:border-[#20251f]" /></Field>
        <Field label="Weight (kg)"><input type="number" inputMode="numeric" min={30} max={250} value={body.weightKg ?? ""} onChange={(e) => set({ weightKg: num(e.target.value) })} placeholder="60" className="w-full rounded-2xl border border-[#d9ddd5] bg-white px-4 py-3 text-sm outline-none focus:border-[#20251f]" /></Field>
      </div>
      <Field label="Body type"><div className="flex flex-wrap gap-2">{BUILDS.map((b) => <button key={b} onClick={() => set({ build: b })} aria-pressed={body.build === b} className={chip(body.build === b)}>{b}</button>)}</div></Field>
      <Field label="Skin tone"><div className="flex flex-wrap gap-2">{SKIN.map(([name, color]) => <button key={name} onClick={() => set({ skinTone: name })} aria-pressed={body.skinTone === name} className={`${chip(body.skinTone === name)} flex items-center gap-2`}><span className="h-4 w-4 rounded-full ring-1 ring-black/10" style={{ background: color }} />{name}</button>)}</div></Field>

      {error && <div className="mt-5 rounded-2xl bg-[#fde8e2] px-4 py-3 text-xs text-[#9a3412]">{error}</div>}
      <button onClick={save} className={`mt-7 w-full rounded-full bg-[#20251f] px-5 py-4 text-sm font-semibold text-white ${busy ? "pointer-events-none opacity-50" : ""}`}>{busy ? "Saving..." : "Save"}</button>
    </div>
  </div>;
}
