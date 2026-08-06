"""
Jarvish AI — FastAPI Web Server with Auth, SQLite DB & RAG Knowledge Base
==========================================================================
Serves the frontend UI and exposes APIs for:
  - User Authentication (JWT + Bcrypt)
  - Emotional Chat Pipeline & LLM Generation (with RAG Knowledge Context)
  - Persistent SQLite Database (SQLAlchemy Users, Conversations, Messages, Documents)
  - RAG Document Knowledge Base (Upload PDF/TXT, Vector Embeddings via ChromaDB)
  - Voice I/O (STT via Deepgram Nova-2, TTS via edge-tts)
"""

from __future__ import annotations

import os
import json
import uuid
import pathlib
import base64
from datetime import datetime, timezone
from typing import Optional

from dotenv import load_dotenv

# Load environment variables from .env file automatically using absolute path
_env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
load_dotenv(dotenv_path=_env_path, override=True)

from fastapi import FastAPI, UploadFile, File, HTTPException, Depends, status, Form
from fastapi.responses import FileResponse, Response, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

# Local Modules
from database import init_db, get_db, User, Conversation, Message, Document
from auth import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
    get_optional_user,
)
from rag_store import (
    add_document_to_rag,
    query_rag_knowledge,
    delete_document_from_rag,
)
from emotion_engine import EmotionEngine, keyword_fallback
import llm_client
import voice

# ---------------------------------------------------------------------------
# Pydantic Request & Response Models
# ---------------------------------------------------------------------------

class SignupRequest(BaseModel):
    email: str
    password: str

class LoginRequest(BaseModel):
    email: str
    password: str

class ChatRequest(BaseModel):
    message: str
    conversation_id: Optional[str] = None

class SpeakRequest(BaseModel):
    text: str
    mood: str = "neutral"

class RenameRequest(BaseModel):
    title: str

# ---------------------------------------------------------------------------
# Application Initialization & Setup
# ---------------------------------------------------------------------------

app = FastAPI(title="Jarvish AI", description="Emotional AI Teacher with Auth, DB & RAG")

@app.on_event("startup")
def on_startup():
    init_db()

_static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
app.mount("/static", StaticFiles(directory=_static_dir), name="static")

if not os.path.exists(os.path.join(_static_dir, "jarvish_face.jpg")):
    print("[WARNING] static/jarvish_face.jpg not found — avatar display will fail")

# Default single-session fallback state when no user token is passed
engine = EmotionEngine()
history: list[dict[str, str]] = []
current_conversation_id: str | None = None

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
"""

# ---------------------------------------------------------------------------
# Static Web Route
# ---------------------------------------------------------------------------

@app.get("/", response_class=FileResponse)
def index():
    """Serve the main frontend page."""
    return FileResponse(os.path.join(_static_dir, "index.html"))

# ---------------------------------------------------------------------------
# Priority 1 — Authentication Routes
# ---------------------------------------------------------------------------

@app.post("/api/auth/signup")
def signup(body: SignupRequest, db: Session = Depends(get_db)):
    """Create a new user account."""
    email = body.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email address")
    if len(body.password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")

    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise HTTPException(status_code=400, detail="An account with this email already exists")

    pwd_hash = hash_password(body.password)
    user = User(email=email, password_hash=pwd_hash)
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id, user.email)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"id": user.id, "email": user.email}
    }


@app.post("/api/auth/login")
def login(body: LoginRequest, db: Session = Depends(get_db)):
    """Authenticate an existing user and return a JWT access token."""
    email = body.email.strip().lower()
    user = db.query(User).filter(User.email == email).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password")

    token = create_access_token(user.id, user.email)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"id": user.id, "email": user.email}
    }


@app.get("/api/auth/me")
def get_me(user: User = Depends(get_current_user)):
    """Return the profile of the currently logged-in user."""
    return {"id": user.id, "email": user.email}

# ---------------------------------------------------------------------------
# Emotional Chat Pipeline & RAG Knowledge Integration
# ---------------------------------------------------------------------------

@app.post("/api/chat")
def chat(
    body: ChatRequest,
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db)
):
    """Run the emotional chat pipeline with RAG document knowledge context."""
    global engine, history, current_conversation_id

    user_message = body.message.strip()
    if not user_message:
        raise HTTPException(status_code=400, detail="Empty message")

    user_id = user.id if user else "anonymous"

    # Step 1 — Classify user emotion
    user_emotion = llm_client.classify_emotion(user_message)
    if user_emotion is None:
        user_emotion = keyword_fallback(user_message)

    # Step 2 — Update emotion engine
    engine.update(user_emotion)

    # Step 3 — Retrieve RAG Knowledge Base Context
    rag_chunks = query_rag_knowledge(user_id=user_id, query_text=user_message, top_k=3)
    rag_context_str = ""
    if rag_chunks:
        rag_context_str = "\n\n[Uploaded Document Reference Knowledge]:\n" + "\n---\n".join(rag_chunks) + "\n"

    # Step 4 — Build system prompt
    full_system_prompt = BASE_SYSTEM_PROMPT + engine.describe_for_prompt() + rag_context_str

    # Load active conversation history from DB or memory
    conv_id = body.conversation_id or current_conversation_id
    conv_history: list[dict[str, str]] = []

    if user and conv_id:
        conv = db.query(Conversation).filter(Conversation.id == conv_id, Conversation.user_id == user.id).first()
        if conv:
            for m in conv.messages:
                conv_history.append({"role": m.role, "text": m.text})

    if not conv_history:
        conv_history = list(history)

    # Step 5 — Generate reply via Gemini LLM
    try:
        reply = llm_client.generate(
            system_prompt=full_system_prompt,
            conversation_history=conv_history,
            user_message=user_message,
        )
    except Exception as e:
        print(f"[Jarvish Chat Error] {e}")
        reply = "I am currently receiving a high volume of requests. Let's continue our lesson in a moment!"

    mood = engine.expression_tag()

    # Step 6 — Persist conversation turn to DB (or memory fallback)
    if user:
        conv = None
        if conv_id:
            conv = db.query(Conversation).filter(Conversation.id == conv_id, Conversation.user_id == user.id).first()

        if not conv:
            title = user_message[:50]
            conv = Conversation(user_id=user.id, title=title, last_mood=mood)
            db.add(conv)
            db.commit()
            db.refresh(conv)
            conv_id = conv.id
        else:
            conv.updated_at = datetime.utcnow()
            conv.last_mood = mood
            db.commit()

        user_msg_db = Message(conversation_id=conv.id, role="user", text=user_message)
        bot_msg_db = Message(conversation_id=conv.id, role="model", text=reply)
        db.add_all([user_msg_db, bot_msg_db])
        db.commit()

    else:
        history.append({"role": "user", "text": user_message})
        history.append({"role": "model", "text": reply})
        if not current_conversation_id:
            current_conversation_id = str(uuid.uuid4())
        conv_id = current_conversation_id

    return {
        "reply": reply,
        "mood": mood,
        "valence": round(engine.valence, 3),
        "arousal": round(engine.arousal, 3),
        "conversation_id": conv_id,
        "rag_used": len(rag_chunks) > 0
    }


@app.post("/api/reset")
def reset(
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db)
):
    """Reset the current chat session."""
    global engine, history, current_conversation_id
    engine = EmotionEngine()
    history = []
    current_conversation_id = None
    return {"status": "ok", "mood": "neutral"}

# ---------------------------------------------------------------------------
# Priority 2 — Persistent Database Conversation Management Routes
# ---------------------------------------------------------------------------

@app.get("/api/conversations")
def list_conversations(
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db)
):
    """Return user-scoped list of saved conversations from SQLite DB."""
    if not user:
        return []

    convs = db.query(Conversation).filter(Conversation.user_id == user.id).order_by(Conversation.updated_at.desc()).all()
    results = []
    for c in convs:
        results.append({
            "id": c.id,
            "title": c.title or "Untitled",
            "updated_at": c.updated_at.isoformat() if c.updated_at else "",
            "last_mood": c.last_mood or "neutral",
            "message_count": len(c.messages)
        })
    return results


@app.get("/api/conversations/{conv_id}")
def get_conversation(
    conv_id: str,
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db)
):
    """Return the full conversation message history for conv_id."""
    user_id = user.id if user else None
    query = db.query(Conversation).filter(Conversation.id == conv_id)
    if user_id:
        query = query.filter(Conversation.user_id == user_id)

    conv = query.first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    messages = [{"role": m.role, "text": m.text} for m in conv.messages]
    return {
        "id": conv.id,
        "title": conv.title,
        "last_mood": conv.last_mood,
        "updated_at": conv.updated_at.isoformat() if conv.updated_at else "",
        "messages": messages
    }


@app.delete("/api/conversations/{conv_id}")
def delete_conversation(
    conv_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a conversation from SQLite DB."""
    conv = db.query(Conversation).filter(Conversation.id == conv_id, Conversation.user_id == user.id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    db.delete(conv)
    db.commit()
    return {"status": "ok"}


@app.post("/api/conversations/{conv_id}/rename")
def rename_conversation(
    conv_id: str,
    body: RenameRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Rename a conversation title in SQLite DB."""
    conv = db.query(Conversation).filter(Conversation.id == conv_id, Conversation.user_id == user.id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    conv.title = body.title.strip() or "Untitled"
    db.commit()
    return {"status": "ok"}


@app.post("/api/conversations/{conv_id}/load")
def load_conversation(
    conv_id: str,
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db)
):
    """Load a conversation into memory for active session."""
    global engine, history, current_conversation_id
    query = db.query(Conversation).filter(Conversation.id == conv_id)
    if user:
        query = query.filter(Conversation.user_id == user.id)

    conv = query.first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    current_conversation_id = conv.id
    history = [{"role": m.role, "text": m.text} for m in conv.messages]
    engine = EmotionEngine()

    return {
        "status": "ok",
        "mood": conv.last_mood or "neutral",
        "valence": round(engine.valence, 3),
        "arousal": round(engine.arousal, 3),
        "messages": history
    }

# ---------------------------------------------------------------------------
# Priority 3 — RAG Knowledge Base Document Management Routes
# ---------------------------------------------------------------------------

@app.post("/api/documents/upload")
async def upload_document(
    file: UploadFile = File(...),
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db)
):
    """Upload a PDF or TXT reference document into the RAG vector knowledge base."""
    user_id = user.id if user else "anonymous"
    filename = file.filename or "uploaded_document.txt"
    file_bytes = await file.read()

    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    doc_id = str(uuid.uuid4())
    chunk_count = add_document_to_rag(user_id=user_id, doc_id=doc_id, filename=filename, file_bytes=file_bytes)

    if chunk_count == 0:
        raise HTTPException(status_code=400, detail="Could not extract readable text from document")

    if user:
        doc = Document(
            id=doc_id,
            user_id=user.id,
            filename=filename,
            file_type=file.content_type or "text/plain",
            chunk_count=chunk_count
        )
        db.add(doc)
        db.commit()

    return {
        "status": "ok",
        "doc_id": doc_id,
        "filename": filename,
        "chunk_count": chunk_count
    }


@app.get("/api/documents")
def list_documents(
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db)
):
    """List uploaded RAG reference documents."""
    if not user:
        return []

    docs = db.query(Document).filter(Document.user_id == user.id).order_by(Document.created_at.desc()).all()
    return [
        {
            "id": d.id,
            "filename": d.filename,
            "file_type": d.file_type,
            "chunk_count": d.chunk_count,
            "created_at": d.created_at.isoformat() if d.created_at else ""
        }
        for d in docs
    ]


@app.delete("/api/documents/{doc_id}")
def delete_document(
    doc_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Remove a document from DB and ChromaDB vector store."""
    doc = db.query(Document).filter(Document.id == doc_id, Document.user_id == user.id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    delete_document_from_rag(user.id, doc_id)
    db.delete(doc)
    db.commit()
    return {"status": "ok"}

# ---------------------------------------------------------------------------
# Audio Speech-to-Text & Text-to-Speech Endpoints
# ---------------------------------------------------------------------------

@app.post("/api/transcribe")
async def transcribe_endpoint(file: UploadFile = File(...)):
    """Transcribe audio data using Deepgram REST API."""
    try:
        audio_bytes = await file.read()
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="Audio content is empty")

        mime_type = file.content_type or "audio/webm"
        transcript = voice.listen(audio_bytes, mime_type=mime_type)
        return {"transcript": transcript}
    except Exception as e:
        print(f"[Jarvish Transcribe Error] {e}")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")


@app.post("/api/speak")
async def speak_endpoint(body: SpeakRequest):
    """Convert text to speech using edge-tts and return MP3 audio + viseme timeline."""
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is required")

    mood = body.mood.strip()
    try:
        audio_bytes = await voice.speak_async(text, mood)
        if not audio_bytes:
            raise HTTPException(status_code=500, detail="TTS generation failed")

        visemes = voice.generate_visemes_from_audio(audio_bytes)
        audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")

        return {
            "audio": audio_b64,
            "visemes": visemes
        }
    except Exception as e:
        print(f"[Jarvish Speak Error] {e}")
        raise HTTPException(status_code=500, detail=f"TTS failed: {e}")

# ---------------------------------------------------------------------------
# Application Entry Point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    print("=" * 50)
    print("  Jarvish AI - Web Interface")
    print("  Open http://localhost:5000 in your browser")
    print("=" * 50)
    uvicorn.run(app, host="0.0.0.0", port=5000)
