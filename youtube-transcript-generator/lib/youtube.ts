import { Innertube } from "youtubei.js";
import { YoutubeTranscript } from "youtube-transcript";
import { ProxyAgent, fetch as undiciFetch } from "undici";

export interface TranscriptSegment {
  /** Start time in seconds */
  start: number;
  text: string;
}

export interface VideoMeta {
  videoId: string;
  title: string;
  author: string;
  thumbnail: string;
  durationSeconds: number | null;
}

export interface VideoResult {
  meta: VideoMeta;
  segments: TranscriptSegment[];
  /** Which strategy produced the transcript */
  source: "innertube" | "caption-track" | "youtube-transcript" | "supadata";
  language: string | null;
}

/**
 * Extract a video ID from the many YouTube URL shapes
 * (watch, youtu.be, shorts, live, embed) or accept a bare 11-char ID.
 */
export function parseVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return /^[\w-]{11}$/.test(id) ? id : null;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const v = url.searchParams.get("v");
    if (v && /^[\w-]{11}$/.test(v)) return v;
    const match = url.pathname.match(/^\/(?:shorts|live|embed|v)\/([\w-]{11})/);
    if (match) return match[1];
  }
  return null;
}

/**
 * YouTube blocks/bot-challenges datacenter IPs (Vercel, AWS, …), which breaks
 * direct transcript fetching. When PROXY_URL is set (e.g. a residential proxy),
 * requests to YouTube are routed through it.
 */
function youtubeFetch(): typeof globalThis.fetch {
  const proxyUrl = process.env.PROXY_URL;
  if (!proxyUrl) return globalThis.fetch;
  const dispatcher = new ProxyAgent(proxyUrl);
  const proxied = (input: RequestInfo | URL, init?: RequestInit) =>
    undiciFetch(input as Parameters<typeof undiciFetch>[0], {
      ...(init as object),
      dispatcher,
    }) as unknown as Promise<Response>;
  return proxied as typeof globalThis.fetch;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function cleanSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  return segments
    .map((s) => ({ start: s.start, text: decodeHtmlEntities(s.text).replace(/\s+/g, " ").trim() }))
    .filter((s) => s.text.length > 0);
}

/**
 * Some transcript sources report start times in milliseconds, others in
 * seconds (youtube-transcript even mixes both depending on the caption
 * format). Normalize to seconds using the video duration when known,
 * otherwise a threshold no plausible seconds value would exceed (~8h).
 */
function normalizeToSeconds(
  segments: TranscriptSegment[],
  durationSeconds: number | null | undefined
): TranscriptSegment[] {
  if (segments.length === 0) return segments;
  const maxStart = Math.max(...segments.map((s) => s.start));
  const looksLikeMs = durationSeconds
    ? maxStart > durationSeconds * 2
    : maxStart > 30_000;
  return looksLikeMs ? segments.map((s) => ({ ...s, start: s.start / 1000 })) : segments;
}

/** Basic metadata without any API key, via YouTube's public oEmbed endpoint. */
async function fetchOembedMeta(videoId: string): Promise<Partial<VideoMeta>> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return {};
    const data = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
    return {
      title: data.title,
      author: data.author_name,
      thumbnail: data.thumbnail_url,
    };
  } catch {
    return {};
  }
}

interface StrategyResult {
  segments: TranscriptSegment[];
  language: string | null;
  meta?: Partial<VideoMeta>;
}

type Strategy = (videoId: string, preferredLang?: string) => Promise<StrategyResult>;

/** Parse YouTube's json3 timedtext format into segments. */
function parseJson3(json: {
  events?: Array<{ tStartMs?: number; segs?: Array<{ utf8?: string }> }>;
}): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  for (const event of json.events ?? []) {
    const text = (event.segs ?? [])
      .map((s) => s.utf8 ?? "")
      .join("")
      .replace(/\n/g, " ")
      .trim();
    if (text) segments.push({ start: (event.tStartMs ?? 0) / 1000, text });
  }
  return segments;
}

/**
 * Strategies 1 + 2: youtubei.js (Innertube) — talks to YouTube's internal API
 * the way the official clients do, and also returns full metadata.
 * First tries the dedicated get_transcript endpoint, then falls back to
 * downloading the raw caption track (timedtext) listed in the player response.
 */
async function createInnertubeSession(videoId: string) {
  const yt = await Innertube.create({
    retrieve_player: false,
    generate_session_locally: true,
    fetch: youtubeFetch(),
  });
  const info = await yt.getInfo(videoId);

  const status = info.playability_status?.status;
  if (status && status !== "OK" && !info.captions?.caption_tracks?.length) {
    throw new Error(`YouTube playability status: ${status}`);
  }

  const meta: Partial<VideoMeta> = {
    title: info.basic_info.title ?? undefined,
    author: info.basic_info.author ?? undefined,
    durationSeconds: info.basic_info.duration ?? null,
    thumbnail: info.basic_info.thumbnail?.[0]?.url,
  };
  return { info, meta };
}

async function viaInnertube(videoId: string, preferredLang?: string): Promise<StrategyResult> {
  const { info, meta } = await createInnertubeSession(videoId);

  let transcriptInfo = await info.getTranscript();
  if (
    preferredLang &&
    transcriptInfo.languages.length > 1 &&
    transcriptInfo.selectedLanguage &&
    !transcriptInfo.selectedLanguage.toLowerCase().startsWith(preferredLang.toLowerCase())
  ) {
    const target = transcriptInfo.languages.find((l) =>
      l.toLowerCase().includes(preferredLang.toLowerCase())
    );
    if (target) {
      transcriptInfo = await transcriptInfo.selectLanguage(target);
    }
  }

  const body = transcriptInfo.transcript?.content?.body;
  const rawSegments = body?.initial_segments ?? [];
  const segments: TranscriptSegment[] = [];
  for (const seg of rawSegments) {
    const text = seg?.snippet?.text;
    const startMs = seg?.start_ms;
    if (typeof text === "string" && text.trim()) {
      segments.push({ start: startMs ? Number(startMs) / 1000 : 0, text });
    }
  }
  if (segments.length === 0) throw new Error("Innertube returned no transcript segments");

  return { segments, language: transcriptInfo.selectedLanguage ?? null, meta };
}

async function viaCaptionTrack(videoId: string, preferredLang?: string): Promise<StrategyResult> {
  const { info, meta } = await createInnertubeSession(videoId);

  const tracks = info.captions?.caption_tracks ?? [];
  if (tracks.length === 0) throw new Error("No caption tracks in player response");

  const track =
    (preferredLang &&
      tracks.find((t) => t.language_code?.toLowerCase().startsWith(preferredLang.toLowerCase()))) ||
    tracks.find((t) => !t.kind) || // prefer human-made captions over ASR
    tracks[0];
  if (!track.base_url) throw new Error("Caption track has no URL");

  const url = `${track.base_url}${track.base_url.includes("?") ? "&" : "?"}fmt=json3`;
  const res = await youtubeFetch()(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Timedtext request failed with ${res.status}`);
  const segments = parseJson3((await res.json()) as Parameters<typeof parseJson3>[0]);
  if (segments.length === 0) throw new Error("Caption track was empty");

  return { segments, language: track.language_code ?? null, meta };
}

/**
 * Strategy 3: youtube-transcript — scrapes caption tracks via its own player
 * request with browser-like headers. Different failure modes than Innertube,
 * so it catches videos where the strategies above are blocked or broken.
 */
async function viaYoutubeTranscript(videoId: string, preferredLang?: string): Promise<StrategyResult> {
  const items = await YoutubeTranscript.fetchTranscript(
    videoId,
    preferredLang ? { lang: preferredLang } : undefined
  );
  if (!items || items.length === 0) throw new Error("youtube-transcript returned no segments");
  return {
    segments: items.map((i) => ({ start: i.offset, text: i.text })),
    language: items[0]?.lang ?? preferredLang ?? null,
  };
}

/**
 * Strategy 4 (optional): Supadata — a hosted transcript API that works even
 * when YouTube blocks datacenter IPs (common on Vercel/AWS). Only used when
 * SUPADATA_API_KEY is configured.
 */
async function viaSupadata(videoId: string, preferredLang?: string): Promise<StrategyResult> {
  const apiKey = process.env.SUPADATA_API_KEY;
  if (!apiKey) throw new Error("SUPADATA_API_KEY not configured");

  const params = new URLSearchParams({ url: `https://www.youtube.com/watch?v=${videoId}` });
  if (preferredLang) params.set("lang", preferredLang);
  const res = await fetch(`https://api.supadata.ai/v1/transcript?${params}`, {
    headers: { "x-api-key": apiKey },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Supadata responded with ${res.status}`);

  const data = (await res.json()) as {
    lang?: string;
    content?: Array<{ text: string; offset: number }> | string;
  };
  if (typeof data.content === "string") {
    if (!data.content.trim()) throw new Error("Supadata returned empty transcript");
    return { segments: [{ start: 0, text: data.content }], language: data.lang ?? null };
  }
  if (!Array.isArray(data.content) || data.content.length === 0) {
    throw new Error("Supadata returned no segments");
  }
  return {
    segments: data.content.map((c) => ({ start: (c.offset ?? 0) / 1000, text: c.text })),
    language: data.lang ?? null,
  };
}

/**
 * Fetch transcript + metadata, trying each strategy in order until one works.
 */
export async function fetchVideo(videoId: string, preferredLang?: string): Promise<VideoResult> {
  const strategies: Array<{ name: VideoResult["source"]; fn: Strategy }> = [
    { name: "innertube", fn: viaInnertube },
    { name: "caption-track", fn: viaCaptionTrack },
    { name: "youtube-transcript", fn: viaYoutubeTranscript },
    ...(process.env.SUPADATA_API_KEY
      ? [{ name: "supadata" as const, fn: viaSupadata }]
      : []),
  ];

  const errors: string[] = [];
  for (const strategy of strategies) {
    try {
      const result = await strategy.fn(videoId, preferredLang);
      const oembed = result.meta?.title ? {} : await fetchOembedMeta(videoId);
      const meta: VideoMeta = {
        videoId,
        title: result.meta?.title ?? oembed.title ?? "Unknown title",
        author: result.meta?.author ?? oembed.author ?? "Unknown channel",
        thumbnail:
          result.meta?.thumbnail ??
          oembed.thumbnail ??
          `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        durationSeconds: result.meta?.durationSeconds ?? null,
      };
      return {
        meta,
        segments: cleanSegments(
          normalizeToSeconds(result.segments, meta.durationSeconds)
        ),
        source: strategy.name,
        language: result.language,
      };
    } catch (err) {
      errors.push(`${strategy.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new TranscriptUnavailableError(
    `Could not fetch a transcript for this video. Attempts: ${errors.join(" | ")}`
  );
}

export class TranscriptUnavailableError extends Error {}

export function formatTimestamp(seconds: number): string {
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}
