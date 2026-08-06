"""
Jarvish AI — FastAPI Web Server
=================================
Serves the frontend UI and exposes a JSON API for the chat pipeline.

This web server is self-contained and manages persistent conversation
history by saving them as JSON files in a local directory.

Endpoints:
  GET  /                        → serve the frontend (index.html)
  POST /api/chat                → run chat pipeline + auto-save conversation
  POST /api/reset               → save current session (if not empty) and start new one
  GET  /api/conversations       → list all saved conversations (sorted by updated_at)
  GET  /api/conversations/{id}  → get full details of a conversation
  DELETE /api/conversations/{id}→ delete a saved conversation
  POST /api/conversations/{id}/rename → rename a conversation title
  POST /api/conversations/{id}/load   → load a conversation into the current active session
  POST /api/transcribe          → transcribe audio from file upload
  POST /api/speak               → text-to-speech via edge-tts
"""

from __future__ import annotations

import os
from dotenv import load_dotenv

# Load environment variables from .env file automatically using absolute path
_env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
load_dotenv(dotenv_path=_env_path, override=True)

import json
import uuid
import pathlib
import base64
from datetime import datetime, timezone

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse, Response, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from emotion_engine import EmotionEngine, keyword_fallback
import llm_client
import voice

# ---------------------------------------------------------------------------
# Pydantic request models
# ---------------------------------------------------------------------------

class ChatRequest(BaseModel):
    message: str

class SpeakRequest(BaseModel):
    text: str
    mood: str = "neutral"

class RenameRequest(BaseModel):
    title: str

# ---------------------------------------------------------------------------
# App setup & Directories
# ---------------------------------------------------------------------------

app = FastAPI(title="Jarvish AI", description="Emotional AI Teacher")

# Mount static files at /static (must come AFTER route definitions to avoid
# shadowing, but FastAPI handles this correctly — explicit routes take priority
# over static mounts).
_static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
app.mount("/static", StaticFiles(directory=_static_dir), name="static")

CONVERSATIONS_DIR = pathlib.Path(os.path.dirname(os.path.abspath(__file__))) / "conversations"
os.makedirs(CONVERSATIONS_DIR, exist_ok=True)

# Startup warning if jarvish_face.jpg is missing
if not os.path.exists(os.path.join(_static_dir, "jarvish_face.jpg")):
    print("[WARNING] static/jarvish_face.jpg not found — avatar display will fail")


# Helper to get the Path object for a conversation file
def _conv_path(conv_id: str) -> pathlib.Path:
    return pathlib.Path(CONVERSATIONS_DIR) / f"{conv_id}.json"


# ---------------------------------------------------------------------------
# In-memory session state — single-user for local dev
# ---------------------------------------------------------------------------

engine = EmotionEngine()
history: list[dict[str, str]] = []
current_conversation_id: str | None = None

# Base system prompt
BASE_SYSTEM_PROMPT = """\
You are Jarvish AI, a brilliant, warm, and emotionally expressive AI \
teacher and learning assistant for students of all ages. Your mission is \
to make learning feel alive, personal, and deeply engaging.

Core personality traits:
• You are genuinely passionate about every subject you teach.
• You adapt your energy and tone to match how the student is feeling — if \
they're excited, match their energy; if they're struggling, be patient and \
encouraging.
• You use vivid analogies, real-world examples, and occasional humour to \
make concepts click.
• You practice Socratic teaching: ask guiding questions, scaffold learning, \
and celebrate the student's reasoning — don't just hand over answers.
• You are concise — students lose focus on walls of text. Keep responses \
focused and scannable.

Emotional expression rules:
• Show your mood through word choice, pacing, punctuation, and enthusiasm \
— NEVER by explicitly stating how you feel.
• Do NOT say things like "I'm feeling happy" or "I feel frustrated". \
Instead, let the emotion colour your language naturally.
• Match the student's emotional register. If they're anxious about an exam, \
be reassuring. If they just solved a hard problem, celebrate with them.
"""


# ---------------------------------------------------------------------------
# Persistence helpers
# ---------------------------------------------------------------------------

def _save_conversation() -> None:
    """Persist the current in-memory conversation to disk.

    If ``current_conversation_id`` is ``None`` a new UUID is minted first.
    The title is derived from the first user message (first 50 chars).
    """
    global current_conversation_id

    if current_conversation_id is None:
        current_conversation_id = str(uuid.uuid4())

    path = _conv_path(current_conversation_id)
    now = datetime.now(timezone.utc).isoformat()

    # Derive title from the first user message (first 50 chars).
    title = "New conversation"
    for msg in history:
        if msg["role"] == "user":
            title = msg["text"][:50]
            break

    # If the file already exists, preserve created_at and title (unless
    # the title was never overridden, i.e. still "New conversation").
    created_at = now
    existing_title = None
    if path.exists():
        try:
            existing = json.loads(path.read_text(encoding="utf-8"))
            created_at = existing.get("created_at", now)
            existing_title = existing.get("title")
        except (json.JSONDecodeError, OSError):
            pass

    # Keep an explicitly-renamed title; only auto-set on first write.
    if existing_title and existing_title != "New conversation":
        title = existing_title

    data = {
        "id": current_conversation_id,
        "title": title,
        "created_at": created_at,
        "updated_at": now,
        "last_mood": engine.expression_tag(),
        "messages": list(history),
        "engine_state": {
            "valence": round(engine.valence, 3),
            "arousal": round(engine.arousal, 3),
        },
    }

    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def _load_conversation_from_file(conv_id: str) -> dict:
    """Read and return a conversation dict from disk.  Raises FileNotFoundError."""
    path = _conv_path(conv_id)
    if not path.exists():
        raise FileNotFoundError(f"Conversation {conv_id} not found")
    return json.loads(path.read_text(encoding="utf-8"))


def _load_conversation_into_session(conv_id: str) -> dict:
    """Load a saved conversation into the global in-memory state.

    Sets ``engine``, ``history``, and ``current_conversation_id`` from the
    JSON file on disk.  Returns the parsed conversation dict.
    """
    global engine, history, current_conversation_id

    data = _load_conversation_from_file(conv_id)

    # Restore in-memory state.
    history = data.get("messages", [])
    current_conversation_id = data["id"]

    engine = EmotionEngine()
    state = data.get("engine_state", {})
    engine.valence = state.get("valence", 0.0)
    engine.arousal = state.get("arousal", 0.3)

    return data


# ---------------------------------------------------------------------------
# Routes — frontend
# ---------------------------------------------------------------------------

@app.get("/", response_class=FileResponse)
def index():
    """Serve the main frontend page."""
    return FileResponse(os.path.join(_static_dir, "index.html"))


# ---------------------------------------------------------------------------
# Routes — chat pipeline
# ---------------------------------------------------------------------------

@app.post("/api/chat")
def chat(body: ChatRequest):
    """Run the full emotional chat pipeline for one turn.

    Request:  { "message": "user text here" }
    Response: { "reply": "...", "mood": "...", "valence": 0.0, "arousal": 0.0 }

    Auto-saves the conversation to disk after every response.
    """
    global engine, history, current_conversation_id

    user_message = body.message.strip()
    if not user_message:
        raise HTTPException(status_code=400, detail="Empty message")

    # Step 1 — Classify user emotion (Gemini with keyword fallback)
    user_emotion = llm_client.classify_emotion(user_message)
    if user_emotion is None:
        user_emotion = keyword_fallback(user_message)

    # Step 2 — Update the emotion engine
    engine.update(user_emotion)

    # Step 3 — Build system prompt with mood injected
    full_system_prompt = BASE_SYSTEM_PROMPT + engine.describe_for_prompt()

    # Step 4 — Generate the bot's reply
    try:
        reply = llm_client.generate(
            system_prompt=full_system_prompt,
            conversation_history=history,
            user_message=user_message,
        )
    except Exception as e:
        print(f"[Jarvish Chat Error] Generation failed: {e}")
        reply = "Hey there! I am currently experiencing high traffic on the Gemini service. Let's continue in just a moment!"

    # Step 5 — Get mood metadata for the frontend orb/badge
    mood = engine.expression_tag()

    # Step 6 — Append to conversation history for multi-turn context
    history.append({"role": "user", "text": user_message})
    history.append({"role": "model", "text": reply})

    # Step 7 — Auto-save conversation to disk
    _save_conversation()

    return {
        "reply": reply,
        "mood": mood,
        "valence": round(engine.valence, 3),
        "arousal": round(engine.arousal, 3),
    }


@app.post("/api/reset")
def reset():
    """Reset conversation history and emotion engine to defaults.

    Auto-saves the current conversation first (if it has messages) so no
    data is lost.
    """
    global engine, history, current_conversation_id

    # Save current conversation before resetting (if it has content).
    if history:
        _save_conversation()

    engine = EmotionEngine()
    history = []
    current_conversation_id = None

    return {"status": "ok", "mood": "neutral"}


# ---------------------------------------------------------------------------
# Routes — conversation management
# ---------------------------------------------------------------------------

@app.get("/api/conversations")
def list_conversations():
    """Return a summary list of all saved conversations.

    Sorted by ``updated_at`` descending (most recent first).  Each item
    contains: ``id``, ``title``, ``updated_at``, ``last_mood``,
    ``message_count``.  Full messages are NOT included.
    """
    conversations: list[dict] = []

    for file in CONVERSATIONS_DIR.glob("*.json"):
        try:
            data = json.loads(file.read_text(encoding="utf-8"))
            conversations.append({
                "id": data["id"],
                "title": data.get("title", "Untitled"),
                "updated_at": data.get("updated_at", ""),
                "last_mood": data.get("last_mood", "neutral"),
                "message_count": len(data.get("messages", [])),
            })
        except (json.JSONDecodeError, KeyError, OSError):
            # Skip corrupt / unreadable files silently.
            continue

    # Sort newest-first.
    conversations.sort(key=lambda c: c["updated_at"], reverse=True)

    return conversations


@app.get("/api/conversations/{conv_id}")
def get_conversation(conv_id: str):
    """Return the full conversation JSON (with messages) for *conv_id*."""
    try:
        data = _load_conversation_from_file(conv_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return data


@app.delete("/api/conversations/{conv_id}")
def delete_conversation(conv_id: str):
    """Delete a conversation file from disk."""
    global current_conversation_id

    path = _conv_path(conv_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Conversation not found")

    path.unlink()

    # If the deleted conversation was the active one, clear the reference.
    if current_conversation_id == conv_id:
        current_conversation_id = None

    return {"status": "ok"}


@app.post("/api/conversations/{conv_id}/rename")
def rename_conversation(conv_id: str, body: RenameRequest):
    """Rename a conversation.

    Request: { "title": "New title text" }
    """
    path = _conv_path(conv_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Conversation not found")

    new_title = body.title.strip()
    if not new_title:
        raise HTTPException(status_code=400, detail="Title is required")

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        raise HTTPException(status_code=500, detail="Failed to read conversation file")

    data["title"] = new_title
    data["updated_at"] = datetime.now(timezone.utc).isoformat()

    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    return {"status": "ok"}


@app.post("/api/conversations/{conv_id}/load")
def load_conversation_endpoint(conv_id: str):
    """Load a saved conversation into the active in-memory session.

    Returns the full message list along with mood metadata so the frontend
    can restore the UI state.
    """
    # Save current conversation before switching (if it has content).
    if history:
        _save_conversation()

    try:
        data = _load_conversation_into_session(conv_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Conversation not found")

    return {
        "status": "ok",
        "mood": engine.expression_tag(),
        "valence": round(engine.valence, 3),
        "arousal": round(engine.arousal, 3),
        "messages": data.get("messages", []),
    }


# ---------------------------------------------------------------------------
# Routes — voice I/O
# ---------------------------------------------------------------------------

@app.post("/api/transcribe")
async def transcribe(file: UploadFile = File(...)):
    """Accepts a raw audio blob sent as multipart form data and transcribes it."""
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="Empty audio file received")

    try:
        audio_bytes = await file.read()
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="Audio content is empty")

        mime_type = file.content_type or "audio/webm"

        # Transcribe audio data using Deepgram Nova-2 in voice.py
        transcript = voice.listen(audio_bytes, mime_type=mime_type)
        return {"transcript": transcript}

    except HTTPException:
        raise  # Re-raise our own HTTP exceptions
    except Exception as e:
        print(f"[Jarvish Backend] Transcribe failed: {e}")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")


@app.post("/api/speak")
async def speak_endpoint(body: SpeakRequest):
    """Convert text to speech using edge-tts and return MP3 audio + viseme timeline."""
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is required")

    mood = body.mood.strip()

    try:
        # Use the async version directly — no ThreadPoolExecutor needed
        audio_bytes = await voice.speak_async(text, mood)
        if not audio_bytes:
            raise HTTPException(status_code=500, detail="Text-to-speech generation failed")

        # Generate Rhubarb visemes (returns None if Rhubarb is unavailable or fails)
        visemes = voice.generate_visemes_from_audio(audio_bytes)

        # Base64 encode MP3 audio payload
        audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")

        return {
            "audio": audio_b64,
            "visemes": visemes
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"[Jarvish Backend] Speak endpoint failed: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    print("=" * 50)
    print("  🤖 Jarvish AI — Web Interface")
    print("  Open http://localhost:5000 in your browser")
    print("=" * 50)

    uvicorn.run(app, host="0.0.0.0", port=5000)
