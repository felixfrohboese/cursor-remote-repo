import Anthropic from "@anthropic-ai/sdk";
import { formatTimestamp, type TranscriptSegment, type VideoMeta } from "@/lib/youtube";

export const maxDuration = 300;

// Speaker labeling reproduces the whole transcript, so both input and output
// are large. Cap input so prompt + verbatim output fit comfortably.
const MAX_TRANSCRIPT_CHARS = 120_000;

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      {
        error:
          "Speaker labeling requires an ANTHROPIC_API_KEY on the server. The plain transcript works without it.",
      },
      { status: 500 }
    );
  }

  let body: { segments?: TranscriptSegment[]; meta?: VideoMeta };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { segments, meta } = body;
  if (!Array.isArray(segments) || segments.length === 0 || !meta) {
    return Response.json({ error: "Missing transcript segments or video metadata." }, { status: 400 });
  }

  let transcriptText = "";
  let truncated = false;
  for (const seg of segments) {
    const line = `[${formatTimestamp(seg.start)}] ${seg.text}\n`;
    if (transcriptText.length + line.length > MAX_TRANSCRIPT_CHARS) {
      truncated = true;
      break;
    }
    transcriptText += line;
  }

  const prompt = `The following is a verbatim caption transcript of a YouTube video, one caption segment per line with [timestamps].

Video title: ${meta.title}
Channel: ${meta.author}

<transcript>
${transcriptText}
</transcript>

Rewrite this transcript organized into speaker turns:

- Determine from context how many distinct speakers there are and who is talking when (questions vs. answers, names used to address each other, interviewer vs. guest, ">>" markers, host introductions, etc.).
- Use real names as labels when the transcript makes them clear (e.g. the host introduces a guest); otherwise use "Speaker 1", "Speaker 2", … consistently. For a single-speaker video, label everything with that one speaker.
- Format each turn as:

**<Name> [<timestamp of turn start>]:** <everything said in that turn as flowing text>

- Separate turns with a blank line.
- Reproduce the spoken words VERBATIM — do not paraphrase, summarize, correct grammar, or omit anything. Only fix caption-splitting (join fragments into sentences) and remove ">>" markers.
- Start your output with a single line "Speakers: <comma-separated list>" followed by a blank line, then the transcript. No other commentary.${truncated ? '\n- The input was truncated for length; after the last turn, append a final line: "[Transcript truncated]".' : ""}`;

  const client = new Anthropic();
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

  try {
    const stream = client.messages.stream({
      model,
      max_tokens: 60_000,
      messages: [{ role: "user", content: prompt }],
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
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
    return Response.json({ error: "Speaker labeling failed." }, { status: 502 });
  }
}
