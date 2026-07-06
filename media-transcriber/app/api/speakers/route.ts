import Anthropic from "@anthropic-ai/sdk";
import type { Utterance } from "@/lib/assemblyai";
import { formatTimestamp, speakerOrder } from "@/lib/format";

export const maxDuration = 120;

// The model only needs enough context to spot introductions and forms of
// address; the full transcript of a long recording is unnecessary.
const MAX_DIGEST_CHARS = 60_000;

/**
 * Infers real speaker names from the conversation itself ("I'm Anna…",
 * "Thanks, Ben"). Returns a mapping from diarization label to name, only
 * for speakers whose name is actually stated or clearly implied.
 */
export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      {
        error:
          "Speaker naming requires an ANTHROPIC_API_KEY on the server. Transcription and manual renaming work without it.",
      },
      { status: 500 }
    );
  }

  let body: { utterances?: Utterance[]; filename?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const utterances = Array.isArray(body.utterances) ? body.utterances : [];
  if (utterances.length === 0) {
    return Response.json({ error: "Missing transcript utterances." }, { status: 400 });
  }

  const labels = speakerOrder(utterances);

  let digest = "";
  for (const u of utterances) {
    const line = `Speaker ${u.speaker} [${formatTimestamp(u.start)}]: ${u.text}\n`;
    if (digest.length + line.length > MAX_DIGEST_CHARS) break;
    digest += line;
  }

  const prompt = `The following is a diarized transcript of an audio/video recording${body.filename ? ` (file: ${JSON.stringify(body.filename)})` : ""}. Speakers were separated automatically and are labeled ${labels.join(", ")}.

<transcript>
${digest}
</transcript>

Work out the real names of the speakers from the conversation itself: self-introductions ("I'm …", "my name is …"), hosts introducing guests, speakers addressing each other by name, or other unambiguous context.

Reply with ONLY a JSON object mapping each speaker label to a name or null, e.g.:
{"A": "Anna Schmidt", "B": null}

Rules:
- Include every label: ${labels.join(", ")}.
- Use null when the transcript does not make that speaker's name reasonably clear. Never invent names.
- A name can be a first name only if that is all the transcript provides.
- If a speaker is clearly identified by role rather than name (e.g. the host of a named show, an interviewer), you may use a short role like "Host" or "Interviewer".
- No commentary, no markdown fences — just the JSON object.`;

  const client = new Anthropic();
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

  try {
    const message = await client.messages.create({
      model,
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });
    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Model did not return JSON.");
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    const names: Record<string, string> = {};
    for (const label of labels) {
      const value = parsed[label];
      if (typeof value === "string" && value.trim()) {
        names[label] = value.trim();
      }
    }
    return Response.json({ names });
  } catch (err) {
    console.error("Speaker naming failed", err);
    return Response.json({ error: "Speaker naming failed." }, { status: 502 });
  }
}
