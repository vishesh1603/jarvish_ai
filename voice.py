"""
Jarvish AI — Voice I/O Module
=============================
Handles speech-to-text (listen) using Deepgram's REST API and Nova-2 model,
and text-to-speech (speak).
"""

from __future__ import annotations
import os
import requests
import asyncio
import edge_tts

def listen(audio_data: bytes | None = None, mime_type: str = "audio/webm") -> str:
    """Transcribe audio using Deepgram's REST API (Nova-2 model).
    If no audio_data is provided, falls back to terminal input.
    """
    if audio_data is None:
        # Fallback to terminal input for backward compatibility
        return input("You: ")

    api_key = os.environ.get("DEEPGRAM_API_KEY")
    if not api_key:
        raise ValueError("DEEPGRAM_API_KEY environment variable is not set.")

    # We send the request directly to Deepgram's REST API endpoint
    url = "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true"
    headers = {
        "Authorization": f"Token {api_key}",
        "Content-Type": mime_type
    }

    try:
        response = requests.post(url, headers=headers, data=audio_data)
        
        if response.status_code != 200:
            raise RuntimeError(f"Deepgram REST API error ({response.status_code}): {response.text}")

        res_data = response.json()
        
        # Navigate to the transcript string
        transcript = res_data["results"]["channels"][0]["alternatives"][0]["transcript"]
        return transcript.strip()

    except Exception as e:
        print(f"[Deepgram REST Error] Transcription failed: {e}")
        raise RuntimeError(f"Deepgram transcription error: {e}")

# TODO Day 6: Implement real-time websocket audio streaming hook here
# (e.g. using a websocket connection to wss://api.deepgram.com/v1/listen)


MOOD_VOICES = {
    "excited": "en-US-ChristopherNeural",
    "happy": "en-US-GuyNeural",
    "sad": "en-US-GuyNeural",
    "frustrated": "en-US-DavisNeural",
    "calm": "en-US-TonyNeural",
    "curious": "en-US-ChristopherNeural",
    "neutral": "en-US-ChristopherNeural",
    "anxious": "en-US-ChristopherNeural",
}

MOOD_RATE = {
    "excited": "+25%",
    "happy": "+15%",
    "sad": "-20%",
    "frustrated": "+15%",
    "calm": "-10%",
    "curious": "+5%",
    "neutral": "+0%",
    "anxious": "+20%",
}

MOOD_VOLUME = {
    "excited": "+0%",
    "happy": "+0%",
    "sad": "-20%",
    "frustrated": "+0%",
    "calm": "-10%",
    "curious": "+0%",
    "neutral": "+0%",
    "anxious": "+0%",
}


async def speak_async(text: str, mood: str = "neutral") -> bytes:
    """Async TTS generation — can be awaited directly from FastAPI endpoints."""
    voice = MOOD_VOICES.get(mood.lower(), MOOD_VOICES["neutral"])
    rate = MOOD_RATE.get(mood.lower(), MOOD_RATE["neutral"])
    volume = MOOD_VOLUME.get(mood.lower(), MOOD_VOLUME["neutral"])

    communicate = edge_tts.Communicate(text, voice, rate=rate, volume=volume)
    audio_chunks = []
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_chunks.append(chunk["data"])
    return b"".join(audio_chunks)


def generate_visemes_from_audio(mp3_bytes: bytes) -> list[dict] | None:
    """Run Rhubarb Lip Sync CLI on MP3 audio bytes.

    1. Saves MP3 to a temporary file.
    2. Converts MP3 to 16kHz PCM mono WAV via ffmpeg.
    3. Runs rhubarb -f json temp.wav -o temp.json.
    4. Parses and returns mouthCues list.
    5. Safely cleans up all temp files.
    If Rhubarb is missing or fails, returns None.
    """
    rhubarb_path = os.environ.get("RHUBARB_PATH", "rhubarb")
    if not os.path.exists(rhubarb_path) and rhubarb_path != "rhubarb":
        print(f"[Rhubarb Warning] Executable not found at RHUBARB_PATH: {rhubarb_path}")
        return None

    import tempfile
    import subprocess
    import json

    mp3_path = None
    wav_path = None
    json_path = None

    try:
        # Create temp MP3 file
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
            f.write(mp3_bytes)
            mp3_path = f.name

        wav_path = mp3_path.replace(".mp3", ".wav")
        json_path = mp3_path.replace(".mp3", ".json")

        # Step 1: Convert MP3 to 16kHz mono PCM WAV via ffmpeg
        ffmpeg_cmd = [
            "ffmpeg", "-y", "-i", mp3_path,
            "-acodec", "pcm_s16le", "-ac", "1", "-ar", "16000",
            wav_path
        ]
        res = subprocess.run(ffmpeg_cmd, capture_output=True, text=True, timeout=15)
        if res.returncode != 0 or not os.path.exists(wav_path):
            print(f"[Rhubarb Warning] FFmpeg conversion failed: {res.stderr}")
            return None

        # Step 2: Run Rhubarb CLI on the WAV file
        rhubarb_cmd = [
            rhubarb_path,
            "-f", "json",
            wav_path,
            "-o", json_path
        ]
        res_rhu = subprocess.run(rhubarb_cmd, capture_output=True, text=True, timeout=30)
        if res_rhu.returncode != 0 or not os.path.exists(json_path):
            print(f"[Rhubarb Warning] Rhubarb execution failed: {res_rhu.stderr}")
            return None

        # Step 3: Parse Rhubarb JSON output
        with open(json_path, "r", encoding="utf-8") as jf:
            data = json.load(jf)

        cues = data.get("mouthCues", [])
        return cues

    except Exception as e:
        print(f"[Rhubarb Warning] Viseme generation failed: {e}")
        return None

    finally:
        for p in (mp3_path, wav_path, json_path):
            if p and os.path.exists(p):
                try:
                    os.remove(p)
                except OSError:
                    pass


def speak(text: str, mood: str = "neutral") -> bytes:
    """Convert text to speech using Microsoft edge-tts with mood-dependent settings.
    Returns raw audio bytes (MP3 format).
    Sync wrapper around speak_async() — use speak_async() directly from async code.
    """
    try:
        # Check if loop is already running in current thread (to prevent RuntimeError)
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

        # TODO Day 6: Implement real-time streaming TTS generator here for immediate playback

        if loop.is_running():
            # Fallback if loop is already running (e.g. debug reloads)
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as executor:
                future = executor.submit(asyncio.run, speak_async(text, mood))
                return future.result()
        else:
            return loop.run_until_complete(speak_async(text, mood))
    except Exception as e:
        print(f"[edge-tts Error] TTS generation failed: {e}")
        return b""
