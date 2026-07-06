import { createTranscript, getApiKey, pollTranscript } from "@/lib/assemblyai";

export const maxDuration = 60;

const LANGUAGES = new Set(["auto", "de", "en"]);

/** Creates a transcription job (with speaker diarization) and returns its id. */
export async function POST(request: Request) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return Response.json(
      { error: "Transcription requires an ASSEMBLYAI_API_KEY on the server." },
      { status: 500 }
    );
  }

  let body: { audioUrl?: string; language?: string; speakersExpected?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const audioUrl = typeof body.audioUrl === "string" ? body.audioUrl.trim() : "";
  if (!/^https?:\/\//i.test(audioUrl)) {
    return Response.json({ error: "Missing or invalid media URL." }, { status: 400 });
  }
  const language = LANGUAGES.has(body.language ?? "") ? body.language : "auto";
  const speakersExpected =
    typeof body.speakersExpected === "number" && Number.isFinite(body.speakersExpected)
      ? Math.floor(body.speakersExpected)
      : undefined;

  try {
    const { id } = await createTranscript(apiKey, { audioUrl, language, speakersExpected });
    return Response.json({ id });
  } catch (err) {
    console.error("Create transcript failed", err);
    const message =
      err instanceof Error ? err.message : "Could not start the transcription.";
    return Response.json({ error: message }, { status: 502 });
  }
}

/** Polls a transcription job: ?id=<transcript id> */
export async function GET(request: Request) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return Response.json(
      { error: "Transcription requires an ASSEMBLYAI_API_KEY on the server." },
      { status: 500 }
    );
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return Response.json({ error: "Missing transcript id." }, { status: 400 });
  }

  try {
    const result = await pollTranscript(apiKey, id);
    return Response.json(result);
  } catch (err) {
    console.error("Poll transcript failed", err);
    return Response.json({ error: "Could not check the transcription status." }, { status: 502 });
  }
}
