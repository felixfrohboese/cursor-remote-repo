# YouTube Summarizer

Paste a YouTube URL and get an AI-generated summary with the key takeaways in seconds — no more watching 40-minute videos for three key points.

## How it works

1. **Transcript** — The server extracts the video's captions using a fallback chain, so it doesn't depend on a single method:
   - [`youtubei.js`](https://github.com/LuanRT/YouTube.js) (Innertube) via the dedicated transcript endpoint — talks to YouTube's internal API like the official clients do; also provides title, channel, and duration.
   - Raw caption track download — grabs the timedtext URL from the Innertube player response and parses it directly; works on videos where the transcript endpoint errors.
   - [`youtube-transcript`](https://github.com/Kakulukian/youtube-transcript) — makes its own player request with browser-like headers; different failure modes, catches videos the first strategies miss.
   - [Supadata](https://supadata.ai/) (optional) — a hosted transcript API used only if `SUPADATA_API_KEY` is set. Useful in production because YouTube frequently blocks datacenter IPs (Vercel/AWS), which breaks the direct strategies.
   - Additionally, if `PROXY_URL` is set, all direct YouTube requests are routed through that proxy (e.g. a residential proxy), which is the other standard way around IP blocks.
2. **Summary** — The transcript (with timestamps) is sent to the Anthropic API (Claude), which streams back a structured Markdown summary: TL;DR, key takeaways with timestamps, notable details, and whether the full video is still worth watching.

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS · Anthropic API · Vercel-ready

## Local development

```bash
npm install
cp .env.example .env.local   # add your ANTHROPIC_API_KEY
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and paste a YouTube link.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for summarization |
| `ANTHROPIC_MODEL` | No | Claude model to use (default: `claude-sonnet-4-5`) |
| `PROXY_URL` | No | Proxy for direct YouTube requests (`http://user:pass@host:port`) |
| `SUPADATA_API_KEY` | No | Enables the Supadata fallback for transcript fetching |

## Deploying to Vercel

1. Push this directory to a Git repo (or import the monorepo and set the **Root Directory** to `youtube-summarizer`).
2. Add `ANTHROPIC_API_KEY` (and optionally `SUPADATA_API_KEY`) in the Vercel project settings.
3. Deploy.

> **Note on production transcript fetching:** YouTube aggressively rate-limits and blocks requests from cloud provider IP ranges. Locally the free strategies almost always work; on Vercel they can fail for some videos. Setting `SUPADATA_API_KEY` gives the app a reliable third fallback (their free tier covers ~100 videos/month).

## Notes

- Supported URL formats: `watch?v=`, `youtu.be/`, `/shorts/`, `/live/`, `/embed/`, or a bare video ID.
- Summary language: auto (follows the video), German, or English.
- Very long transcripts are truncated at ~350k characters before summarization (multi-hour videos still fit).
