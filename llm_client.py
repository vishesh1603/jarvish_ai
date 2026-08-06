"""
Jarvish AI — LLM Client
========================
Thin wrapper around the Google Gemini API (google-genai SDK).

Exposes two methods:
  • generate()          — multi-turn response generation with a system prompt
  • classify_emotion()  — lightweight sentiment probe that returns (valence, arousal)

Design decisions:
  • We use gemini-2.5-flash for both generation and classification because it
    offers a good balance of quality and speed.  Classification prompts are
    extremely short so latency is minimal.
  • The API key is read from the GEMINI_API_KEY environment variable — never
    hard-coded — so the codebase stays safe to commit.
  • classify_emotion() is deliberately a separate LLM call rather than
    appending "also classify this" to the generation prompt, because mixing
    the two tasks degrades both: the model's reply becomes less natural, and
    the classification less reliable.
"""

from __future__ import annotations

import os
import re
from typing import Optional
from dotenv import load_dotenv

# Load environment variables from .env file automatically using absolute path
_env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
load_dotenv(dotenv_path=_env_path, override=True)

from google import genai
from google.genai import types

# ---------------------------------------------------------------------------
# Client initialisation
# ---------------------------------------------------------------------------

def _get_client() -> genai.Client:
    """Create a Gemini client using the environment variable API key.

    Raises a clear error message if the key is missing, so the developer
    doesn't have to debug cryptic 401 responses.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise EnvironmentError(
            "GEMINI_API_KEY environment variable is not set. "
            "Get a key at https://aistudio.google.com/apikey and run:\n"
            "  export GEMINI_API_KEY='your-key-here'   (Linux/macOS)\n"
            "  $env:GEMINI_API_KEY='your-key-here'     (PowerShell)\n"
            "  set GEMINI_API_KEY=your-key-here         (cmd.exe)"
        )
    return genai.Client(api_key=api_key)


# Model identifier — centralised so it's easy to swap (e.g. to gemini-2.5-pro
# for higher quality, or to a fine-tuned variant).
_MODEL: str = "gemini-2.5-flash"


# ---------------------------------------------------------------------------
# Response generation
# ---------------------------------------------------------------------------

def generate(
    system_prompt: str,
    conversation_history: list[dict[str, str]],
    user_message: str,
) -> str:
    """Generate a single assistant reply given context and history.

    Parameters
    ----------
    system_prompt : str
        Full system prompt including the base persona *and* the injected
        emotion context from EmotionEngine.describe_for_prompt().
    conversation_history : list[dict]
        Prior turns as {"role": "user"|"model", "text": "..."} dicts.
        The google-genai SDK expects role names "user" and "model".
    user_message : str
        The latest user input (not yet in history — we append it here).

    Returns
    -------
    str
        The model's text reply.
    """
    try:
        client = _get_client()

        # Build the contents list that the SDK expects.
        # Each element is a types.Content with a role and parts.
        contents: list[types.Content] = []

        for turn in conversation_history:
            contents.append(
                types.Content(
                    role=turn["role"],
                    parts=[types.Part.from_text(text=turn["text"])],
                )
            )

        # Append the current user message
        contents.append(
            types.Content(
                role="user",
                parts=[types.Part.from_text(text=user_message)],
            )
        )

        # Call the model with the system instruction injected via config.
        # system_instruction keeps the persona out of the conversation history
        # so it doesn't consume context-window tokens on every turn.
        response = client.models.generate_content(
            model=_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                # Temperature slightly above default for more expressive language
                temperature=0.8,
                # Top-p nucleus sampling for natural variety
                top_p=0.95,
            ),
        )

        return response.text or "[No response generated]"
    except Exception as e:
        print(f"[Jarvish LLM Warning] Gemini API call failed: {e}")
        msg_lower = user_message.lower()
        if any(w in msg_lower for w in ["hello", "hi", "hey", "greetings"]):
            return "Hey there! 👋 I'm Jarvish, your AI study buddy. My neural engine is currently handling rate limits, but I'm right here! What would you like to learn or explore today?"
        return f"I am currently receiving a high volume of requests (API rate limit active). Let's continue our lesson in just a moment! You said: '{user_message}'."


# ---------------------------------------------------------------------------
# Emotion classification
# ---------------------------------------------------------------------------

# This prompt is carefully constructed to return *only* two floats.
# We explicitly forbid explanations to make parsing trivial and reliable.
_CLASSIFY_PROMPT = (
    "You are an emotion classifier. Analyse the emotional tone of the "
    "following text and respond with ONLY two comma-separated numbers:\n"
    "  valence (how positive/negative: -1.0 to +1.0)\n"
    "  arousal (how energised/activated: 0.0 to 1.0)\n\n"
    "Rules:\n"
    "- Output ONLY the two numbers separated by a comma. Example: 0.3,0.7\n"
    "- No words, no explanation, no brackets.\n"
    "- Neutral text → 0.0,0.3\n\n"
    "Text to classify:\n"
)


def classify_emotion(text: str) -> Optional[tuple[float, float]]:
    """Ask Gemini to classify the emotional valence and arousal of *text*.

    Returns
    -------
    tuple[float, float] | None
        (valence, arousal) on success, or None if the model's response
        couldn't be parsed — in which case the caller should fall back to
        the keyword heuristic.

    Design note: we return None rather than raising so the main loop can
    degrade gracefully without a try/except on every turn.
    """
    try:
        client = _get_client()
        response = client.models.generate_content(
            model=_MODEL,
            contents=_CLASSIFY_PROMPT + text,
            config=types.GenerateContentConfig(
                # Low temperature for deterministic classification
                temperature=0.1,
                # Cap output length — we only need "0.3,0.7"
                max_output_tokens=20,
            ),
        )

        raw = (response.text or "").strip()
        return _parse_va(raw)

    except Exception as e:
        # Network errors, rate limits, malformed responses — all handled
        # the same way: return None and let the caller use the fallback.
        print(f"  [emotion classifier warning] {e}")
        return None


def _parse_va(raw: str) -> Optional[tuple[float, float]]:
    """Parse a 'valence,arousal' string into clamped floats.

    Tolerant of minor formatting quirks the model might produce:
    whitespace, parentheses, brackets, trailing text after the numbers.
    """
    # Strip common wrapper characters the model might add despite instructions
    cleaned = raw.strip().strip("()[]")

    # Use regex to extract the first two float-like numbers
    # This handles cases like "0.3, 0.7", "-0.5,0.8", "0.3 , 0.7 (positive)"
    floats = re.findall(r"-?\d+\.?\d*", cleaned)

    if len(floats) < 2:
        return None

    try:
        valence = max(-1.0, min(1.0, float(floats[0])))
        arousal = max(0.0, min(1.0, float(floats[1])))
        return (valence, arousal)
    except (ValueError, IndexError):
        return None
