import type { Utterance } from "@/lib/assemblyai";

/** "1:23:45" / "12:34" / "0:07" */
export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const s = total % 60;
  const m = Math.floor((total / 60) % 60);
  const h = Math.floor(total / 3600);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Display name for a diarization label ("A", "B", …): an explicit rename wins,
 * otherwise "Speaker 1", "Speaker 2", … in order of first appearance.
 */
export function speakerName(
  label: string,
  order: string[],
  names: Record<string, string>
): string {
  const custom = names[label]?.trim();
  if (custom) return custom;
  const index = order.indexOf(label);
  return `Speaker ${index === -1 ? label : index + 1}`;
}

/** Diarization labels in order of first appearance. */
export function speakerOrder(utterances: Utterance[]): string[] {
  const order: string[] = [];
  for (const u of utterances) {
    if (!order.includes(u.speaker)) order.push(u.speaker);
  }
  return order;
}

export function toSpeakerText(
  utterances: Utterance[],
  names: Record<string, string>,
  { timestamps = false }: { timestamps?: boolean } = {}
): string {
  const order = speakerOrder(utterances);
  return utterances
    .map((u) => {
      const name = speakerName(u.speaker, order, names);
      const time = timestamps ? ` [${formatTimestamp(u.start)}]` : "";
      return `${name}${time}: ${u.text}`;
    })
    .join("\n\n");
}

export function toPlainText(utterances: Utterance[]): string {
  return utterances.map((u) => u.text).join("\n\n");
}

function srtTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const h = String(Math.floor(clamped / 3600)).padStart(2, "0");
  const m = String(Math.floor((clamped / 60) % 60)).padStart(2, "0");
  const s = String(Math.floor(clamped % 60)).padStart(2, "0");
  const ms = String(Math.round((clamped % 1) * 1000)).padStart(3, "0");
  return `${h}:${m}:${s},${ms}`;
}

/**
 * SubRip subtitles with speaker prefixes. Long turns are split into cues of
 * a few seconds each, timed proportionally to their share of the turn's words.
 */
export function toSrt(
  utterances: Utterance[],
  names: Record<string, string>,
  { maxCueChars = 90 }: { maxCueChars?: number } = {}
): string {
  const order = speakerOrder(utterances);
  const cues: { start: number; end: number; text: string }[] = [];

  for (const u of utterances) {
    const name = speakerName(u.speaker, order, names);
    const words = u.text.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    const chunks: string[] = [];
    let current = "";
    for (const word of words) {
      if (current && current.length + word.length + 1 > maxCueChars) {
        chunks.push(current);
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
    if (current) chunks.push(current);

    const duration = Math.max(u.end - u.start, chunks.length);
    let consumedWords = 0;
    let cursor = u.start;
    for (const chunk of chunks) {
      const chunkWords = chunk.split(/\s+/).length;
      consumedWords += chunkWords;
      const end = u.start + (consumedWords / words.length) * duration;
      cues.push({ start: cursor, end, text: `${name}: ${chunk}` });
      cursor = end;
    }
  }

  return cues
    .map(
      (cue, i) =>
        `${i + 1}\n${srtTime(cue.start)} --> ${srtTime(Math.max(cue.end, cue.start + 1))}\n${cue.text}`
    )
    .join("\n\n");
}
