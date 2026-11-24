import { Redis } from "@upstash/redis";
import { imageKey, normalize, type TvData, type TvImageRule } from "./calendar";
import { fetchTabs, listImages, sourceKind } from "./source";

// Last-good snapshot of the sheet. Requests are the clock: when the stored
// snapshot is older than REFRESH_MS, the request re-reads the sheet. If that
// fails (Google outage, a broken tab), the old data keeps being served and the
// error is recorded for /api/status. The TV polls every 4 minutes, so a sheet
// edit shows within REFRESH_MS + 4 min ≈ 9 minutes.

export const REFRESH_MS = 5 * 60 * 1000;
const KEY = "mtv:snapshot";

export interface TvImage extends TvImageRule {
  url: string;
  id: string;
}

export interface Snapshot {
  data: Omit<TvData, "images"> & { images: TvImage[] };
  updatedAt: string; // last successful read of the sheet
  checkedAt: string; // last attempt
  lastError: string | null;
  problems: string[]; // rows dropped or degraded in the last successful read
  unmatchedImages?: string[]; // files in the image folder whose name matches no Event in column C
  source: "google" | "local";
}

// Vercel's Upstash integration names its vars UPSTASH_REDIS_REST_* or KV_REST_API_*
// (or a custom prefix), so match on the endings. Same as BetCheck.
function findEnv(suffixes: string[]): string | undefined {
  for (const suffix of suffixes) {
    if (process.env[suffix]) return process.env[suffix];
    const key = Object.keys(process.env).find((k) => k.endsWith(`_${suffix}`) && !k.includes("READ_ONLY") && process.env[k]);
    if (key) return process.env[key];
  }
  return undefined;
}
const url = findEnv(["UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "REST_API_URL"]);
const token = findEnv(["UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_TOKEN", "REST_API_TOKEN"]);
const redis = url && token ? new Redis({ url, token }) : null;
let memory: Snapshot | null = null; // local dev, or a Redis outage

async function load(): Promise<Snapshot | null> {
  if (redis) {
    try {
      const s = await redis.get<Snapshot>(KEY);
      if (s) memory = s;
      return s ?? memory;
    } catch (err) {
      console.error("redis get failed", err);
    }
  }
  return memory;
}

async function save(s: Snapshot): Promise<void> {
  memory = s;
  if (redis) {
    try {
      await redis.set(KEY, s);
    } catch (err) {
      console.error("redis set failed", err);
    }
  }
}

async function build(): Promise<Snapshot> {
  const [tabs, files] = await Promise.all([fetchTabs(), listImages()]);
  const { data, problems, eventNames } = normalize(tabs);

  // An image named exactly like an Event in column C ("Black Friday.png") is that event's hero image.
  // These come first, so they win over the optional TV images tab.
  const byKey = new Map<string, { name: string; id: string }>();
  for (const [name, id] of files) if (!byKey.has(imageKey(name))) byKey.set(imageKey(name), { name, id });
  const used = new Set<string>();
  const images: TvImage[] = [];
  for (const { event, title } of eventNames) {
    const hit = byKey.get(imageKey(event));
    if (!hit || images.some((i) => i.matchValue === title)) continue;
    used.add(hit.name);
    images.push({ matchType: "event", matchValue: title, file: hit.name, textInImage: false, useUntil: null, id: hit.id, url: `/api/image/${hit.id}` });
  }

  for (const rule of data.images) {
    const id = files.get(rule.file);
    if (!id) {
      problems.push(`TV images: "${rule.file}" (for ${rule.matchValue}) isn't in the image folder, skipped`);
      continue;
    }
    used.add(rule.file);
    images.push({ ...rule, id, url: `/api/image/${id}` });
  }
  const unmatchedImages = [...files.keys()].filter((n) => !used.has(n)).sort();
  const now = new Date().toISOString();
  return { data: { ...data, images }, updatedAt: now, checkedAt: now, lastError: null, problems, unmatchedImages, source: sourceKind() };
}

let inflight: Promise<Snapshot> | null = null;

/** The snapshot to serve, refreshed first if it's due. Throws only if there has never been good data. */
export async function getSnapshot(opts: { force?: boolean } = {}): Promise<Snapshot> {
  const stored = await load();
  const due = !stored || opts.force || Date.now() - Date.parse(stored.checkedAt) > REFRESH_MS;
  if (!due) return stored;

  inflight ??= (async () => {
    try {
      const fresh = await build();
      if (fresh.problems.length) console.warn(`sheet problems:\n${fresh.problems.join("\n")}`);
      await save(fresh);
      return fresh;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("sheet refresh failed, keeping last good data:", message);
      if (!stored) throw err;
      const kept = { ...stored, checkedAt: new Date().toISOString(), lastError: message };
      await save(kept);
      return kept;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Image ids the current snapshot vouches for: the image route serves nothing else. */
export async function knownImageIds(): Promise<Set<string>> {
  const s = await load();
  return new Set(s?.data.images.map((i) => i.id) ?? []);
}
