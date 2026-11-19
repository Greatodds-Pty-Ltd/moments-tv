import sharp from "sharp";
import { auth, isEmployeeEmail } from "@/auth";
import { readImage } from "@/lib/source";
import { knownImageIds } from "@/lib/store";

export const dynamic = "force-dynamic";

const cache = new Map<string, Buffer>(); // per instance; a handful of hero images at most

// Serves only images the current Images tab points at, resized to 1400px WebP.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isEmployeeEmail((await auth())?.user?.email)) return new Response("Please sign in.", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id) || !(await knownImageIds()).has(id)) return new Response("Not found", { status: 404 });
  try {
    let out = cache.get(id);
    if (!out) {
      out = await sharp(await readImage(id)).rotate().resize({ width: 1400, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
      if (cache.size > 50) cache.clear();
      cache.set(id, out);
    }
    return new Response(new Uint8Array(out), {
      headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=86400" },
    });
  } catch (err) {
    console.error("image failed", id, err);
    return new Response("Image unavailable", { status: 502 });
  }
}
