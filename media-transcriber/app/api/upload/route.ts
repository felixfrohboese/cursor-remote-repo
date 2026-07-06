import { getApiKey } from "@/lib/assemblyai";

export const maxDuration = 300;

/**
 * Streams the uploaded media file through to AssemblyAI's upload endpoint,
 * so the API key never reaches the browser. Returns the private upload URL
 * that the /api/transcribe route can reference.
 */
export async function POST(request: Request) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return Response.json(
      { error: "Transcription requires an ASSEMBLYAI_API_KEY on the server." },
      { status: 500 }
    );
  }
  if (!request.body) {
    return Response.json({ error: "No file received." }, { status: 400 });
  }

  try {
    const res = await fetch("https://api.assemblyai.com/v2/upload", {
      method: "POST",
      headers: {
        authorization: apiKey,
        "content-type": "application/octet-stream",
      },
      body: request.body,
      // Required by Node's fetch when the request body is a stream.
      duplex: "half",
    } as RequestInit);

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.upload_url) {
      console.error("AssemblyAI upload failed", res.status, data);
      return Response.json(
        { error: data?.error || "Upload to the transcription service failed." },
        { status: 502 }
      );
    }
    return Response.json({ uploadUrl: data.upload_url });
  } catch (err) {
    console.error("Upload error", err);
    return Response.json({ error: "Upload failed. Please try again." }, { status: 502 });
  }
}
