// The Wardrobe screen's closet: pieces hang on rails (tops, outerwear, dresses), clip onto a
// trouser bar (bottoms) or stand on a shelf (shoes, accessories), on a clean studio backdrop.
// It also gives older photos a clean background, one at a time, in the browser.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "./lib/api";
import { makeCutout, warmUpCutouts } from "./lib/cutout";
import type { Category, WardrobeItem } from "./types";

export const RACK_ORDER: Category[] = ["Outerwear", "Tops", "Dresses", "Bottoms", "Shoes", "Accessories"];
const RACK_NAMES: Record<Category, string> = {
  Outerwear: "Outerwear rail",
  Tops: "Tops rail",
  Dresses: "Dresses rail",
  Bottoms: "Trouser bar",
  Shoes: "Shoe shelf",
  Accessories: "Accessories shelf",
};
type Kind = "hang" | "clip" | "shelf";
const kindOf = (c: Category): Kind => (c === "Bottoms" ? "clip" : c === "Shoes" || c === "Accessories" ? "shelf" : "hang");

function Hanger({ kind }: { kind: Kind }) {
  // hook over the rail, then a shoulder hanger or a trouser clip bar
  return <svg viewBox="0 0 120 44" className="mx-auto -mt-[14px] block h-11 w-[70%]" aria-hidden="true">
    <path d="M60 22 V14 a7 7 0 1 1 7 -7" fill="none" stroke="#6c655b" strokeWidth="2.6" strokeLinecap="round" />
    {kind === "hang"
      ? <path d="M60 22 L10 40 H110 Z" fill="none" stroke="#7b7368" strokeWidth="3" strokeLinejoin="round" />
      : <><path d="M60 22 L22 36 M60 22 L98 36" stroke="#7b7368" strokeWidth="2.6" strokeLinecap="round" /><rect x="14" y="34" width="92" height="6" rx="3" fill="#8b8276" /><rect x="22" y="38" width="10" height="6" rx="1.5" fill="#5f594f" /><rect x="88" y="38" width="10" height="6" rx="1.5" fill="#5f594f" /></>}
  </svg>;
}

function Piece({ item, kind, onFavorite, onRemoveBackground }: { item: WardrobeItem; kind: Kind; onFavorite: (id: string, f: boolean) => void; onRemoveBackground?: ReactNode }) {
  const { id, name, category, color, season, imageUrl, wornOften, favorite, photo } = item;
  const clean = photo === "cutout";
  return <div className={`group relative w-[148px] shrink-0 sm:w-[188px] ${kind === "shelf" ? "" : "origin-top transition-transform duration-500 hover:rotate-[1.5deg]"}`}>
    {kind !== "shelf" && <Hanger kind={kind} />}
    <div className={`relative ${kind === "shelf" ? "aspect-square" : "aspect-[3/4]"} ${kind === "clip" ? "-mt-1" : ""}`}>
      {clean
        ? <img src={imageUrl} alt={name} loading="lazy" className={`absolute inset-0 h-full w-full object-contain ${kind === "shelf" ? "object-bottom" : "object-top"} drop-shadow-[0_14px_14px_rgba(40,35,25,0.22)] transition duration-500 group-hover:scale-[1.03]`} />
        : <div className="absolute inset-x-2 top-0 bottom-2 overflow-hidden rounded-[18px] bg-white shadow-[0_12px_24px_rgba(40,35,25,0.14)] ring-4 ring-white"><img src={imageUrl} alt={name} loading="lazy" className="h-full w-full object-cover" />{onRemoveBackground}</div>}
      <span role="button" tabIndex={0} aria-label={favorite ? `Remove ${name} from favorites` : `Add ${name} to favorites`} aria-pressed={!!favorite} onClick={(e) => { e.stopPropagation(); onFavorite(id, !favorite); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onFavorite(id, !favorite); } }} className={`absolute right-1 top-1 grid h-9 w-9 place-items-center rounded-full bg-white/90 shadow-sm backdrop-blur ${favorite ? "text-[#c2410c] [&_path]:fill-current" : ""}`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" /></svg>
      </span>
      {wornOften && <span className="absolute bottom-3 left-2 rounded-full bg-[#d8ff60] px-3 py-1.5 text-[10px] font-bold">Worn often</span>}
    </div>
    <div className={`px-1 ${kind === "shelf" ? "pt-6" : "pt-3"}`}><div className="truncate text-sm font-semibold">{name}</div><div className="mt-1 truncate text-xs text-[#737a70]">{`${category} · ${color} · ${season}`}</div></div>
  </div>;
}

export function Rack({ category, items, wrap, onFavorite, cleaning }: { category: Category; items: WardrobeItem[]; wrap: boolean; onFavorite: (id: string, f: boolean) => void; cleaning: Set<string> }) {
  const kind = kindOf(category);
  const rows = wrap ? chunk(items, 4) : [items];
  return <section className="overflow-hidden rounded-[32px] bg-[radial-gradient(120%_90%_at_50%_0%,#fbfaf7_0%,#efece5_55%,#e5e0d6_100%)] px-4 pb-6 pt-6 shadow-[inset_0_-30px_60px_rgba(120,105,80,0.06)] sm:px-8">
    <div className="mb-5 flex items-baseline justify-between"><div className="font-serif text-2xl sm:text-3xl">{RACK_NAMES[category]}</div><div className="text-xs text-[#737a70]">{`${items.length} ${items.length === 1 ? "piece" : "pieces"}`}</div></div>
    {rows.map((row, r) => <div key={r} className={`relative ${r ? "mt-8" : ""}`}>
      {kind === "shelf"
        ? <div className="absolute inset-x-0 bottom-[52px] h-3 rounded-full bg-gradient-to-b from-[#cbb595] to-[#a3896a] shadow-[0_8px_12px_rgba(90,70,40,0.25)]" aria-hidden="true" />
        : <div className="absolute inset-x-0 top-0 h-2.5 rounded-full bg-gradient-to-b from-[#d6d0c6] via-[#a39b8f] to-[#7e776c] shadow-[0_3px_6px_rgba(0,0,0,0.18)]" aria-hidden="true"><span className="absolute -left-1 -top-1 h-4.5 w-4.5 rounded-full bg-[#8a8276]" /><span className="absolute -right-1 -top-1 h-4.5 w-4.5 rounded-full bg-[#8a8276]" /></div>}
      <div className={`no-scrollbar relative flex gap-4 sm:gap-6 ${wrap ? "flex-wrap" : "overflow-x-auto"} ${kind === "shelf" ? "items-end px-2" : "px-3"} pb-1`}>
        {row.map((item) => <Piece key={item.id} item={item} kind={kind} onFavorite={onFavorite} onRemoveBackground={cleaning.has(item.id) ? <span className="absolute inset-x-2 bottom-2 rounded-full bg-white/90 px-2 py-1 text-center text-[10px] font-semibold">Cleaning background...</span> : undefined} />)}
      </div>
    </div>)}
  </section>;
}

function chunk<T>(list: T[], n: number) {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/**
 * Gives items photographed before background removal existed a clean background, one at a time.
 * Items whose cutout fails the quality check keep their original photo and aren't tried again.
 */
export function useBackgroundCleanup(items: WardrobeItem[], update: (item: WardrobeItem) => void) {
  const tried = useRef(new Set<string>());
  const latest = useRef({ items, update });
  latest.current = { items, update };
  const running = useRef(false);
  const mounted = useRef(true);
  const [cleaning, setCleaning] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const waiting = items.filter((i) => i.photo == null && !tried.current.has(i.id)).length;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    // one pass at a time; it picks up items that arrive while it runs (e.g. another category)
    if (!waiting || running.current) return;
    running.current = true;
    warmUpCutouts();
    (async () => {
      let done = 0;
      for (;;) {
        const queue = latest.current.items.filter((i) => i.photo == null && !tried.current.has(i.id));
        const item = queue[0];
        if (!item || !mounted.current) break;
        setProgress({ done, total: done + queue.length });
        setCleaning(item.id);
        try {
          const { photo, box } = await api.itemOriginal(item.id);
          const png = await makeCutout(photo, box);
          const updated = await api.setItemCutout(item.id, png);
          tried.current.add(item.id);
          if (mounted.current) latest.current.update(updated);
          done++;
        } catch (err) {
          // the model couldn't load (offline, blocked) or the server failed: stop, try again next visit
          console.warn("Background cleanup stopped:", err);
          break;
        }
      }
      running.current = false;
      if (mounted.current) { setCleaning(null); setProgress(null); }
    })();
  }, [waiting]);

  return { cleaning: new Set(cleaning ? [cleaning] : []), progress };
}
