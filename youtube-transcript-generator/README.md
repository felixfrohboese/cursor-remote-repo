# YouTube Transcript Generator

Paste a YouTube URL and get the full one-to-one transcript of the video — with clickable timestamps, TXT/SRT downloads, and optional AI speaker labeling.

Sibling app of [`youtube-summarizer`](../youtube-summarizer): same battle-tested transcript pipeline, but the output is the verbatim transcript instead of a summary.

## Features

- **One-to-one transcript** — every caption segment, verbatim, grouped into readable blocks with timestamps that deep-link into the video.
- **Exports** — copy to clipboard, or download as plain `.txt`, timestamped `.txt`, or `.srt` (SubRip subtitles).
- **Speaker labeling (optional, AI)** — YouTube captions don't carry speaker identities (professional captions occasionally mark speaker changes with `>>`, which is preserved). The "Speakers (AI)" view sends the verbatim transcript to Claude, which reorganizes it into speaker turns — `**Name [12:34]:** …` — inferring real names from context (introductions, forms of address) and falling back to "Speaker 1/2/…". The wording stays verbatim; only caption fragments are joined.
- **Language selection** — Auto (video default), German, English (when the video offers those caption tracks).

## How transcripts are fetched

The server extracts captions using a fallback chain, so it doesn't depend on a single method:

1. [`youtubei.js`](https://github.com/LuanRT/YouTube.js) (Innertube) via the dedicated transcript endpoint — talks to YouTube's internal API like the official clients do; also provides title, channel, and duration.
2. Raw caption track download — grabs the timedtext URL from the Innertube player response and parses it directly.
3. [`youtube-transcript`](https://github.com/Kakulukian/youtube-transcript) — makes its own player request with browser-like headers; different failure modes.
4. [Supadata](https://supadata.ai/) (optional) — a hosted transcript API used only if `SUPADATA_API_KEY` is set; bypasses YouTube's datacenter-IP blocking.

Additionally, if `PROXY_URL` is set, all direct YouTube requests are routed through that proxy (e.g. a residential proxy).

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS · Anthropic API (speaker labeling only) · Vercel-ready

## Local development

```bash
npm install
cp .env.example .env.local   # optional: add ANTHROPIC_API_KEY for speaker labeling
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and paste a YouTube link.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | No | Enables the AI speaker-labeling view |
| `ANTHROPIC_MODEL` | No | Claude model for speaker labeling (default: `claude-sonnet-4-5`) |
| `PROXY_URL` | No | Proxy for direct YouTube requests (`http://user:pass@host:port`) |
| `SUPADATA_API_KEY` | No | Enables the Supadata fallback for transcript fetching |

## Deploying to Vercel

1. Import the repo and set the **Root Directory** to `youtube-transcript-generator`.
2. Add the env vars you want (none are strictly required for plain transcripts).
3. Deploy.

> **Note on production transcript fetching:** YouTube aggressively rate-limits and blocks requests from cloud provider IP ranges. Locally the free strategies almost always work; on Vercel they can fail for some videos. Setting `SUPADATA_API_KEY` gives the app a reliable fallback (their free tier covers ~100 videos/month).

## Notes

- Supported URL formats: `watch?v=`, `youtu.be/`, `/shorts/`, `/live/`, `/embed/`, or a bare video ID.
- On speaker accuracy: attribution is inferred from the text (dialogue structure, names, `>>` markers), not from the audio. For interviews and podcasts it works well; for fast crosstalk between similar voices, no text-only method can be perfect.
- Speaker labeling caps input at ~120k characters (roughly 3–4 hours of speech) so the verbatim output fits the model's output limit; longer videos get a `[Transcript truncated]` marker.
