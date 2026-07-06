"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TranscriptResult, Utterance } from "@/lib/assemblyai";
import {
  formatTimestamp,
  speakerName,
  speakerOrder,
  toSpeakerText,
  toSrt,
} from "@/lib/format";

type Phase = "idle" | "uploading" | "starting" | "transcribing" | "ready" | "error";
type NamePhase = "idle" | "naming" | "done" | "error";
type Source = "file" | "url";

const LANGUAGES = [
  { value: "auto", label: "Auto-detect" },
  { value: "de", label: "Deutsch" },
  { value: "en", label: "English" },
];

const ACCEPT =
  ".mp3,.mp4,.mpeg,.mpg,.wav,.m4a,.aac,.ogg,.opus,.flac,.wma,.amr,.mov,.webm,.mkv,.avi,.m4v,.3gp,.wmv,audio/*,video/*";

const SPEAKER_STYLES = [
  { badge: "bg-violet-600", text: "text-violet-700 dark:text-violet-400" },
  { badge: "bg-sky-600", text: "text-sky-700 dark:text-sky-400" },
  { badge: "bg-emerald-600", text: "text-emerald-700 dark:text-emerald-400" },
  { badge: "bg-amber-600", text: "text-amber-700 dark:text-amber-400" },
  { badge: "bg-rose-600", text: "text-rose-700 dark:text-rose-400" },
  { badge: "bg-cyan-600", text: "text-cyan-700 dark:text-cyan-400" },
  { badge: "bg-fuchsia-600", text: "text-fuchsia-700 dark:text-fuchsia-400" },
  { badge: "bg-lime-600", text: "text-lime-700 dark:text-lime-400" },
];

function formatDuration(seconds: number): string {
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function slugify(name: string): string {
  return (
    name
      .replace(/\.[a-z0-9]+$/i, "")
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

/** Upload via XHR to get progress events (fetch has no upload progress). */
function uploadWithProgress(
  file: File,
  onProgress: (fraction: number) => void,
  signal: AbortSignal
): Promise<{ uploadUrl: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300 && xhr.response?.uploadUrl) {
        resolve(xhr.response as { uploadUrl: string });
      } else {
        reject(new Error(xhr.response?.error ?? "Upload failed."));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection."));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Home() {
  const [source, setSource] = useState<Source>("file");
  const [file, setFile] = useState<File | null>(null);
  const [mediaUrl, setMediaUrl] = useState("");
  const [language, setLanguage] = useState("auto");
  const [speakersExpected, setSpeakersExpected] = useState("");
  const [dragging, setDragging] = useState(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TranscriptResult | null>(null);
  const [sourceName, setSourceName] = useState("recording");

  const [names, setNames] = useState<Record<string, string>>({});
  const [namePhase, setNamePhase] = useState<NamePhase>("idle");
  const [nameError, setNameError] = useState<string | null>(null);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [copied, setCopied] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const busy = phase === "uploading" || phase === "starting" || phase === "transcribing";

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  const order = useMemo(
    () => (result ? speakerOrder(result.utterances) : []),
    [result]
  );

  function pickStyle(label: string) {
    const index = order.indexOf(label);
    return SPEAKER_STYLES[(index === -1 ? 0 : index) % SPEAKER_STYLES.length];
  }

  function reset() {
    setError(null);
    setResult(null);
    setNames({});
    setNamePhase("idle");
    setNameError(null);
    setCopied(false);
    setUploadProgress(0);
    setElapsed(0);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (source === "file" && !file) return;
    if (source === "url" && !mediaUrl.trim()) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    reset();

    try {
      let audioUrl: string;
      if (source === "file" && file) {
        setSourceName(file.name);
        setPhase("uploading");
        const uploaded = await uploadWithProgress(file, setUploadProgress, controller.signal);
        audioUrl = uploaded.uploadUrl;
      } else {
        const trimmed = mediaUrl.trim();
        setSourceName(trimmed.split("/").pop()?.split("?")[0] || "recording");
        audioUrl = trimmed;
      }

      setPhase("starting");
      const speakers = parseInt(speakersExpected, 10);
      const createRes = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioUrl,
          language,
          speakersExpected: Number.isFinite(speakers) ? speakers : undefined,
        }),
        signal: controller.signal,
      });
      const created = await createRes.json().catch(() => null);
      if (!createRes.ok || !created?.id) {
        throw new Error(created?.error ?? "Could not start the transcription.");
      }

      setPhase("transcribing");
      for (;;) {
        await sleep(3000);
        if (controller.signal.aborted) return;
        const pollRes = await fetch(`/api/transcribe?id=${encodeURIComponent(created.id)}`, {
          signal: controller.signal,
        });
        const poll = await pollRes.json().catch(() => null);
        if (!pollRes.ok) throw new Error(poll?.error ?? "Lost track of the transcription.");
        if (poll.status === "error") throw new Error(poll.error ?? "Transcription failed.");
        if (poll.status === "completed") {
          setResult(poll.result as TranscriptResult);
          setPhase("ready");
          break;
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPhase("error");
    }
  }

  function handleFiles(files: FileList | null) {
    const picked = files?.[0];
    if (picked) {
      setFile(picked);
      setSource("file");
    }
  }

  async function nameSpeakers() {
    if (!result || namePhase === "naming") return;
    setNamePhase("naming");
    setNameError(null);
    try {
      const res = await fetch("/api/speakers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ utterances: result.utterances, filename: sourceName }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Speaker naming failed.");
      const found = (data?.names ?? {}) as Record<string, string>;
      setNames((prev) => ({ ...found, ...prev }));
      setNamePhase("done");
      if (Object.keys(found).length === 0) {
        setNameError("No names are mentioned in the recording — you can rename speakers manually.");
      }
    } catch (err) {
      setNameError(err instanceof Error ? err.message : "Speaker naming failed.");
      setNamePhase("error");
    }
  }

  async function copyCurrent() {
    if (!result) return;
    await navigator.clipboard.writeText(
      toSpeakerText(result.utterances, names, { timestamps: showTimestamps })
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const filenameBase = slugify(sourceName);
  const multiSpeaker = order.length > 1;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-5 py-14 sm:py-20">
      <header className="text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-600 text-white shadow-lg shadow-violet-600/25">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-6 w-6" aria-hidden>
            <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
          </svg>
        </div>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Audio &amp; Video Transcriber
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-balance text-[15px] leading-relaxed opacity-70">
          Upload any audio or video file — MP3, MP4, WAV, MPEG, MOV and more — and get a
          high-quality transcript with speaker detection, timestamps, and AI speaker naming.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="mt-9">
        <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
          <div className="mb-4 flex rounded-lg border border-black/10 p-0.5 text-xs font-medium dark:border-white/15">
            <button
              type="button"
              onClick={() => setSource("file")}
              className={`flex-1 rounded-md px-3 py-1.5 transition ${source === "file" ? "bg-violet-600 text-white" : "opacity-70 hover:opacity-100"}`}
            >
              Upload file
            </button>
            <button
              type="button"
              onClick={() => setSource("url")}
              className={`flex-1 rounded-md px-3 py-1.5 transition ${source === "url" ? "bg-violet-600 text-white" : "opacity-70 hover:opacity-100"}`}
            >
              Media URL
            </button>
          </div>

          {source === "file" ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                handleFiles(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
              }}
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition ${
                dragging
                  ? "border-violet-500 bg-violet-500/10"
                  : "border-black/15 hover:border-violet-400 dark:border-white/15"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
              />
              {file ? (
                <>
                  <p className="max-w-full truncate text-[15px] font-semibold">{file.name}</p>
                  <p className="text-xs opacity-60">
                    {formatBytes(file.size)} · click or drop to replace
                  </p>
                </>
              ) : (
                <>
                  <p className="text-[15px] font-medium">
                    Drop a file here, or click to browse
                  </p>
                  <p className="text-xs opacity-60">
                    MP3 · MP4 · WAV · M4A · MPEG · MOV · WEBM · FLAC · OGG … up to 5 GB
                  </p>
                </>
              )}
            </div>
          ) : (
            <input
              type="url"
              value={mediaUrl}
              onChange={(e) => setMediaUrl(e.target.value)}
              placeholder="https://example.com/recording.mp3"
              disabled={busy}
              className="h-12 w-full rounded-xl border border-black/15 bg-white px-4 text-[15px] shadow-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 disabled:opacity-60 dark:border-white/15 dark:bg-white/5"
            />
          )}

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="flex items-center gap-2 text-sm">
              <span className="opacity-60">Language</span>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                disabled={busy}
                className="h-10 rounded-xl border border-black/15 bg-white px-3 text-sm shadow-sm outline-none transition focus:border-violet-500 disabled:opacity-60 dark:border-white/15 dark:bg-white/5 dark:[&>option]:bg-neutral-900"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <span className="opacity-60">Speakers</span>
              <input
                type="number"
                min={1}
                max={10}
                value={speakersExpected}
                onChange={(e) => setSpeakersExpected(e.target.value)}
                placeholder="auto"
                disabled={busy}
                className="h-10 w-20 rounded-xl border border-black/15 bg-white px-3 text-sm shadow-sm outline-none transition focus:border-violet-500 disabled:opacity-60 dark:border-white/15 dark:bg-white/5"
              />
            </label>
            <button
              type="submit"
              disabled={busy || (source === "file" ? !file : !mediaUrl.trim())}
              className="h-12 rounded-xl bg-violet-600 px-6 text-[15px] font-semibold text-white shadow-lg shadow-violet-600/25 transition hover:bg-violet-500 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 sm:ml-auto"
            >
              {busy ? "Working…" : "Transcribe"}
            </button>
          </div>
        </div>
      </form>

      {error && (
        <div className="mt-8 rounded-xl border border-red-300/60 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      )}

      {busy && (
        <div className="mt-8 rounded-2xl border border-black/10 bg-black/[0.03] p-4 dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center gap-3 text-sm">
            <Spinner />
            <span className="opacity-70">
              {phase === "uploading"
                ? `Uploading ${file ? formatBytes(file.size) : ""}… ${Math.round(uploadProgress * 100)}%`
                : phase === "starting"
                  ? "Starting transcription…"
                  : `Transcribing & detecting speakers… ${formatDuration(elapsed)}`}
            </span>
          </div>
          {phase === "uploading" && (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
              <div
                className="h-full rounded-full bg-violet-600 transition-[width] duration-300"
                style={{ width: `${Math.round(uploadProgress * 100)}%` }}
              />
            </div>
          )}
          {phase === "transcribing" && (
            <p className="mt-2 text-xs opacity-50">
              Usually takes a fraction of the recording&apos;s length — a 1-hour file is
              typically done in a few minutes.
            </p>
          )}
        </div>
      )}

      {result && (
        <>
          <div className="mt-8 flex items-center gap-4 rounded-2xl border border-black/10 bg-black/[0.03] p-4 dark:border-white/10 dark:bg-white/5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-600/10 text-violet-600 dark:text-violet-400">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5" aria-hidden>
                <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold">{sourceName}</p>
              <p className="mt-0.5 truncate text-sm opacity-60">
                {result.durationSeconds ? `${formatDuration(result.durationSeconds)} · ` : ""}
                {order.length} speaker{order.length === 1 ? "" : "s"} ·{" "}
                {result.utterances.length} turn{result.utterances.length === 1 ? "" : "s"}
                {result.language ? ` · ${result.language}` : ""}
              </p>
            </div>
          </div>

          <section className="mt-6 rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-black/8 p-3 dark:border-white/10">
              {order.map((label) => {
                const style = pickStyle(label);
                return (
                  <label key={label} className="flex items-center gap-1.5 text-xs">
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ${style.badge}`}
                    >
                      {label}
                    </span>
                    <input
                      type="text"
                      value={names[label] ?? ""}
                      onChange={(e) =>
                        setNames((prev) => ({ ...prev, [label]: e.target.value }))
                      }
                      placeholder={speakerName(label, order, {})}
                      className="w-28 rounded-md border border-black/10 bg-transparent px-2 py-1 outline-none transition focus:border-violet-500 dark:border-white/15"
                    />
                  </label>
                );
              })}
              {multiSpeaker && (
                <button
                  onClick={nameSpeakers}
                  disabled={namePhase === "naming"}
                  className="rounded-lg border border-violet-600/40 px-3 py-1.5 text-xs font-medium text-violet-700 transition hover:bg-violet-600/10 disabled:opacity-50 dark:text-violet-400"
                >
                  {namePhase === "naming" ? "Naming…" : "Name speakers (AI)"}
                </button>
              )}
            </div>

            {nameError && (
              <div className="border-b border-black/8 px-4 py-2.5 text-xs opacity-70 dark:border-white/10">
                {nameError}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 border-b border-black/8 p-3 dark:border-white/10">
              <label className="flex cursor-pointer items-center gap-1.5 text-xs opacity-70">
                <input
                  type="checkbox"
                  checked={showTimestamps}
                  onChange={(e) => setShowTimestamps(e.target.checked)}
                  className="accent-violet-600"
                />
                Timestamps
              </label>
              <div className="ml-auto flex flex-wrap gap-2">
                <ToolbarButton onClick={copyCurrent}>
                  {copied ? "Copied!" : "Copy"}
                </ToolbarButton>
                <ToolbarButton
                  onClick={() =>
                    download(`${filenameBase}.txt`, toSpeakerText(result.utterances, names))
                  }
                >
                  .txt
                </ToolbarButton>
                <ToolbarButton
                  onClick={() =>
                    download(
                      `${filenameBase}-timestamped.txt`,
                      toSpeakerText(result.utterances, names, { timestamps: true })
                    )
                  }
                >
                  .txt + time
                </ToolbarButton>
                <ToolbarButton
                  onClick={() => download(`${filenameBase}.srt`, toSrt(result.utterances, names))}
                >
                  .srt
                </ToolbarButton>
              </div>
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-5 sm:p-6">
              <div className="flex flex-col gap-5">
                {result.utterances.map((u, i) => (
                  <UtteranceRow
                    key={i}
                    utterance={u}
                    name={speakerName(u.speaker, order, names)}
                    style={pickStyle(u.speaker)}
                    showTimestamp={showTimestamps}
                  />
                ))}
              </div>
            </div>
          </section>
        </>
      )}

      <footer className="mt-auto pt-16 text-center text-xs opacity-40">
        Transcription &amp; diarization via AssemblyAI · Speaker naming via Claude
      </footer>
    </main>
  );
}

function UtteranceRow({
  utterance,
  name,
  style,
  showTimestamp,
}: {
  utterance: Utterance;
  name: string;
  style: { badge: string; text: string };
  showTimestamp: boolean;
}) {
  return (
    <div className="flex gap-3">
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${style.badge}`}
        aria-hidden
      >
        {utterance.speaker.slice(0, 2)}
      </span>
      <div className="min-w-0">
        <p className="text-sm">
          <span className={`font-semibold ${style.text}`}>{name}</span>
          {showTimestamp && (
            <span className="ml-2 font-mono text-xs tabular-nums opacity-50">
              {formatTimestamp(utterance.start)}
            </span>
          )}
        </p>
        <p className="mt-1 text-[15px] leading-relaxed">{utterance.text}</p>
      </div>
    </div>
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
