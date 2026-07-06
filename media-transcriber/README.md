# Audio & Video Transcriber

Upload any audio or video file — or paste a direct media URL — and get a high-quality transcript with **speaker diarization**: every statement attributed to the person who said it (Speaker 1, Speaker 2, …), with timestamps, exports, and optional AI speaker naming.

Sibling app of [`youtube-summarizer`](../youtube-summarizer) and [`youtube-transcript-generator`](../youtube-transcript-generator): same stack and look, but for your own recordings instead of YouTube videos.

## Features

- **Any common format** — audio (MP3, WAV, M4A, AAC, OGG, OPUS, FLAC, WMA, AMR) and video (MP4, MPEG/MPG, MOV, WEBM, MKV, AVI, M4V, 3GP, WMV). Video is handled directly; the audio track is extracted server-side by the transcription service. Files up to 5 GB / 10 hours.
- **Real speaker diarization** — speakers are separated from the *audio* (voice characteristics), not guessed from text. Each turn carries a speaker label, timestamp, and the verbatim statement. Up to 10 speakers; an optional "Speakers" hint improves accuracy when you know the count.
- **AI speaker naming (optional)** — with an `ANTHROPIC_API_KEY` set, the "Name speakers (AI)" button asks Claude to work out real names from the conversation itself (self-introductions, hosts introducing guests, people addressing each other). Names are only assigned when the transcript makes them clear — no inventions. You can also rename any speaker manually at any time.
- **Exports** — copy to clipboard, or download as speaker-labeled `.txt`, timestamped `.txt`, or `.srt` subtitles (with speaker prefixes).
- **Language** — auto-detect (default), German, or English.
- **Two input modes** — drag-and-drop file upload (streamed through the server, upload progress shown) or a direct `https://…` media URL that the transcription service fetches itself.

## How it works

1. **Upload** — the browser streams the file to `/api/upload`, which pipes it straight through to AssemblyAI's private upload endpoint (the API key never reaches the client). URL mode skips this step.
2. **Transcribe** — `/api/transcribe` creates a transcription job with `speaker_labels` (diarization) enabled and language auto-detection; the client polls until it completes.
3. **Render** — the diarized utterances are shown as speaker turns with colored badges and timestamps; a legend lets you rename speakers inline.
4. **Name speakers (optional)** — `/api/speakers` sends a digest of the diarized transcript to Claude, which returns a strict JSON mapping from diarization label to real name (or null when unclear).

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS · [AssemblyAI](https://www.assemblyai.com/) (speech-to-text + diarization) · Anthropic API (speaker naming only) · Vercel-ready

## Local development

```bash
npm install
cp .env.example .env.local   # add your ASSEMBLYAI_API_KEY (and optionally ANTHROPIC_API_KEY)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and drop in a recording.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `ASSEMBLYAI_API_KEY` | Yes | AssemblyAI key for transcription & diarization (free tier includes generous credits) |
| `ANTHROPIC_API_KEY` | No | Enables the AI speaker-naming button |
| `ANTHROPIC_MODEL` | No | Claude model for speaker naming (default: `claude-sonnet-4-5`) |

## Deploying to Vercel

1. Import the repo and set the **Root Directory** to `media-transcriber`.
2. Add `ASSEMBLYAI_API_KEY` (and optionally `ANTHROPIC_API_KEY`) in the project settings.
3. Deploy.

> **Note on file uploads in production:** Vercel serverless functions cap request bodies at ~4.5 MB, so the upload proxy only works for small files there. For larger recordings on Vercel, use the **Media URL** mode (point it at a file in cloud storage / a presigned URL) — AssemblyAI downloads it directly, with no size issue. Locally (`npm run dev` / a Node server) uploads of any size work.

## Notes

- Diarization quality: separation is excellent for meetings, interviews, and podcasts; heavy crosstalk between similar voices is inherently hard for any system.
- Speaker naming is text-based: if nobody says a name in the recording, the AI correctly leaves the "Speaker 1/2/…" labels in place — rename them manually instead.
- Transcription typically takes a fraction of the recording's length (a 1-hour file in a few minutes).
