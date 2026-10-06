// The look as an outfit board when there's no AI photo yet: the pieces' studio photos (or cleaned-up
// photos) laid out top to bottom on a backdrop that matches where the user is going.
import { useState } from "react";
import { Tilt } from "./Closet";
import type { Look } from "./lib/api";

type Item = Look["items"][number];

function backdrop(occasion = "", location = "", timeOfDay = "") {
  const t = `${occasion} ${location}`.toLowerCase();
  if (/party|club|concert/.test(t) || /night/i.test(timeOfDay)) return "linear-gradient(160deg,#2f2a3d,#18151f)";
  if (/beach|sea|goa|vacation|holiday|trip/.test(t)) return "linear-gradient(170deg,#e4f1f4,#f3ead9)";
  if (/wedding|festive|puja|diwali|sangeet|haldi/.test(t)) return "linear-gradient(170deg,#f8ecd9,#edd5b0)";
  if (/date|dinner|restaurant|cafe|brunch/.test(t)) return "linear-gradient(170deg,#efe3d6,#d9c3ad)";
  if (/office|work|meeting|interview|formal/.test(t)) return "linear-gradient(170deg,#eef2f3,#d3dbde)";
  return "linear-gradient(170deg,#f1efe9,#dfdad0)";
}

const ORDER = ["Outerwear", "Tops", "Dresses", "Bottoms", "Shoes", "Accessories"];

function Tile({ item, className }: { item: Item; className: string }) {
  // a studio photo that won't load falls back to the item's own photo
  const [broken, setBroken] = useState(false);
  const studio = !!item.studioUrl && !broken;
  const src = studio ? item.studioUrl! : item.imageUrl;
  const contain = !studio && item.photo === "cutout";
  return <figure className={`relative ${className}`}>
    <Tilt fill className="h-full overflow-hidden rounded-[22px] bg-[radial-gradient(130%_100%_at_50%_10%,#f3f6f7_0%,#e2e8ea_55%,#cfd8db_100%)] shadow-[0_2px_4px_rgba(0,0,0,0.08),0_22px_40px_-10px_rgba(0,0,0,0.35)] ring-1 ring-white/60">
      <img src={src} alt={item.name} onError={() => studio && setBroken(true)} className={`h-full w-full ${contain ? "object-contain p-4 drop-shadow-[8px_16px_14px_rgba(30,40,45,0.3)]" : "object-cover"}`} />
      <figcaption className="absolute inset-x-2 bottom-2 z-[4] truncate rounded-full bg-white/85 px-3 py-1 text-center text-[10px] font-semibold backdrop-blur">{item.name}</figcaption>
    </Tilt>
  </figure>;
}

export default function ModelView({ look, timeOfDay }: { look: Look; timeOfDay?: string }) {
  const items = [...look.items].sort((a, b) => ORDER.indexOf(a.category ?? "") - ORDER.indexOf(b.category ?? ""));
  const main = items.filter((i) => !["Shoes", "Accessories"].includes(i.category ?? ""));
  const small = items.filter((i) => !main.includes(i));
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: backdrop(look.occasion, look.location ?? "", timeOfDay) }}>
      <div className="absolute inset-x-6 bottom-36 top-20 flex items-stretch justify-center gap-4 sm:inset-x-10 sm:gap-6">
        <div className="flex w-full max-w-[340px] flex-col gap-4">
          {main.map((item) => <Tile key={item.wardrobeItemId} item={item} className="min-h-0 flex-1" />)}
        </div>
        {small.length > 0 && <div className="flex w-[34%] max-w-[180px] flex-col justify-end gap-4">
          {small.map((item) => <Tile key={item.wardrobeItemId} item={item} className="aspect-square" />)}
        </div>}
      </div>
    </div>
  );
}
