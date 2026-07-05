import Anthropic from "@anthropic-ai/sdk";
import { formatTimestamp, type TranscriptSegment, type VideoMeta } from "@/lib/youtube";

export const maxDuration = 120;

// Keeps the prompt well inside the context window even for multi-hour videos.
const MAX_TRANSCRIPT_CHARS = 350_000;

const LANGUAGE_INSTRUCTIONS: Record<string, string> = {
  auto: "Write the summary in the same language as the transcript.",
  en: "Write the summary in English.",
  de: "Write the summary in German.",
};

function buildTranscriptText(segments: TranscriptSegment[]): { text: string; truncated: boolean } {
  const lines: string[] = [];
  let length = 0;
  for (const seg of segments) {
    const line = `[${formatTimestamp(seg.start)}] ${seg.text}`;
    if (length + line.length > MAX_TRANSCRIPT_CHARS) {
      return { text: lines.join("\n"), truncated: true };
    }
    lines.push(line);
    length += line.length + 1;
  }
  return { text: lines.join("\n"), truncated: false };
}

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server." },
      { status: 500 }
    );
  }

  let body: { segments?: TranscriptSegment[]; meta?: VideoMeta; language?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { segments, meta } = body;
  if (!Array.isArray(segments) || segments.length === 0 || !meta) {
    return Response.json({ error: "Missing transcript segments or video metadata." }, { status: 400 });
  }

  const languageInstruction =
    LANGUAGE_INSTRUCTIONS[body.language ?? "auto"] ?? LANGUAGE_INSTRUCTIONS.auto;
  const { text: transcriptText, truncated } = buildTranscriptText(segments);

  const prompt = `You are an expert at distilling long videos into summaries that save the reader from watching them.

Video title: ${meta.title}
Channel: ${meta.author}
${meta.durationSeconds ? `Duration: ${formatTimestamp(meta.durationSeconds)}` : ""}

Below is the full transcript with [timestamps].${truncated ? " (The transcript was truncated due to length — note this at the end of your summary.)" : ""}

<transcript>
${transcriptText}
</transcript>

Produce a summary in Markdown with exactly this structure:

## TL;DR
2–3 sentences capturing the core message.

## Key Takeaways
5–8 bullet points with the most important insights. Start each bullet with a bold 2–5 word label, then a concise explanation. Where useful, reference the timestamp like (12:34).

## Notable Details
2–4 bullets with specific facts, numbers, examples, tools, or quotes worth remembering. Skip this section if the video has none.

## Who Should Watch Anyway
One sentence on who would still benefit from watching the full video, or "Nobody — the summary covers it." if it adds nothing.

Rules:
- ${languageInstruction}
- Be specific and information-dense. No filler, no praise for the video, no meta-commentary.
- Only state things actually said in the transcript.`;

  const client = new Anthropic();
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

  try {
    const stream = client.messages.stream({
      model,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
      cancel() {
        stream.abort();
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    console.error("Anthropic API error", err);
    return Response.json({ error: "The summarization request failed." }, { status: 502 });
  }
}
