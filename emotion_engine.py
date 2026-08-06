"""
Jarvish AI — Emotion Engine
============================
Tracks the bot's internal emotional state using the valence–arousal model
from affective computing (Russell's circumplex model).

  • valence  ∈ [-1, +1]  — how positive/negative the emotional state is
  • arousal  ∈ [ 0,  1]  — how energised/activated the state is

Every conversational turn the engine:
  1. Classifies the *user's* emotional tone (via the LLM, with a keyword
     fallback heuristic).
  2. Shifts the bot's internal state *toward* the detected user emotion
     (empathic mirroring) using INFLUENCE_RATE.
  3. Decays the state back toward a neutral baseline so the bot doesn't
     get permanently stuck in an extreme mood.

The resulting mood label is injected into the LLM system prompt so the
model's language naturally reflects the emotion — without ever *announcing*
it ("I feel happy!").
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Tunable constants — adjust these to change how reactive / stable the bot is
# ---------------------------------------------------------------------------

# How strongly a single user message pulls the bot's mood toward the user's
# detected emotion.  0 = bot ignores user emotion entirely; 1 = bot instantly
# mirrors it.  0.6 gives noticeable empathy without whiplash.
INFLUENCE_RATE: float = 0.6

# Per-turn drift back toward the neutral baseline (valence=0, arousal=0.3).
# Small values keep moods "sticky" for a few turns; larger values make the
# bot bounce back quickly.  0.05 ≈ 20 turns to fully decay from an extreme.
DECAY_RATE: float = 0.05

# Neutral baseline — slightly above zero arousal so "neutral" feels alert
# rather than flat/sleepy.
_NEUTRAL_VALENCE: float = 0.0
_NEUTRAL_AROUSAL: float = 0.3


# ---------------------------------------------------------------------------
# Mood-label mapping — each region of the valence–arousal space maps to a
# discrete label that downstream consumers (avatar, TTS, prompt) can use.
# ---------------------------------------------------------------------------

# Thresholds chosen so the eight labels tile the 2D space without gaps.
# Order matters: the first matching predicate wins, so more specific checks
# (excited, frustrated) come before broader ones (happy, sad).
def _label_from_va(valence: float, arousal: float) -> str:
    """Map a (valence, arousal) pair to a human-readable mood label.

    The mapping divides the circumplex into eight sectors:
      high-arousal + positive  → excited
      low-arousal  + positive  → happy
      high-arousal + ~neutral  → curious   (energised but not clearly pos/neg)
      low-arousal  + ~neutral  → calm
      high-arousal + negative  → frustrated
      low-arousal  + negative  → sad
      high-arousal + very neg  → anxious
      everything else          → neutral
    """
    if valence > 0.3 and arousal > 0.6:
        return "excited"
    if valence > 0.3 and arousal <= 0.6:
        return "happy"
    if -0.3 <= valence <= 0.3 and arousal > 0.6:
        return "curious"
    if -0.3 <= valence <= 0.3 and arousal <= 0.6:
        # Distinguish true calm from the narrow neutral band
        if abs(valence) < 0.1 and abs(arousal - _NEUTRAL_AROUSAL) < 0.15:
            return "neutral"
        return "calm"
    if valence < -0.3 and arousal > 0.6:
        # Very negative + high arousal → anxious; moderately neg → frustrated
        if valence < -0.6:
            return "anxious"
        return "frustrated"
    if valence < -0.3 and arousal <= 0.6:
        return "sad"

    return "neutral"


# ---------------------------------------------------------------------------
# Keyword-based fallback heuristic
# ---------------------------------------------------------------------------
# Used when the LLM classifier is unavailable (rate-limit, network error).
# We intentionally match on word *stems* (e.g. "frustrat" catches
# "frustrated", "frustrating", "frustration") to maximise recall without
# pulling in a stemming library.

_KEYWORD_MAP: dict[str, tuple[float, float]] = {
    # stem               (valence, arousal)
    # ---- positive ----
    "excit":             ( 0.8,  0.9),
    "amaz":              ( 0.8,  0.85),
    "awesome":           ( 0.7,  0.8),
    "fantastic":         ( 0.7,  0.8),
    "love":              ( 0.7,  0.5),
    "great":             ( 0.6,  0.5),
    "happy":             ( 0.6,  0.4),
    "good":              ( 0.4,  0.3),
    "thank":             ( 0.5,  0.3),
    "cool":              ( 0.4,  0.4),
    "wonderful":         ( 0.7,  0.6),
    "interest":          ( 0.3,  0.6),

    # ---- negative ----
    "frustrat":          (-0.6,  0.7),
    "anger":             (-0.7,  0.8),   # "anger", "angered", "angering"
    "angry":             (-0.7,  0.8),
    "annoy":             (-0.5,  0.6),
    "hate":              (-0.8,  0.7),
    "stupid":            (-0.5,  0.5),
    "confus":            (-0.3,  0.6),   # "confused", "confusing", "confusion"
    "stress":            (-0.5,  0.7),
    "overwhelm":         (-0.6,  0.8),
    "disappoint":        (-0.5,  0.4),

    # ---- sad / low-energy ----
    "sad":               (-0.6,  0.3),
    "depress":           (-0.8,  0.2),
    "bore":              (-0.3,  0.2),   # "bored", "boring"
    "tire":              (-0.3,  0.1),   # "tired", "tiring"
    "exhaust":           (-0.4,  0.1),
    "give up":           (-0.7,  0.2),
    "fail":              (-0.6,  0.4),   # "fail", "failed", "failing"
    "lost":              (-0.4,  0.4),

    # ---- anxious ----
    "anxi":              (-0.6,  0.8),   # "anxious", "anxiety"
    "worr":              (-0.5,  0.7),   # "worry", "worried", "worrying"
    "scar":              (-0.6,  0.8),   # "scared", "scary"
    "nervous":           (-0.5,  0.7),
    "panic":             (-0.7,  0.9),

    # ---- curious / neutral-positive ----
    "curious":           ( 0.2,  0.7),
    "wonder":            ( 0.2,  0.6),
    "how":               ( 0.1,  0.5),
    "why":               ( 0.1,  0.5),
    "what if":           ( 0.1,  0.6),
    "help":              (-0.1,  0.5),
    "stuck":             (-0.3,  0.5),
}


def keyword_fallback(text: str) -> tuple[float, float]:
    """Estimate (valence, arousal) by scanning for stem-matched keywords.

    Returns the *average* of all matched keyword vectors so that a message
    like "I'm frustrated but excited" blends both signals rather than
    letting the first match win.

    Falls back to dead-neutral (0.0, 0.3) if nothing matches.
    """
    lower = text.lower()
    matches: list[tuple[float, float]] = []

    for stem, va in _KEYWORD_MAP.items():
        # Substring match on stems — "frustrat" matches anywhere inside
        # "I'm so frustrated right now".
        if stem in lower:
            matches.append(va)

    if not matches:
        return (_NEUTRAL_VALENCE, _NEUTRAL_AROUSAL)

    avg_v = sum(v for v, _ in matches) / len(matches)
    avg_a = sum(a for _, a in matches) / len(matches)
    return (avg_v, avg_a)


# ---------------------------------------------------------------------------
# EmotionEngine — the stateful core
# ---------------------------------------------------------------------------

class EmotionEngine:
    """Maintains the bot's emotional state across turns.

    Usage (inside the main loop):
        engine = EmotionEngine()
        user_va = llm.classify_emotion(user_text)  # or keyword_fallback()
        engine.update(user_va)
        system_prompt = BASE_PROMPT + engine.describe_for_prompt()
        mood_tag = engine.expression_tag()
    """

    def __init__(
        self,
        valence: float = _NEUTRAL_VALENCE,
        arousal: float = _NEUTRAL_AROUSAL,
    ) -> None:
        # Internal state — mutable each turn
        self.valence: float = valence
        self.arousal: float = arousal

    # ---- State transitions ------------------------------------------------

    def update(self, user_emotion: tuple[float, float]) -> None:
        """Shift the bot's mood toward the user's detected emotion, then
        decay back toward neutral.

        Two-phase update per turn:
          1. *Influence*: lerp toward user emotion by INFLUENCE_RATE.
             This creates empathic mirroring — the bot "catches" the
             user's mood.
          2. *Decay*: lerp toward neutral baseline by DECAY_RATE.
             This prevents runaway moods (e.g. getting stuck in
             "frustrated" for the rest of the session).

        Clamping ensures we never leave the valid ranges.
        """
        user_v, user_a = user_emotion

        # Phase 1 — empathic influence
        self.valence += INFLUENCE_RATE * (user_v - self.valence)
        self.arousal += INFLUENCE_RATE * (user_a - self.arousal)

        # Phase 2 — decay toward neutral
        self.valence += DECAY_RATE * (_NEUTRAL_VALENCE - self.valence)
        self.arousal += DECAY_RATE * (_NEUTRAL_AROUSAL - self.arousal)

        # Clamp to valid ranges
        self.valence = max(-1.0, min(1.0, self.valence))
        self.arousal = max(0.0, min(1.0, self.arousal))

    # ---- Query methods ----------------------------------------------------

    def expression_tag(self) -> str:
        """Return the current discrete mood label.

        Designed to be consumed by a face/avatar rendering layer or
        a TTS style selector — anything that needs a simple categorical
        mood rather than continuous valence/arousal.
        """
        return _label_from_va(self.valence, self.arousal)

    def describe_for_prompt(self) -> str:
        """Return a string to inject into the LLM system prompt.

        This is the key bridge between the emotion engine and the language
        model.  By describing the mood *in the system prompt*, the LLM
        naturally adjusts its tone, word choice, and energy level —
        without explicitly announcing its feelings.

        Example output:
          "Your current emotional state is 'curious' (valence=0.12,
           arousal=0.68). Reflect this mood through your tone and word
           choice, but do NOT explicitly state your mood."
        """
        mood = self.expression_tag()
        return (
            f"\n[Emotion context] Your current emotional state is '{mood}' "
            f"(valence={self.valence:+.2f}, arousal={self.arousal:.2f}). "
            f"Reflect this mood subtly through your tone, enthusiasm, and "
            f"word choice. Do NOT explicitly announce your mood or say "
            f"things like 'I feel happy'. Instead, let it colour your "
            f"language naturally."
        )

    def debug_state(self) -> str:
        """Human-readable snapshot for logging / debugging."""
        return (
            f"EmotionEngine(valence={self.valence:+.3f}, "
            f"arousal={self.arousal:.3f}, mood={self.expression_tag()!r})"
        )
