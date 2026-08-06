# Jarvish AI

An emotionally expressive AI study companion — talk to it, see it respond with a live-animated avatar, and trigger it hands-free just by saying its name.

Jarvish isn't just a chat window. It listens for a wake word, replies with voice, and animates a static avatar's mouth in real time to match what it's saying — all running instantly in the browser, no GPU or video generation required.

## Features

- **Conversational AI tutor** — powered by Google's Gemini API, answers questions across any subject
- **Wake-word activation** — say "Jarvish" out loud to start listening, hands-free, no need to click the mic
- **Voice input & output** — speech-to-text via Deepgram, text-to-speech via `edge-tts`
- **Live lip-sync avatar** — a static avatar image animates in real time using Web Audio API amplitude analysis, synced to the TTS audio as it plays — no pre-rendered video, no generation delay
- **Mood detection** — reads conversational tone and reflects it back with a mood indicator
- **Resizable split-panel UI** — drag to adjust the avatar/chat panel ratio, preference persists across reloads
- **Conversation history** — save, rename, reload, and delete past conversations

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI (Python), Uvicorn (ASGI server) |
| LLM | Google Gemini API |
| Speech-to-text | Deepgram |
| Text-to-speech | edge-tts |
| Frontend | Vanilla HTML/CSS/JS, Web Audio API, Web Speech API |
| Avatar rendering | Client-side canvas/CSS lip-sync (amplitude-driven) |

## Design Note: Why No Video-Generation Avatar

An earlier version of this project used [SadTalker](https://github.com/OpenTalker/SadTalker) to generate photorealistic talking-head video from a static photo. It worked, but required a GPU, multi-second render times per response, and produced videos in a codec many browsers couldn't play natively. For a real-time chat experience, that trade-off didn't hold up.

Jarvish now uses a lightweight, fully client-side approach instead: a single static avatar image with a small overlay region that stretches in sync with live TTS audio amplitude, via the Web Audio API's `AnalyserNode`. Zero backend processing per response, zero generation delay, and it runs in any modern browser.

## Getting Started

### Prerequisites

- Python 3.10+
- A [Google Gemini API key](https://ai.google.dev/)
- A [Deepgram API key](https://deepgram.com/)

### Setup

```bash
git clone https://github.com/vishesh1603/jarvish_ai.git
cd jarvish_ai

pip install -r requirements.txt

cp .env.example .env
# then edit .env and add your GEMINI_API_KEY and DEEPGRAM_API_KEY
```

### Run locally

```bash
uvicorn app:app --host 0.0.0.0 --port 5000
```

Open `http://localhost:5000` in Chrome or Edge (recommended, for full Web Speech API / wake-word support).

## Deployment

Deployed on [Render](https://render.com) as a standard FastAPI web service:

- **Build Command:** `pip install -r requirements.txt`
- **Start Command:** `uvicorn app:app --host 0.0.0.0 --port $PORT`

Environment variables (`GEMINI_API_KEY`, `DEEPGRAM_API_KEY`) are set in Render's dashboard, not committed to the repo.

## Environment Variables

See `.env.example` for the full list. Required:

```
GEMINI_API_KEY=your-gemini-key-here
DEEPGRAM_API_KEY=your-deepgram-key-here
```

## Project Structure

```
jarvish_ai/
├── app.py               # FastAPI entrypoint, API routes
├── main.py               # Core assistant logic
├── llm_client.py          # Gemini API integration
├── voice.py               # TTS (edge-tts) handling
├── emotion_engine.py       # Mood/tone detection
├── static/                # Frontend: HTML, CSS, JS, avatar assets
├── requirements.txt
└── .env.example
```

## Roadmap

- [ ] Phoneme-accurate lip-sync via [Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync) as an upgrade over amplitude-based animation
- [ ] Persistent conversation storage (currently local filesystem, not durable across free-tier deploy restarts)

## License

MIT
