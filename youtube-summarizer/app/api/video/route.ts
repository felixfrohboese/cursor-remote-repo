import { NextResponse } from "next/server";
import { fetchVideo, parseVideoId, TranscriptUnavailableError } from "@/lib/youtube";

export const maxDuration = 60;

export async function POST(request: Request) {
  let body: { url?: string; lang?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const videoId = parseVideoId(body.url ?? "");
  if (!videoId) {
    return NextResponse.json(
      { error: "That doesn't look like a YouTube URL. Try a link like https://www.youtube.com/watch?v=..." },
      { status: 400 }
    );
  }

  try {
    const result = await fetchVideo(videoId, body.lang);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof TranscriptUnavailableError) {
      console.error(err.message);
      return NextResponse.json(
        {
          error:
            "No transcript could be retrieved for this video. It may have captions disabled, be private/age-restricted, or YouTube may be blocking this server.",
        },
        { status: 422 }
      );
    }
    console.error("Unexpected error fetching video", err);
    return NextResponse.json({ error: "Something went wrong fetching the video." }, { status: 500 });
  }
}
