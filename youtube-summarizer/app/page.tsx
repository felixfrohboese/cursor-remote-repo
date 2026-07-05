"use client";

import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TranscriptSegment, VideoMeta } from "@/lib/youtube";

type Phase = "idle" | "fetching" | "summarizing" | "done" | "error";

interface VideoResponse {
  meta: VideoMeta;
  segments: TranscriptSegment[];
  source: string;
  language: string | null;
}

const LANGUAGES = [
  { value: "auto", label: "Auto" },
  { value: "de", label: "Deutsch" },
  { value: "en", label: "English" },
];

function formatDuration(seconds: number): string {
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [language, setLanguage] = useState("auto");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [video, setVideo] = useState<VideoResponse | null>(null);
  const [summary, setSummary] = useState("");
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const busy = phase === "fetching" || phase === "summarizing";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !url.trim()) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase("fetching");
    setError(null);
    setVideo(null);
    setSummary("");
    setCopied(false);

    try {
      const videoRes = await fetch("/api/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, lang: language === "auto" ? undefined : language }),
        signal: controller.signal,
      });
      if (!videoRes.ok) {
        const data = await videoRes.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to fetch the video transcript.");
      }
      const videoData = (await videoRes.json()) as VideoResponse;
      setVideo(videoData);
      setPhase("summarizing");

      const summaryRes = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segments: videoData.segments,
          meta: videoData.meta,
          language,
        }),
        signal: controller.signal,
      });
      if (!summaryRes.ok || !summaryRes.body) {
        const data = await summaryRes.json().catch(() => null);
        throw new Error(data?.error ?? "Summarization failed.");
      }

      const reader = summaryRes.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setSummary(text);
      }
      setPhase("done");
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPhase("error");
    }
  }

  async function copySummary() {
    await navigator.clipboard.writeText(summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 py-14 sm:py-20">
      <header className="text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-600 text-white shadow-lg shadow-red-600/25">
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6" aria-hidden>
            <path d="M8 5.14v14l11-7-11-7z" />
          </svg>
        </div>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">YouTube Summarizer</h1>
        <p className="mx-auto mt-3 max-w-xl text-balance text-[15px] leading-relaxed opacity-70">
          Paste a YouTube URL and get an AI-generated summary with the key takeaways in
          seconds — no more watching 40-minute videos for three key points.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="mt-9">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            required
            disabled={busy}
            className="h-12 flex-1 rounded-xl border border-black/15 bg-white px-4 text-[15px] shadow-sm outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/20 disabled:opacity-60 dark:border-white/15 dark:bg-white/5"
          />
          <div className="flex gap-3">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              disabled={busy}
              aria-label="Summary language"
              className="h-12 rounded-xl border border-black/15 bg-white px-3 text-sm shadow-sm outline-none transition focus:border-red-500 disabled:opacity-60 dark:border-white/15 dark:bg-white/5 dark:[&>option]:bg-neutral-900"
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={busy || !url.trim()}
              className="h-12 shrink-0 rounded-xl bg-red-600 px-6 text-[15px] font-semibold text-white shadow-lg shadow-red-600/25 transition hover:bg-red-500 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
            >
              {phase === "fetching"
                ? "Fetching…"
                : phase === "summarizing"
                  ? "Summarizing…"
                  : "Summarize"}
            </button>
          </div>
        </div>
      </form>

      {error && (
        <div className="mt-8 rounded-xl border border-red-300/60 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      )}

      {video && (
        <div className="mt-8 flex items-center gap-4 rounded-2xl border border-black/10 bg-black/[0.03] p-3 dark:border-white/10 dark:bg-white/5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={video.meta.thumbnail}
            alt=""
            className="h-16 w-28 shrink-0 rounded-lg object-cover"
          />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold">{video.meta.title}</p>
            <p className="mt-0.5 truncate text-sm opacity-60">
              {video.meta.author}
              {video.meta.durationSeconds
                ? ` · ${formatDuration(video.meta.durationSeconds)}`
                : ""}
              {` · ${video.segments.length} transcript segments`}
            </p>
          </div>
        </div>
      )}

      {phase === "fetching" && (
        <div className="mt-8 flex items-center gap-3 text-sm opacity-60">
          <Spinner />
          Fetching transcript…
        </div>
      )}

      {(summary || phase === "summarizing") && (
        <section className="mt-6 rounded-2xl border border-black/10 bg-white p-6 shadow-sm sm:p-8 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-xs font-semibold uppercase tracking-widest opacity-50">
              Summary
            </h2>
            {phase === "done" && (
              <button
                onClick={copySummary}
                className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium opacity-70 transition hover:opacity-100 dark:border-white/15"
              >
                {copied ? "Copied!" : "Copy Markdown"}
              </button>
            )}
          </div>
          {summary ? (
            <div className="summary-prose text-[15px]">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
            </div>
          ) : (
            <div className="flex items-center gap-3 text-sm opacity-60">
              <Spinner />
              Reading the transcript and writing your summary…
            </div>
          )}
        </section>
      )}

      <footer className="mt-auto pt-16 text-center text-xs opacity-40">
        Transcripts via YouTube · Summaries via Claude
      </footer>
    </main>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden
    />
  );
}
