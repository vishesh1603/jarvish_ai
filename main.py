"""
Jarvish AI — Main Conversation Loop
=====================================
Entry point for the terminal-based emotional chatbot.

Each conversational turn follows this pipeline:

  User input
    → classify user emotion (Gemini, with keyword fallback)
    → update EmotionEngine
    → rebuild system prompt with injected mood
    → generate Gemini reply (multi-turn context)
    → print as "Bot [mood]: reply"
    → call voice.speak() stub
    → append to conversation history
    → repeat

The base persona is an emotionally expressive AI teacher for students.
It shows mood through tone and word choice, never by announcing it.
"""

from __future__ import annotations

import sys

from emotion_engine import EmotionEngine, keyword_fallback
import llm_client
import voice


# ---------------------------------------------------------------------------
# Base system prompt — the bot's core persona
# ---------------------------------------------------------------------------
# This prompt is *prepended* to the emotion context each turn.
# Design notes:
#   • "for students" grounds the model in an ed-tech context.
#   • "emotionally expressive" primes it to vary tone.
#   • The explicit prohibition on announcing mood prevents awkward
#     meta-commentary like "As a happy AI, I think..."
#   • We encourage Socratic teaching (questions, scaffolding) because
#     research shows it's more effective than just giving answers.

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


def main() -> None:
    """Run the interactive conversation loop."""

    # ---- Initialise components ----
    engine = EmotionEngine()

    # Conversation history for multi-turn context.
    # Each entry: {"role": "user"|"model", "text": "..."}
    # We keep the full history in memory; for very long sessions you'd
    # want to implement a sliding window or summarisation strategy.
    history: list[dict[str, str]] = []

    print("=" * 60)
    print("  🤖 Jarvish AI — Emotional AI Teacher")
    print("  Type 'quit' or 'exit' to end the session.")
    print("  Type 'debug' to see the emotion engine state.")
    print("=" * 60)
    print()

    while True:
        # ---- Step 1: Get user input ----
        try:
            user_input = voice.listen()  # Falls back to terminal input
        except (EOFError, KeyboardInterrupt):
            # Handle Ctrl+C / Ctrl+D gracefully
            print("\n\nJarvish AI: Goodbye! Keep learning, keep growing. 🚀")
            break

        # Strip whitespace and handle exit commands
        user_input = user_input.strip()
        if not user_input:
            continue
        if user_input.lower() in ("quit", "exit", "bye", "q"):
            print("\nJarvish AI: Goodbye! Keep learning, keep growing. 🚀")
            break

        # Hidden debug command to inspect the emotion engine state
        if user_input.lower() == "debug":
            print(f"  [DEBUG] {engine.debug_state()}")
            continue

        # ---- Step 2: Classify user emotion ----
        # Try the LLM classifier first; fall back to keyword heuristic if
        # it fails (network error, rate limit, parse failure).
        user_emotion = llm_client.classify_emotion(user_input)

        if user_emotion is None:
            # Fallback: keyword-based heuristic using word stems
            user_emotion = keyword_fallback(user_input)
            print(f"  [emotion: keyword fallback → "
                  f"v={user_emotion[0]:+.2f}, a={user_emotion[1]:.2f}]")
        else:
            print(f"  [emotion: Gemini classified → "
                  f"v={user_emotion[0]:+.2f}, a={user_emotion[1]:.2f}]")

        # ---- Step 3: Update the emotion engine ----
        engine.update(user_emotion)

        # ---- Step 4: Build the system prompt with mood injection ----
        # The emotion context is appended to the base persona so the LLM
        # knows what mood to reflect without it being part of the visible
        # conversation history.
        full_system_prompt = BASE_SYSTEM_PROMPT + engine.describe_for_prompt()

        # ---- Step 5: Generate the bot's reply ----
        try:
            reply = llm_client.generate(
                system_prompt=full_system_prompt,
                conversation_history=history,
                user_message=user_input,
            )
        except Exception as e:
            # If generation fails, print the error and continue so the
            # session isn't killed by a transient API issue.
            print(f"\n  [ERROR] Failed to generate response: {e}\n")
            continue

        # ---- Step 6: Get the current mood tag for display and voice ----
        mood = engine.expression_tag()

        # ---- Step 7: Print the reply with the mood tag ----
        print(f"\nBot [{mood}]: {reply}\n")

        # ---- Step 8: Call the voice stub ----
        # In production, this would speak the reply with mood-appropriate
        # vocal characteristics via ElevenLabs TTS.
        voice.speak(reply, mood=mood)

        # ---- Step 9: Append to conversation history ----
        # Both user and model turns are stored so Gemini has full context
        # for multi-turn conversations (follow-up questions, references
        # to earlier topics, etc.)
        history.append({"role": "user", "text": user_input})
        history.append({"role": "model", "text": reply})

        print()  # Visual spacing between turns


if __name__ == "__main__":
    main()
