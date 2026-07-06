"use client";

import { useMemo, useRef, useState } from "react";
import { formatTimestamp, type TranscriptSegment, type VideoMeta } from "@/lib/youtube";
import { groupSegments, toPlainText, toSrt, toTimestampedText } from "@/lib/format";

type Phase = "idle" | "fetching" | "ready" | "error";
type SpeakerPhase = "idle" | "labeling" | "done" | "error";
type View = "transcript" | "speakers";

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

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9äöüß]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "transcript"
  );
}

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [language, setLanguage] = useState("auto");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [video, setVideo] = useState<VideoResponse | null>(null);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [view, setView] = useState<View>("transcript");
  const [speakerPhase, setSpeakerPhase] = useState<SpeakerPhase>("idle");
  const [speakerText, setSpeakerText] = useState("");
  const [speakerError, setSpeakerError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const busy = phase === "fetching";
  const blocks = useMemo(
    () => (video ? groupSegments(video.segments) : []),
    [video]
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !url.trim()) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase("fetching");
    setError(null);
    setVideo(null);
    setView("transcript");
    setSpeakerPhase("idle");
    setSpeakerText("");
    setSpeakerError(null);
    setCopied(false);

    try {
      const res = await fetch("/api/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, lang: language === "auto" ? undefined : language }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to fetch the video transcript.");
      }
      setVideo((await res.json()) as VideoResponse);
      setPhase("ready");
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPhase("error");
    }
  }

  async function labelSpeakers() {
    if (!video || speakerPhase === "labeling") return;
    setView("speakers");
    if (speakerPhase === "done") return; // already labeled, just switch view

    setSpeakerPhase("labeling");
    setSpeakerError(null);
    setSpeakerText("");

    try {
      const res = await fetch("/api/speakers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segments: video.segments, meta: video.meta }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Speaker labeling failed.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setSpeakerText(text);
      }
      setSpeakerPhase("done");
    } catch (err) {
      setSpeakerError(err instanceof Error ? err.message : "Speaker labeling failed.");
      setSpeakerPhase("error");
    }
  }

  function currentText(): string {
    if (!video) return "";
    if (view === "speakers") return speakerText;
    return showTimestamps ? toTimestampedText(video.segments) : toPlainText(video.segments);
  }

  async function copyCurrent() {
    await navigator.clipboard.writeText(currentText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const filenameBase = video ? slugify(video.meta.title) : "transcript";

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-5 py-14 sm:py-20">
      <header className="text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-600 text-white shadow-lg shadow-red-600/25">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-6 w-6" aria-hidden>
            <path d="M5 7h14M5 12h14M5 17h9" />
          </svg>
        </div>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          YouTube Transcript Generator
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-balance text-[15px] leading-relaxed opacity-70">
          Paste a YouTube URL and get the full one-to-one transcript — with timestamps,
          TXT/SRT downloads, and optional AI speaker labeling.
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
              aria-label="Transcript language"
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
              {busy ? "Fetching…" : "Get Transcript"}
            </button>
          </div>
        </div>
      </form>

      {error && (
        <div className="mt-8 rounded-xl border border-red-300/60 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      )}

      {phase === "fetching" && (
        <div className="mt-8 flex items-center gap-3 text-sm opacity-60">
          <Spinner />
          Fetching transcript…
        </div>
      )}

      {video && (
        <>
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
                {` · ${video.segments.length} segments`}
                {video.language ? ` · ${video.language}` : ""}
              </p>
            </div>
          </div>

          <section className="mt-6 rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex flex-wrap items-center gap-2 border-b border-black/8 p-3 dark:border-white/10">
              <div className="flex rounded-lg border border-black/10 p-0.5 text-xs font-medium dark:border-white/15">
                <button
                  onClick={() => setView("transcript")}
                  className={`rounded-md px-3 py-1.5 transition ${view === "transcript" ? "bg-red-600 text-white" : "opacity-70 hover:opacity-100"}`}
                >
                  Transcript
                </button>
                <button
                  onClick={labelSpeakers}
                  className={`rounded-md px-3 py-1.5 transition ${view === "speakers" ? "bg-red-600 text-white" : "opacity-70 hover:opacity-100"}`}
                >
                  {speakerPhase === "labeling" ? "Labeling…" : "Speakers (AI)"}
                </button>
              </div>

              {view === "transcript" && (
                <label className="ml-1 flex cursor-pointer items-center gap-1.5 text-xs opacity-70">
                  <input
                    type="checkbox"
                    checked={showTimestamps}
                    onChange={(e) => setShowTimestamps(e.target.checked)}
                    className="accent-red-600"
                  />
                  Timestamps
                </label>
              )}

              <div className="ml-auto flex flex-wrap gap-2">
                <ToolbarButton onClick={copyCurrent}>
                  {copied ? "Copied!" : "Copy"}
                </ToolbarButton>
                {view === "transcript" ? (
                  <>
                    <ToolbarButton
                      onClick={() => download(`${filenameBase}.txt`, toPlainText(video.segments))}
                    >
                      .txt
                    </ToolbarButton>
                    <ToolbarButton
                      onClick={() =>
                        download(`${filenameBase}-timestamped.txt`, toTimestampedText(video.segments))
                      }
                    >
                      .txt + time
                    </ToolbarButton>
                    <ToolbarButton
                      onClick={() => download(`${filenameBase}.srt`, toSrt(video.segments))}
                    >
                      .srt
                    </ToolbarButton>
                  </>
                ) : (
                  speakerPhase === "done" && (
                    <ToolbarButton
                      onClick={() => download(`${filenameBase}-speakers.txt`, speakerText)}
                    >
                      .txt
                    </ToolbarButton>
                  )
                )}
              </div>
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-5 sm:p-6">
              {view === "transcript" ? (
                <div className="flex flex-col gap-4">
                  {blocks.map((block, i) => (
                    <div key={i} className="flex gap-4">
                      {showTimestamps && (
                        <a
                          href={`https://www.youtube.com/watch?v=${video.meta.videoId}&t=${Math.floor(block.start)}s`}
                          target="_blank"
                          rel="noreferrer"
                          className="w-14 shrink-0 pt-px font-mono text-xs tabular-nums text-red-600 hover:underline dark:text-red-400"
                        >
                          {formatTimestamp(block.start)}
                        </a>
                      )}
                      <p className="text-[15px] leading-relaxed">
                        {block.text.replace(/^>>\s*/, "")}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  {speakerError && (
                    <div className="mb-4 rounded-xl border border-red-300/60 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                      {speakerError}
                    </div>
                  )}
                  {speakerText ? (
                    <div className="text-[15px] leading-relaxed">
                      {speakerText.split(/\n\n+/).map((para, i) => (
                        <p key={i} className="mb-4 whitespace-pre-wrap">
                          <SpeakerParagraph text={para} />
                        </p>
                      ))}
                    </div>
                  ) : (
                    speakerPhase === "labeling" && (
                      <div className="flex items-center gap-3 text-sm opacity-60">
                        <Spinner />
                        Analyzing who says what… this reproduces the full transcript and can
                        take a minute for long videos.
                      </div>
                    )
                  )}
                </>
              )}
            </div>
          </section>
        </>
      )}

      <footer className="mt-auto pt-16 text-center text-xs opacity-40">
        Transcripts via YouTube · Speaker labeling via Claude
      </footer>
    </main>
  );
}

/** Renders "**Label [0:12]:** text" turns with the label bolded, without a markdown lib. */
function SpeakerParagraph({ text }: { text: string }) {
  const match = text.match(/^\*\*(.+?)\*\*\s*:?\s*([\s\S]*)$/);
  if (!match) return <>{text}</>;
  return (
    <>
      <strong className="font-semibold text-red-700 dark:text-red-400">
        {match[1].replace(/:\s*$/, "")}:
      </strong>{" "}
      {match[2]}
    </>
  );
}

function ToolbarButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium opacity-70 transition hover:opacity-100 dark:border-white/15"
    >
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden
    />
  );
}
