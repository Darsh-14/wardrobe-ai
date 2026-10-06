// "See it on you" without any image service: a model shaped from the Body & fit profile, wearing the
// look's own cutouts, standing in a scene that matches where the user is going.
import type { CSSProperties } from "react";
import type { BodyProfile, Look } from "./lib/api";

type Item = Look["items"][number];
type Scene = { sky: string; floor: string; night?: boolean; decor: "windows" | "bokeh" | "sea" | "garland" | "city" | "trees" };

function sceneFor(occasion = "", location = "", timeOfDay = ""): Scene {
  const t = `${occasion} ${location}`.toLowerCase();
  const night = /night|evening/i.test(timeOfDay);
  if (/beach|sea|goa|vacation|holiday|trip/.test(t)) return { sky: "linear-gradient(#bfe3f2,#e6f3f6 55%)", floor: "#ead7b2", decor: "sea", night };
  if (/party|club|concert/.test(t)) return { sky: "linear-gradient(#2c2442,#15111f)", floor: "#1d1828", decor: "bokeh", night: true };
  if (/date|dinner|restaurant|cafe|brunch/.test(t)) return { sky: "linear-gradient(#5a3d2c,#2b1d15)", floor: "#3a281d", decor: "bokeh", night };
  if (/wedding|festive|puja|diwali|sangeet|haldi/.test(t)) return { sky: "linear-gradient(#f7e6cc,#efd2a8)", floor: "#d9b98c", decor: "garland", night };
  if (/office|work|meeting|interview|formal/.test(t)) return { sky: "linear-gradient(#e3eaee,#cdd7dc)", floor: "#b9c2c6", decor: "windows", night };
  if (/park|picnic|garden|college|campus|gym|run/.test(t)) return { sky: "linear-gradient(#d7ead2,#eef4e8)", floor: "#b9cc9f", decor: "trees", night };
  return { sky: "linear-gradient(#ece7dd,#dcd5c8)", floor: "#cbc2b3", decor: "city", night };
}

const SKIN: Record<string, string> = { Fair: "#f1d3bd", Wheatish: "#ddb08a", Medium: "#c48f66", Dusky: "#9c6a45", Deep: "#6e4a32" };

function Decor({ kind }: { kind: Scene["decor"] }) {
  if (kind === "windows")
    return <svg className="absolute inset-x-0 top-0 h-[70%] w-full opacity-60" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice">{[0, 1, 2, 3].map((i) => <rect key={i} x={20 + i * 95} y="30" width="80" height="230" fill="#f4f8fa" stroke="#b7c3c9" strokeWidth="3" />)}</svg>;
  if (kind === "bokeh")
    return <div className="absolute inset-0">{Array.from({ length: 14 }, (_, i) => <span key={i} className="absolute rounded-full blur-[6px]" style={{ left: `${(i * 37) % 100}%`, top: `${(i * 23) % 60}%`, width: 18 + ((i * 13) % 40), height: 18 + ((i * 13) % 40), background: ["#ffcf7a", "#ff8fb1", "#9fd3ff", "#d8ff60"][i % 4], opacity: 0.45 }} />)}</div>;
  if (kind === "sea")
    return <><div className="absolute left-[70%] top-[10%] h-16 w-16 rounded-full bg-[#fff3c4] blur-[1px]" /><div className="absolute inset-x-0 top-[48%] h-[16%] bg-gradient-to-b from-[#7fc3dc] to-[#a9d9e6]" /></>;
  if (kind === "garland")
    return <svg className="absolute inset-x-0 top-0 h-[30%] w-full" viewBox="0 0 400 100" preserveAspectRatio="none">{[0, 1, 2].map((r) => <path key={r} d={`M0 ${10 + r * 18} Q200 ${60 + r * 18} 400 ${10 + r * 18}`} fill="none" stroke="#f59e0b" strokeWidth="6" strokeDasharray="2 8" strokeLinecap="round" />)}</svg>;
  if (kind === "trees")
    return <div className="absolute inset-x-0 top-[22%] flex justify-around opacity-70">{[0, 1, 2, 3].map((i) => <span key={i} className="h-40 w-28 rounded-full bg-[#8fb07a]" style={{ transform: `translateY(${(i % 2) * 20}px)` }} />)}</div>;
  return <svg className="absolute inset-x-0 bottom-[22%] h-[45%] w-full opacity-50" viewBox="0 0 400 200" preserveAspectRatio="none"><path d="M0 200V90h40V50h50v70h30V30h60v90h30V70h50v40h40V60h50v140z" fill="#b8ae9e" /></svg>;
}

// Where each kind of piece sits on the figure, in % of the figure box (left/width relative to centre)
const SLOTS: Record<string, { top: number; height: number; width: number; z: number }> = {
  Dresses: { top: 16, height: 62, width: 70, z: 2 },
  Tops: { top: 16, height: 36, width: 74, z: 3 },
  Outerwear: { top: 15, height: 42, width: 82, z: 4 },
  Bottoms: { top: 45, height: 48, width: 50, z: 2 },
  Shoes: { top: 90, height: 10, width: 46, z: 3 },
};

export default function ModelView({ look, body, timeOfDay, className = "" }: { look: Look; body?: BodyProfile; timeOfDay?: string; className?: string }) {
  const scene = sceneFor(look.occasion, look.location ?? "", timeOfDay);
  const h = body?.heightCm ?? 165;
  const bmi = body?.weightKg ? body.weightKg / (h / 100) ** 2 : 22;
  const buildBoost = { Slim: -0.06, Athletic: 0.02, Average: 0, Curvy: 0.06, "Plus size": 0.14 }[body?.build ?? ""] ?? 0;
  const wide = Math.min(1.35, Math.max(0.82, 0.9 + (bmi - 21) * 0.025 + buildBoost));
  const tall = Math.min(1.04, Math.max(0.86, 0.9 + (h - 160) * 0.004));
  const woman = body?.model !== "Man";
  const skin = SKIN[body?.skinTone ?? ""] ?? "#d8ad88";

  const worn = look.items.filter((i) => i.photo === "cutout" && SLOTS[i.category ?? ""]);
  const carried = look.items.filter((i) => !worn.includes(i));
  // figure geometry on a 200 x 500 canvas
  const s = (x: number) => 100 + (x - 100) * wide;
  const shoulder = woman ? 40 : 48, waist = woman ? 26 : 34, hip = woman ? 42 : 36;
  const torso = `M${s(100 - shoulder)} 92 Q100 80 ${s(100 + shoulder)} 92 L${s(100 + waist)} 205 Q${s(100 + hip + 4)} 238 ${s(100 + hip)} 250 L${s(100 - hip)} 250 Q${s(100 - hip - 4)} 238 ${s(100 - waist)} 205 Z`;
  const leg = (side: 1 | -1) => `M${s(100 + side * 4)} 245 L${s(100 + side * hip)} 248 L${s(100 + side * 16)} 470 L${s(100 + side * 6)} 470 Z`;
  const arm = (side: 1 | -1) => `M${s(100 + side * shoulder)} 94 Q${s(100 + side * (shoulder + 14))} 160 ${s(100 + side * (shoulder + 10))} 262 L${s(100 + side * (shoulder + 1))} 262 Q${s(100 + side * (shoulder + 2))} 170 ${s(100 + side * (shoulder - 8))} 120 Z`;

  return (
    <div className={`absolute inset-0 overflow-hidden ${className}`} style={{ background: scene.sky }}>
      <Decor kind={scene.decor} />
      <div className="absolute inset-x-0 bottom-0 h-[24%]" style={{ background: `linear-gradient(${scene.floor}, ${scene.floor}cc)` }} />
      {scene.night && <div className="absolute inset-0 bg-[#0b1020]/25" />}
      <div className="absolute bottom-[7%] left-1/2 h-[66%] -translate-x-1/2 sm:h-[74%]" style={{ aspectRatio: "200 / 500", transform: `translateX(-50%) scale(${tall})`, transformOrigin: "bottom center" }}>
        <div className="absolute bottom-[-2%] left-1/2 h-[4%] w-[70%] -translate-x-1/2 rounded-[50%] bg-black/25 blur-md" />
        <svg viewBox="0 0 200 500" className="absolute inset-0 h-full w-full">
          <g fill={skin}>
            <path d={arm(-1)} /><path d={arm(1)} /><path d={leg(-1)} /><path d={leg(1)} />
            <rect x="91" y="58" width="18" height="34" rx="6" />
            <path d={torso} />
            <ellipse cx={s(89)} cy="474" rx="13" ry="6" /><ellipse cx={s(111)} cy="474" rx="13" ry="6" />
          </g>
          <defs><clipPath id="model-face"><circle cx="100" cy="38" r="25" /></clipPath></defs>
          {body?.faceUrl
            ? <image href={body.faceUrl} x="75" y="13" width="50" height="50" preserveAspectRatio="xMidYMid slice" clipPath="url(#model-face)" />
            : <ellipse cx="100" cy="38" rx="22" ry="26" fill={skin} />}
        </svg>
        {worn.map((item) => {
          const slot = SLOTS[item.category!];
          const style: CSSProperties = { top: `${slot.top}%`, height: `${slot.height}%`, width: `${Math.min(100, slot.width * wide)}%`, zIndex: slot.z };
          return <img key={item.wardrobeItemId} src={item.imageUrl} alt={item.name} className="absolute left-1/2 -translate-x-1/2 object-contain object-top drop-shadow-[0_6px_8px_rgba(0,0,0,0.25)]" style={style} />;
        })}
      </div>
      {carried.length > 0 && <div className="absolute right-4 top-4 flex flex-col gap-2 sm:right-6 sm:top-6">{carried.map((item) => <img key={item.wardrobeItemId} src={item.imageUrl} alt={item.name} title={item.name} className={`h-16 w-14 rounded-xl ${item.photo === "cutout" ? "bg-white/70 object-contain p-1" : "object-cover"} shadow-lg ring-2 ring-white/80`} />)}</div>}
    </div>
  );
}
