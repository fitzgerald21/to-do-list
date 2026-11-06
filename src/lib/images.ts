/** An image ready to send to a model: base64 JPEG plus a label like "Screenshot 1, part 2 of 3". */
export interface ImageInput {
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  /** Base64 without the data: prefix. */
  data: string;
  label: string;
}

/** One attached picture as the user sees it (a tall one may be sent as several tiles). */
export interface Attachment {
  id: string;
  name: string;
  preview: string;
  tiles: Omit<ImageInput, "label">[];
}

/** Longest side we send. Models downscale anything bigger anyway. */
const MAX_EDGE = 1568;
/** Taller than this (height / width) gets cut into pieces so small chat text stays readable. */
const MAX_ASPECT = 2.2;
const MAX_TILES = 8;

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through (e.g. HEIC in some browsers) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function toJpeg(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number): string {
  const scale = Math.min(1, MAX_EDGE / Math.max(sw, sh));
  const c = document.createElement("canvas");
  c.width = Math.round(sw * scale);
  c.height = Math.round(sh * scale);
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff"; // transparent PNGs would otherwise turn black
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}

/** Shrink a picture and, if it's a long scrolling screenshot, cut it top-to-bottom into readable pieces. */
export async function prepareImage(file: Blob, name = "image"): Promise<Attachment> {
  const bmp = await loadBitmap(file);
  const w = bmp.width;
  const h = bmp.height;
  const dataUrls: string[] = [];
  if (h / w <= MAX_ASPECT) {
    dataUrls.push(toJpeg(bmp, 0, 0, w, h));
  } else {
    const tileH = Math.max(Math.round(w * 2), Math.ceil(h / MAX_TILES));
    const overlap = Math.round(tileH * 0.06); // so a line cut at the edge appears whole in one piece
    for (let y = 0; y < h && dataUrls.length < MAX_TILES; y += tileH - overlap) {
      const sh = Math.min(tileH, h - y);
      dataUrls.push(toJpeg(bmp, 0, y, w, sh));
      if (y + sh >= h) break;
    }
  }
  if ("close" in bmp) bmp.close();
  return {
    id: Math.random().toString(36).slice(2),
    name,
    preview: dataUrls[0],
    tiles: dataUrls.map((u) => ({ mediaType: "image/jpeg" as const, data: u.slice(u.indexOf(",") + 1) })),
  };
}

/** Flatten attachments into labelled images for the model. */
export function toModelImages(atts: Attachment[]): ImageInput[] {
  const out: ImageInput[] = [];
  atts.forEach((a, i) =>
    a.tiles.forEach((t, j) =>
      out.push({
        ...t,
        label:
          a.tiles.length > 1
            ? `Image ${i + 1} ("${a.name}"), part ${j + 1} of ${a.tiles.length} (a tall screenshot cut top to bottom; parts overlap slightly):`
            : `Image ${i + 1} ("${a.name}"):`,
      }),
    ),
  );
  return out;
}
