/**
 * Minimal server-side client for the AssemblyAI REST API.
 * Only the three calls this app needs: upload, create transcript, poll transcript.
 * https://www.assemblyai.com/docs
 */

const BASE_URL = "https://api.assemblyai.com/v2";

export interface Utterance {
  /** Diarization label from the model: "A", "B", "C", … */
  speaker: string;
  /** Seconds */
  start: number;
  /** Seconds */
  end: number;
  text: string;
  confidence: number;
}

export interface TranscriptResult {
  id: string;
  text: string;
  language: string | null;
  durationSeconds: number | null;
  utterances: Utterance[];
}

export type PollResponse =
  | { status: "processing" }
  | { status: "completed"; result: TranscriptResult }
  | { status: "error"; error: string };

export function getApiKey(): string | null {
  return process.env.ASSEMBLYAI_API_KEY || null;
}

function headers(apiKey: string): Record<string, string> {
  return { authorization: apiKey, "content-type": "application/json" };
}

export async function createTranscript(
  apiKey: string,
  options: {
    audioUrl: string;
    language?: string; // "auto" or an ISO code like "en" / "de"
    speakersExpected?: number;
  }
): Promise<{ id: string }> {
  const payload: Record<string, unknown> = {
    audio_url: options.audioUrl,
    speaker_labels: true,
    punctuate: true,
    format_text: true,
  };
  if (!options.language || options.language === "auto") {
    payload.language_detection = true;
  } else {
    payload.language_code = options.language;
  }
  if (options.speakersExpected && options.speakersExpected > 1) {
    payload.speakers_expected = Math.min(options.speakersExpected, 10);
  }

  const res = await fetch(`${BASE_URL}/transcript`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.id) {
    throw new Error(data?.error || `AssemblyAI returned ${res.status}`);
  }
  return { id: data.id as string };
}

interface RawUtterance {
  speaker: string;
  start: number; // ms
  end: number; // ms
  text: string;
  confidence: number;
}

export async function pollTranscript(apiKey: string, id: string): Promise<PollResponse> {
  const res = await fetch(`${BASE_URL}/transcript/${encodeURIComponent(id)}`, {
    headers: { authorization: apiKey },
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    throw new Error(data?.error || `AssemblyAI returned ${res.status}`);
  }

  if (data.status === "error") {
    return { status: "error", error: String(data.error || "Transcription failed.") };
  }
  if (data.status !== "completed") {
    return { status: "processing" };
  }

  const durationSeconds =
    typeof data.audio_duration === "number" ? data.audio_duration : null;

  let utterances: Utterance[] = Array.isArray(data.utterances)
    ? (data.utterances as RawUtterance[]).map((u) => ({
        speaker: u.speaker,
        start: u.start / 1000,
        end: u.end / 1000,
        text: u.text,
        confidence: u.confidence,
      }))
    : [];

  // Files without detectable speaker turns (e.g. music with sparse speech)
  // can come back with empty utterances but a valid text — synthesize one turn.
  if (utterances.length === 0 && data.text) {
    utterances = [
      {
        speaker: "A",
        start: 0,
        end: durationSeconds ?? 0,
        text: String(data.text),
        confidence: 1,
      },
    ];
  }

  return {
    status: "completed",
    result: {
      id: String(data.id),
      text: String(data.text ?? ""),
      language: data.language_code ? String(data.language_code) : null,
      durationSeconds,
      utterances,
    },
  };
}
