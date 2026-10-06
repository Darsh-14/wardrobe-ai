// The Wardrobe screen's closet: each piece as a catalogue-style studio photo (ghost mannequin,
// trouser hanger, dress form, plinth), falling back to the cleaned-up photo on a hanger.
// It also gives older photos a clean background, one at a time, in the browser.
import { useEffect, useRef, useState } from "react";
import { api } from "./lib/api";
import { makeCutout, warmUpCutouts } from "./lib/cutout";
import type { Category, WardrobeItem } from "./types";

export const RACK_ORDER: Category[] = ["Outerwear", "Tops", "Dresses", "Bottoms", "Shoes", "Accessories"];
const RACK_NAMES: Record<Category, string> = {
  Outerwear: "Outerwear",
  Tops: "Tops",
  Dresses: "Dresses",
  Bottoms: "Bottoms",
  Shoes: "Shoes",
  Accessories: "Accessories",
};
type Kind = "hang" | "clip" | "shelf";
const kindOf = (c: Category): Kind => (c === "Bottoms" ? "clip" : c === "Shoes" || c === "Accessories" ? "shelf" : "hang");

function Hanger({ kind }: { kind: Kind }) {
  // a shoulder hanger, or a trouser hanger with a bar, drawn above a cleaned-up photo
  return <svg viewBox="0 0 120 44" className="absolute left-1/2 top-2 z-[1] h-9 w-[58%] -translate-x-1/2" aria-hidden="true">
    <path d="M60 22 V14 a7 7 0 1 1 7 -7" fill="none" stroke="#6c655b" strokeWidth="2.6" strokeLinecap="round" />
    {kind === "hang"
      ? <path d="M60 22 L10 40 H110 Z" fill="none" stroke="#7b7368" strokeWidth="3" strokeLinejoin="round" />
      : <><path d="M60 22 L18 38 H102 Z" fill="none" stroke="#7b7368" strokeWidth="2.6" strokeLinejoin="round" /><rect x="16" y="36" width="88" height="6" rx="3" fill="#8b6f52" /></>}
  </svg>;
}

// soft blue-grey studio backdrop, like a catalogue shot
const STUDIO_BG = "bg-[radial-gradient(130%_100%_at_50%_10%,#f3f6f7_0%,#e2e8ea_55%,#cfd8db_100%)]";

function Piece({ item, kind, onFavorite, cleaning }: { item: WardrobeItem; kind: Kind; onFavorite: (id: string, f: boolean) => void; cleaning: boolean }) {
  const { id, name, category, color, season, imageUrl, studioUrl, wornOften, favorite, photo } = item;
  // the studio photo by default; a tap on "My photo" shows the user's own picture
  const [own, setOwn] = useState(false);
  const showStudio = !!studioUrl && !own;
  return <div className="group w-[158px] shrink-0 sm:w-[212px]">
    <div className={`relative aspect-[4/5] overflow-hidden rounded-[22px] ${STUDIO_BG} shadow-[0_10px_30px_rgba(30,40,45,0.10)]`}>
      {showStudio
        ? <img src={studioUrl!} alt={name} loading="lazy" className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.04]" />
        : photo === "cutout"
          ? <>{kind !== "shelf" && <Hanger kind={kind} />}<img src={imageUrl} alt={name} loading="lazy" className={`absolute inset-x-5 ${kind === "shelf" ? "bottom-8 top-8 object-bottom" : "bottom-5 top-10 object-top"} h-auto max-h-full w-[calc(100%-2.5rem)] object-contain drop-shadow-[0_16px_16px_rgba(30,40,45,0.25)] transition duration-700 group-hover:scale-[1.03]`} style={{ height: kind === "shelf" ? "calc(100% - 4rem)" : "calc(100% - 3.75rem)" }} />{kind === "shelf" && <span className="absolute bottom-6 left-1/2 h-3 w-2/3 -translate-x-1/2 rounded-[50%] bg-black/15 blur-sm" />}</>
          : <img src={imageUrl} alt={name} loading="lazy" className="h-full w-full object-cover" />}
      <span role="button" tabIndex={0} aria-label={favorite ? `Remove ${name} from favorites` : `Add ${name} to favorites`} aria-pressed={!!favorite} onClick={(e) => { e.stopPropagation(); onFavorite(id, !favorite); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onFavorite(id, !favorite); } }} className={`absolute right-2.5 top-2.5 z-[2] grid h-9 w-9 place-items-center rounded-full bg-white/90 shadow-sm backdrop-blur ${favorite ? "text-[#c2410c] [&_path]:fill-current" : ""}`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" /></svg>
      </span>
      <div className="absolute inset-x-2.5 bottom-2.5 z-[2] flex items-center gap-1.5">
        {wornOften && <span className="rounded-full bg-[#d8ff60] px-3 py-1.5 text-[10px] font-bold">Worn often</span>}
        {studioUrl && <button onClick={() => setOwn(!own)} className="rounded-full bg-white/85 px-3 py-1.5 text-[10px] font-semibold opacity-100 backdrop-blur transition sm:opacity-0 sm:group-hover:opacity-100">{own ? "Studio photo" : "My photo"}</button>}
        {cleaning && <span className="rounded-full bg-white/90 px-3 py-1.5 text-[10px] font-semibold">Cleaning background...</span>}
      </div>
    </div>
    <div className="px-1 pt-3"><div className="truncate text-sm font-semibold">{name}</div><div className="mt-1 truncate text-xs text-[#737a70]">{`${category} · ${color} · ${season}`}</div></div>
  </div>;
}

export function Rack({ category, items, wrap, onFavorite, cleaning }: { category: Category; items: WardrobeItem[]; wrap: boolean; onFavorite: (id: string, f: boolean) => void; cleaning: Set<string> }) {
  const kind = kindOf(category);
  return <section>
    <div className="mb-4 flex items-baseline justify-between"><div className="font-serif text-2xl sm:text-3xl">{RACK_NAMES[category]}</div><div className="text-xs text-[#737a70]">{`${items.length} ${items.length === 1 ? "piece" : "pieces"}`}</div></div>
    <div className={`no-scrollbar flex gap-4 sm:gap-5 ${wrap ? "flex-wrap" : "-mx-5 overflow-x-auto px-5 pb-2 lg:mx-0 lg:px-0"}`}>
      {items.map((item) => <Piece key={item.id} item={item} kind={kind} onFavorite={onFavorite} cleaning={cleaning.has(item.id)} />)}
    </div>
  </section>;
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
