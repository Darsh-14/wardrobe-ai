// Talks to the Wardrobe AI backend (backend/README.md lists every endpoint).
// The API lives on the same origin by default (the backend serves this app); set
// VITE_API_URL at build time to call one hosted elsewhere.
import type {
  CategorySummary,
  GeneratedLook,
  ItemScan,
  LookRequest,
  Recommendation,
  ShoppingAdvice,
  Trend,
  UserProfile,
  UserStats,
  WardrobeItem,
  Weather,
} from "../types";
import type { Box } from "./cutout";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const SESSION_KEY = "wardrobe-ai.session";

export type Session = { accessToken: string; refreshToken: string; expiresAt: number | null };

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function setSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // private mode: the session lasts until the tab closes
  }
  memorySession = s;
  window.dispatchEvent(new Event("wardrobe-ai:session"));
}

let memorySession: Session | null = getSession();
let refreshing: Promise<Session | null> | null = null;

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${BASE}/api${path}`, init);
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
}

async function errorFrom(res: Response): Promise<ApiError> {
  let message = `Something went wrong (${res.status})`;
  try {
    const body = await res.json();
    if (body?.error) message = body.error;
  } catch {
    // not JSON
  }
  return new ApiError(res.status, message);
}

function refreshSession(): Promise<Session | null> {
  const current = memorySession;
  if (!current) return Promise.resolve(null);
  refreshing ??= send("/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: current.refreshToken }),
  })
    .then(async (res) => {
      if (!res.ok) return null;
      const { session } = (await res.json()) as { session: Session };
      return session;
    })
    .catch(() => null)
    .then((s) => {
      setSession(s);
      return s;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  raw = false,
): Promise<T> {
  const build = (s: Session | null): RequestInit => {
    const headers: Record<string, string> = {};
    if (s) headers.Authorization = `Bearer ${s.accessToken}`;
    if (body !== undefined && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
    return {
      method,
      headers,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    };
  };

  let session = memorySession;
  // refresh a little before the access token expires
  if (session?.expiresAt && session.expiresAt * 1000 < Date.now() + 30_000) session = await refreshSession();
  let res = await send(path, build(session));
  if (res.status === 401 && session) {
    session = await refreshSession();
    if (session) res = await send(path, build(session));
  }
  if (res.status === 401) setSession(null);
  if (!res.ok) throw await errorFrom(res);
  if (raw) return res as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const get = <T>(path: string) => request<T>("GET", path);
const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {});

export type NewItem = Record<string, unknown>;
export type Scan = ItemScan & { item: NewItem; box?: Box | null };
/** Profile > Body & fit profile; used to draw the model in "see it on you" */
export type BodyProfile = {
  model?: "Woman" | "Man";
  heightCm?: number;
  weightKg?: number;
  build?: string;
  skinTone?: string;
  faceUrl?: string | null;
};
export type Me = UserProfile & { email: string | null; bodyProfile?: BodyProfile };
export type Look = Omit<GeneratedLook, "tempC" | "items"> & {
  tempC: number | null;
  status: "pending" | "ready" | "failed";
  visualizationStatus: "pending" | "ready" | "failed";
  saved: boolean;
  occasion?: string;
  location?: string | null;
  weather?: { tempC: number; condition: string } | null;
  hasPicture?: boolean;
  items: (GeneratedLook["items"][number] & { category?: string; photo?: "cutout" | "original" | null; studioUrl?: string | null })[];
};
export type Rec = Recommendation & { id: string; productName: string };
export type TodaysPick = { id: string; title: string; imageUrl: string } | null;

export const api = {
  async login(email: string, password: string) {
    const res = await request<{ session: Session }>("POST", "/auth/login", { email, password });
    setSession(res.session);
  },
  /** Returns true when Supabase wants the email confirmed before the first sign-in. */
  async signup(email: string, password: string, name: string, city: string) {
    const res = await request<{ session: Session | null; needsEmailConfirmation: boolean }>(
      "POST",
      "/auth/signup",
      { email, password, name, city },
    );
    if (res.session) setSession(res.session);
    return res.needsEmailConfirmation;
  },
  async logout() {
    await post("/auth/logout").catch(() => undefined);
    setSession(null);
  },

  me: () => get<Me>("/me"),
  updateMe: (patch: Partial<Pick<UserProfile, "name" | "city" | "styleDna" | "styleTags"> & { bodyProfile: BodyProfile }>) =>
    request<Me>("PATCH", "/me", patch),
  uploadFace(file: Blob) {
    const form = new FormData();
    form.append("file", file, "face.jpg");
    return post<Me>("/me/face", form);
  },
  deleteFace: () => request<Me>("DELETE", "/me/face"),
  stats: () => get<UserStats>("/me/stats"),
  weather: (location?: string) =>
    get<Weather & { location: string }>(`/weather${location ? `?location=${encodeURIComponent(location)}` : ""}`),

  summary: () => get<CategorySummary[]>("/wardrobe/summary"),
  items: (category = "All items") =>
    get<WardrobeItem[]>(`/wardrobe/items?category=${encodeURIComponent(category)}`),
  scan(file: Blob) {
    const form = new FormData();
    form.append("file", file, "photo.jpg");
    return post<Scan>("/wardrobe/scan", form);
  },
  addItem: (item: NewItem) => post<WardrobeItem>("/wardrobe/items", item),
  /** Uploads a background-free PNG for a scan that isn't saved yet */
  uploadCutout(png: Blob) {
    const form = new FormData();
    form.append("file", png, "cutout.png");
    return post<{ cutoutPath: string; imageUrl: string }>("/wardrobe/cutouts", form);
  },
  /** A saved item's original photo and where the item is in it */
  async itemOriginal(id: string) {
    const res = await request<Response>("GET", `/wardrobe/items/${id}/original`, undefined, true);
    const box = res.headers.get("X-Item-Box")?.split(",").map(Number) as Box | undefined;
    return { photo: await res.blob(), box: box?.length === 4 ? box : null };
  },
  /** Makes a new studio photo from the item's original photo */
  redoStudio: (id: string) => post<WardrobeItem>(`/wardrobe/items/${id}/studio`),
  setItemCutout(id: string, png: Blob | null) {
    if (!png) return post<WardrobeItem>(`/wardrobe/items/${id}/cutout?keep=original`);
    const form = new FormData();
    form.append("file", png, "cutout.png");
    return post<WardrobeItem>(`/wardrobe/items/${id}/cutout`, form);
  },
  setFavorite: (id: string, favorite: boolean) =>
    request<WardrobeItem>("PATCH", `/wardrobe/items/${id}`, { favorite }),

  generate: (req: LookRequest) =>
    post<Look>("/looks/generate", {
      ...req,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata",
    }),
  look: (id: string) => get<Look>(`/looks/${id}`),
  alternatives: (id: string, wardrobeItemId: string) =>
    post<{ alternatives: WardrobeItem[] }>(`/looks/${id}/swap`, { wardrobeItemId }),
  swap: (id: string, wardrobeItemId: string, replacementId: string) =>
    post<Look>(`/looks/${id}/swap`, { wardrobeItemId, replacementId }),
  save: (id: string, saved: boolean) => request<{ saved: boolean }>(saved ? "POST" : "DELETE", `/looks/${id}/save`),
  wear: (id: string) => post<{ logged: boolean }>(`/looks/${id}/wear`),
  today: () => get<TodaysPick>("/looks/today"),
  /** Makes the AI photo again, e.g. after the body profile changed */
  visualize: (id: string) => post<Look>(`/looks/${id}/visualize`),

  trends: () => get<Trend[]>("/trends"),
  recommendation: () => get<Rec>("/recommendations"),
  ask: (prompt: string) => post<ShoppingAdvice & { id: string }>("/shopping/ask", { prompt }),
};

/** Shrinks a phone photo to a JPEG of at most `max` px on the long side before upload. */
export async function shrinkPhoto(file: File, max = 1600): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.88));
    return blob ?? file;
  } catch {
    // formats the browser can't decode go up as they are
    return file;
  }
}
