import { formatTimestamp, type TranscriptSegment } from "@/lib/youtube";

export interface TranscriptBlock {
  start: number;
  text: string;
}

/**
 * Group raw caption segments into readable blocks for display: a new block
 * starts on a long silence gap, on a native speaker-change marker (">>",
 * used in professionally captioned videos), or once a block grows large.
 */
export function groupSegments(
  segments: TranscriptSegment[],
  { maxChars = 400, gapSeconds = 5 }: { maxChars?: number; gapSeconds?: number } = {}
): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  let current: TranscriptBlock | null = null;
  let lastEndGuess = 0;

  for (const seg of segments) {
    const startsNewSpeaker = /^>>/.test(seg.text);
    const bigGap = seg.start - lastEndGuess > gapSeconds;
    if (!current || startsNewSpeaker || bigGap || current.text.length >= maxChars) {
      if (current) blocks.push(current);
      current = { start: seg.start, text: seg.text };
    } else {
      current.text += ` ${seg.text}`;
    }
    // Captions rarely include durations here; estimate ~4s per segment for gap detection.
    lastEndGuess = seg.start + 4;
  }
  if (current) blocks.push(current);
  return blocks;
}

/** Continuous prose, paragraph per block — for reading or pasting elsewhere. */
export function toPlainText(segments: TranscriptSegment[]): string {
  return groupSegments(segments)
    .map((b) => b.text.replace(/^>>\s*/, ""))
    .join("\n\n");
}

/** One line per caption segment with its timestamp. */
export function toTimestampedText(segments: TranscriptSegment[]): string {
  return segments.map((s) => `[${formatTimestamp(s.start)}] ${s.text}`).join("\n");
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
 * SubRip subtitle format. Caption sources don't reliably expose durations,
 * so each cue ends where the next begins (capped at 6s, floor of 1s).
 */
export function toSrt(segments: TranscriptSegment[]): string {
  return segments
    .map((seg, i) => {
      const nextStart = segments[i + 1]?.start;
      const end =
        nextStart !== undefined
          ? Math.min(nextStart, seg.start + 6)
          : seg.start + 4;
      const safeEnd = Math.max(end, seg.start + 1);
      return `${i + 1}\n${srtTime(seg.start)} --> ${srtTime(safeEnd)}\n${seg.text}`;
    })
    .join("\n\n");
}
