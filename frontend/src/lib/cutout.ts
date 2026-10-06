// Removes the background from a clothing photo, in the browser and for free (no paid API).
// The model (IMG.LY background removal, ~45-90 MB) downloads on first use and is cached after.
// The vision model's bounding box crops the photo to the item first, which keeps beds, laptops
// and people out of the cutout far better than running on the whole photo.

/** [ymin, xmin, ymax, xmax] on a 0-1000 scale */
export type Box = [number, number, number, number];

const MAX_SIDE = 1024;
const mobile = typeof navigator !== "undefined" && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

let loader: Promise<typeof import("@imgly/background-removal")> | null = null;
const lib = () => (loader ??= import("@imgly/background-removal"));

/** Starts downloading the model early, e.g. when the Add screen opens. */
export function warmUpCutouts() {
  lib()
    .then((m) => m.preload({ model: mobile ? "isnet_quint8" : "isnet_fp16" }))
    .catch(() => undefined);
}

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

const toBlob = (c: HTMLCanvasElement) =>
  new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("Couldn't encode image"))), "image/png"));

/**
 * Returns a trimmed transparent PNG of the item, or null when the result doesn't look like a clean
 * cutout (the model lost most of the item), so the caller can keep the original photo.
 */
export function makeCutout(photo: Blob, box?: Box | null): Promise<Blob | null> {
  // one at a time: the model is large and parallel runs only slow each other down
  const run = queue.then(() => cutout(photo, box));
  queue = run.catch(() => undefined);
  return run;
}
let queue: Promise<unknown> = Promise.resolve();

async function cutout(photo: Blob, box?: Box | null): Promise<Blob | null> {
  const bitmap = await createImageBitmap(photo);
  // crop to the item with a little margin
  let [sx, sy, sw, sh] = [0, 0, bitmap.width, bitmap.height];
  if (box) {
    const [y0, x0, y1, x1] = box;
    const padX = (x1 - x0) * 0.04, padY = (y1 - y0) * 0.04;
    sx = Math.max(0, ((x0 - padX) / 1000) * bitmap.width);
    sy = Math.max(0, ((y0 - padY) / 1000) * bitmap.height);
    sw = Math.min(bitmap.width, ((x1 + padX) / 1000) * bitmap.width) - sx;
    sh = Math.min(bitmap.height, ((y1 + padY) / 1000) * bitmap.height) - sy;
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const crop = canvas(Math.round(sw * scale), Math.round(sh * scale));
  crop.getContext("2d")!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, crop.width, crop.height);
  bitmap.close();

  const { removeBackground } = await lib();
  const removed = await removeBackground(await toBlob(crop), {
    model: mobile ? "isnet_quint8" : "isnet_fp16",
    output: { format: "image/png" },
  });

  const out = await createImageBitmap(removed);
  const work = canvas(out.width, out.height);
  const ctx = work.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(out, 0, 0);
  out.close();
  const img = ctx.getImageData(0, 0, work.width, work.height);
  const px = img.data;

  // Firm up the soft, see-through edges the model leaves on fabric, and find the item's bounds
  let soft = 0, solid = 0;
  let minX = work.width, minY = work.height, maxX = -1, maxY = -1;
  for (let i = 0, n = 0; i < px.length; i += 4, n++) {
    const a = px[i + 3] / 255;
    soft += a;
    const firm = Math.min(1, Math.max(0, (a - 0.25) / 0.3));
    px[i + 3] = Math.round(firm * 255);
    if (firm > 0.5) {
      solid++;
      const x = n % work.width, y = (n / work.width) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const area = work.width * work.height;
  // the model dropped most of the item (e.g. light jeans on a light sheet): keep the original photo
  if (solid < area * 0.06 || solid < soft * 0.5 || maxX < 0) return null;
  ctx.putImageData(img, 0, 0);

  const pad = Math.round(Math.max(work.width, work.height) * 0.02);
  const x = Math.max(0, minX - pad), y = Math.max(0, minY - pad);
  const w = Math.min(work.width, maxX + pad + 1) - x, h = Math.min(work.height, maxY + pad + 1) - y;
  const trimmed = canvas(w, h);
  trimmed.getContext("2d")!.drawImage(work, x, y, w, h, 0, 0, w, h);
  return toBlob(trimmed);
}
