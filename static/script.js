/**
 * Jarvish AI — Frontend Logic
 * ============================
 * Handles chat interactions, orb mood updates, message rendering,
 * voice input (STT via Web Speech API), voice output (TTS via
 * SpeechSynthesis with mood-reactive parameters), and communication
 * with the Flask API.
 *
 * Architecture:
 *   • sendMessage()     → POST /api/chat → render reply + update orb + speak
 *   • updateMood()      → swap CSS classes on orb + body for mood theme
 *   • addMessage()      → create and append a styled message bubble
 *   • renderMarkdown()  → lightweight inline markdown → HTML conversion
 *   • Voice STT         → Web Speech API SpeechRecognition (Chrome/Edge)
 *   • Voice TTS         → Web Speech API SpeechSynthesis with mood params
 */

// -----------------------------------------------------------------------
// DOM references — cached once on load for performance
// -----------------------------------------------------------------------
const messagesEl     = document.getElementById("messages");
const chatArea       = document.getElementById("chat-area");
const userInput      = document.getElementById("user-input");
const btnSend        = document.getElementById("btn-send");
const btnNewChat     = document.getElementById("btn-new-chat");
const btnMic         = document.getElementById("btn-mic");
const btnVoiceToggle = document.getElementById("btn-voice-toggle");
const btnAvatarToggle = document.getElementById("btn-avatar-toggle");
const avatarContainer = document.getElementById("avatar-container");
const avatarImg       = document.getElementById("avatar-img");
const avatarMouth     = document.getElementById("avatar-mouth");
const iconSpeakerOn  = document.getElementById("icon-speaker-on");
const iconSpeakerOff = document.getElementById("icon-speaker-off");
const voiceStatus    = document.getElementById("voice-status");
const voiceStatusDot = document.getElementById("voice-status-dot");
const voiceStatusText = document.getElementById("voice-status-text");
const orbContainer   = document.getElementById("orb-container");
const orbGlow        = document.getElementById("orb-glow");
const orbCore        = document.getElementById("orb-core");
const orbParticles   = document.getElementById("orb-particles");
const moodBadge      = document.getElementById("mood-badge");
const moodLabel      = document.getElementById("mood-label");
const orbMoodText    = document.getElementById("orb-mood-text");

// Memory sidebar elements
const sidebarToggle   = document.getElementById("btn-sidebar-toggle");
const sidebarClose    = document.getElementById("btn-sidebar-close");
const memorySidebar   = document.getElementById("memory-sidebar");
const sidebarOverlay  = document.getElementById("sidebar-overlay");
const conversationList = document.getElementById("conversation-list");
const searchInput     = document.getElementById("sidebar-search-input");

// -----------------------------------------------------------------------
// State
// -----------------------------------------------------------------------
let isWaiting = false;       // True while waiting for a bot response
let currentMood = "neutral";
let voiceEnabled = true;     // Whether TTS auto-speaks bot replies
let avatarEnabled = true;    // Whether AI avatar video & lip-sync is enabled by default
let isSpeaking = false;      // True while TTS is speaking
let activeConversationId = null; // ID of the currently loaded conversation
let conversations = [];      // List of conversation headers from server

// Mood descriptions shown under the orb — adds personality
const MOOD_DESCRIPTIONS = {
    excited:    "Buzzing with energy!",
    happy:      "Feeling great",
    curious:    "Hmm, interesting...",
    calm:       "Cool and collected",
    anxious:    "A bit on edge",
    sad:        "Feeling low",
    frustrated: "Working through it",
    neutral:    "Ready to learn",
};


// -----------------------------------------------------------------------
// SPLIT PANEL — resizable divider between avatar and chat panels
// -----------------------------------------------------------------------

const SPLIT_MIN = 0.30;  // Avatar panel minimum: 30%
const SPLIT_MAX = 0.80;  // Avatar panel maximum: 80%
const SPLIT_DEFAULT = 0.65; // Default: 65% avatar, 35% chat
const SPLIT_STORAGE_KEY = "jarvish_split_ratio";

function applySplitRatio(avatarPanel, ratio) {
    avatarPanel.style.flexBasis = (ratio * 100).toFixed(2) + "%";
    avatarPanel.style.flexGrow = "0";
    avatarPanel.style.flexShrink = "0";
}

function initSplitDivider() {
    const divider  = document.getElementById("split-divider");
    const avatarPanel = document.getElementById("panel-avatar");
    const appMain  = document.getElementById("app-main");

    if (!divider || !avatarPanel || !appMain) return;

    // Restore saved ratio from localStorage
    let savedRatio = parseFloat(localStorage.getItem(SPLIT_STORAGE_KEY));
    if (isNaN(savedRatio) || savedRatio < SPLIT_MIN || savedRatio > SPLIT_MAX) {
        savedRatio = SPLIT_DEFAULT;
    }
    if (window.innerWidth > 768) {
        applySplitRatio(avatarPanel, savedRatio);
    }

    let isDragging = false;

    function startDrag(e) {
        if (window.innerWidth <= 768) return;
        isDragging = true;
        divider.classList.add("dragging");
        document.body.classList.add("split-dragging");
        e.preventDefault();
    }

    function onDrag(e) {
        if (!isDragging) return;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const rect = appMain.getBoundingClientRect();
        let ratio = (clientX - rect.left) / rect.width;

        // Clamp to min/max
        ratio = Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, ratio));

        applySplitRatio(avatarPanel, ratio);
    }

    function endDrag() {
        if (!isDragging) return;
        isDragging = false;
        divider.classList.remove("dragging");
        document.body.classList.remove("split-dragging");

        // Persist to localStorage
        const currentFlex = avatarPanel.style.flexBasis;
        if (currentFlex) {
            localStorage.setItem(SPLIT_STORAGE_KEY, (parseFloat(currentFlex) / 100).toString());
        }
    }

    // Mouse events
    divider.addEventListener("mousedown", startDrag);
    document.addEventListener("mousemove", onDrag);
    document.addEventListener("mouseup", endDrag);

    // Touch events
    divider.addEventListener("touchstart", startDrag, { passive: false });
    document.addEventListener("touchmove", onDrag, { passive: false });
    document.addEventListener("touchend", endDrag);

    // Reset on window resize crossing mobile breakpoint
    window.addEventListener("resize", () => {
        if (window.innerWidth <= 768) {
            avatarPanel.style.flexBasis = "";
        } else if (!avatarPanel.style.flexBasis) {
            let stored = parseFloat(localStorage.getItem(SPLIT_STORAGE_KEY));
            if (isNaN(stored) || stored < SPLIT_MIN || stored > SPLIT_MAX) stored = SPLIT_DEFAULT;
            applySplitRatio(avatarPanel, stored);
        }
    });
}


// -----------------------------------------------------------------------
// INITIALISATION
// -----------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    // Auto-focus the input field on page load
    userInput.focus();

    // Enable/disable send button based on input content
    userInput.addEventListener("input", onInputChange);

    // Send on Enter (but Shift+Enter inserts a newline)
    userInput.addEventListener("keydown", onInputKeydown);

    // Auto-resize textarea as user types
    userInput.addEventListener("input", autoResizeTextarea);

    // Button handlers
    btnSend.addEventListener("click", sendMessage);
    btnNewChat.addEventListener("click", resetChat);

    // Sidebar handlers
    sidebarToggle.addEventListener("click", toggleSidebar);
    sidebarClose.addEventListener("click", closeSidebar);
    sidebarOverlay.addEventListener("click", closeSidebar);
    searchInput.addEventListener("input", filterConversations);

    // Voice handlers
    btnMic.addEventListener("click", toggleRecording);
    btnVoiceToggle.addEventListener("click", toggleVoiceOutput);
    if (btnAvatarToggle) {
        btnAvatarToggle.addEventListener("click", toggleAvatarOutput);
    }

    // Initialise resizable split divider
    initSplitDivider();

    // Initialise Dala signature constellation particle system
    initDalaConstellation();

    // Initialise voice systems
    initSTT();
    initTTS();

    // Set initial mood theme
    updateMood("neutral");

    // Set initial voice toggle visual state
    updateVoiceToggleUI();

    // Fetch previous conversations on startup
    loadConversationList();

    // Initialise Splash & Welcome page overlays
    initLandingPage();

    // Check debug mode for mouth overlay calibration
    checkMouthDebugMode();
});

// Debug / Calibration mode for mouth positioning
function checkMouthDebugMode() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("debug") === "mouth") {
        const mouthEl = document.getElementById("avatar-mouth");
        const containerEl = document.getElementById("avatar-container");
        const imgEl = document.getElementById("avatar-img");
        if (mouthEl) mouthEl.classList.add("debug-mouth");

        function logBoundingRects() {
            if (!mouthEl || !containerEl) return;
            const mRect = mouthEl.getBoundingClientRect();
            const cRect = containerEl.getBoundingClientRect();
            const iRect = imgEl ? imgEl.getBoundingClientRect() : null;

            console.log("=== MOUTH DEBUG BOUNDS ===");
            console.log("Container rect:", cRect.width, "x", cRect.height, "at", cRect.left, cRect.top);
            if (iRect) console.log("Img rect:", iRect.width, "x", iRect.height, "at", iRect.left, iRect.top);
            console.log("Mouth rect:", mRect.width, "x", mRect.height, "at", mRect.left, mRect.top);
            console.log("Relative to Container:");
            console.log("  left %:", ((mRect.left - cRect.left) / cRect.width * 100).toFixed(2) + "%");
            console.log("  top %:", ((mRect.top - cRect.top) / cRect.height * 100).toFixed(2) + "%");
            console.log("  width %:", (mRect.width / cRect.width * 100).toFixed(2) + "%");
            console.log("  height %:", (mRect.height / cRect.height * 100).toFixed(2) + "%");
        }

        setTimeout(logBoundingRects, 500);
        window.addEventListener("resize", logBoundingRects);
    }
}


// -----------------------------------------------------------------------
// DALA CONSTELLATION PARTICLE SYSTEM (Canvas Brain & Ambient Drift)
// -----------------------------------------------------------------------

function initDalaConstellation() {
    const canvas = document.getElementById("dala-constellation-canvas");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    let width, height;

    function resize() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    const CHROMATIC_COLORS = [
        "#8052ff", // Electric Iris (Violet)
        "#ffb829", // Saffron Spark (Amber)
        "#15846e", // Deep Verdant (Teal)
        "#38bdf8", // Sky Blue
        "#ec4899", // Magenta
        "#a855f7", // Purple
        "#ffffff"  // Bone White
    ];

    const particles = [];
    const numBrainParticles = 350;
    const numAmbientParticles = 120;

    let mouseX = width / 2;
    let mouseY = height / 2;

    window.addEventListener("mousemove", (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
    });

    // Generate Brain Constellation Cluster Points
    function createBrainPoints() {
        for (let i = 0; i < numBrainParticles; i++) {
            // Parametric dual-ellipsoid brain shape coordinates
            const isLeftLobe = Math.random() < 0.5;
            const lobeOffset = isLeftLobe ? -0.18 : 0.18;
            
            // Random point in organic ellipse — centered on background / left-center
            const u = Math.random();
            const r = Math.sqrt(u) * 0.35;
            const theta = Math.random() * 2 * Math.PI;

            const cx = 0.50 + lobeOffset + r * Math.cos(theta) * 0.75;
            const cy = 0.45 + r * Math.sin(theta) * 0.90;

            particles.push({
                x: cx * width,
                y: cy * height,
                originX: cx,
                originY: cy,
                vx: (Math.random() - 0.5) * 0.35,
                vy: (Math.random() - 0.5) * 0.35,
                size: Math.random() * 3.5 + 2.5,
                color: CHROMATIC_COLORS[Math.floor(Math.random() * CHROMATIC_COLORS.length)],
                rotation: Math.random() * Math.PI * 2,
                rotSpeed: (Math.random() - 0.5) * 0.02,
                alpha: Math.random() * 0.5 + 0.4, // Vivid opacity (0.4 - 0.9)
                twinkle: Math.random() * Math.PI * 2,
                twinkleSpeed: Math.random() * 0.04 + 0.015,
                isBrain: true
            });
        }
    }

    // Generate Ambient Floating Void Particles
    function createAmbientPoints() {
        for (let i = 0; i < numAmbientParticles; i++) {
            particles.push({
                x: Math.random() * width,
                y: Math.random() * height,
                vx: (Math.random() - 0.5) * 0.3,
                vy: (Math.random() - 0.5) * 0.3,
                size: Math.random() * 3.0 + 2.0,
                color: CHROMATIC_COLORS[Math.floor(Math.random() * CHROMATIC_COLORS.length)],
                rotation: Math.random() * Math.PI * 2,
                rotSpeed: (Math.random() - 0.5) * 0.015,
                alpha: Math.random() * 0.4 + 0.3, // Bright ambient sparkles (0.3 - 0.7)
                twinkle: Math.random() * Math.PI * 2,
                twinkleSpeed: Math.random() * 0.03 + 0.01,
                isBrain: false
            });
        }
    }

    createBrainPoints();
    createAmbientPoints();

    // Helper: Draw small outlined sharp-edged triangle glyph
    function drawTriangle(x, y, size, angle, color, alpha) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.lineTo(size * 0.866, size * 0.5);
        ctx.lineTo(-size * 0.866, size * 0.5);
        ctx.closePath();

        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 1.4;
        ctx.stroke();

        ctx.fillStyle = color;
        ctx.globalAlpha = alpha * 0.30;
        ctx.fill();
        ctx.restore();
    }

    function animate() {
        ctx.clearRect(0, 0, width, height);

        // Draw connecting constellation lines between nearby brain points
        ctx.lineWidth = 0.5;
        for (let i = 0; i < particles.length; i++) {
            const p1 = particles[i];
            if (!p1.isBrain) continue;

            for (let j = i + 1; j < particles.length; j++) {
                const p2 = particles[j];
                if (!p2.isBrain) continue;

                const dx = p1.x - p2.x;
                const dy = p1.y - p2.y;
                const distSq = dx * dx + dy * dy;
                const maxDistSq = 60 * 60;

                if (distSq < maxDistSq) {
                    const alpha = (1 - Math.sqrt(distSq) / 60) * 0.18; // Visible connection lines
                    ctx.strokeStyle = p1.color;
                    ctx.globalAlpha = alpha;
                    ctx.beginPath();
                    ctx.moveTo(p1.x, p1.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.stroke();
                }
            }
        }

        // Update and render individual particle triangles
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];

            if (p.isBrain) {
                const targetX = p.originX * width;
                const targetY = p.originY * height;
                p.x += (targetX - p.x) * 0.02 + p.vx;
                p.y += (targetY - p.y) * 0.02 + p.vy;

                // Subtle repulsion from mouse cursor
                const mdx = p.x - mouseX;
                const mdy = p.y - mouseY;
                const mdist = Math.sqrt(mdx * mdx + mdy * mdy);
                if (mdist < 140) {
                    const force = (140 - mdist) / 140;
                    p.x += (mdx / mdist) * force * 2.5;
                    p.y += (mdy / mdist) * force * 2.5;
                }
            } else {
                p.x += p.vx;
                p.y += p.vy;

                if (p.x < 0) p.x = width;
                if (p.x > width) p.x = 0;
                if (p.y < 0) p.y = height;
                if (p.y > height) p.y = 0;
            }

            p.rotation += p.rotSpeed;
            p.twinkle += p.twinkleSpeed;

            // Twinkling sparkle opacity modulation
            const sparkleAlpha = Math.max(0.15, p.alpha * (0.65 + 0.35 * Math.sin(p.twinkle)));

            drawTriangle(p.x, p.y, p.size, p.rotation, p.color, sparkleAlpha);
        }

        requestAnimationFrame(animate);
    }

    animate();
}


// -----------------------------------------------------------------------
// INPUT HANDLING
// -----------------------------------------------------------------------

/** Enable send button only when there's non-whitespace input. */
function onInputChange() {
    btnSend.disabled = !userInput.value.trim();
}

/** Send on Enter, newline on Shift+Enter. */
function onInputKeydown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!btnSend.disabled && !isWaiting) {
            sendMessage();
        }
    }
}

/** Auto-grow the textarea to fit content, up to max-height. */
function autoResizeTextarea() {
    userInput.style.height = "auto";
    userInput.style.height = Math.min(userInput.scrollHeight, 120) + "px";
}


// -----------------------------------------------------------------------
// CHAT API
// -----------------------------------------------------------------------

/**
 * Send the user's message to the backend and render the response.
 *
 * Flow:
 *   1. Read and clear input
 *   2. Render user message bubble
 *   3. Show typing indicator
 *   4. POST to /api/chat
 *   5. Hide typing indicator
 *   6. Update mood (orb, badge, body class)
 *   7. Render bot message bubble
 */
async function sendMessage() {
    const text = userInput.value.trim();
    if (!text || isWaiting) return;

    // Clear input and reset height
    userInput.value = "";
    userInput.style.height = "auto";
    btnSend.disabled = true;
    isWaiting = true;

    // 1. Render user message
    addMessage(text, "user");

    // 2. Show typing indicator
    showTypingIndicator();

    try {
        // 3. Call the API
        const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: text }),
        });

        // 4. Hide typing
        hideTypingIndicator();

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `Server error (${response.status})`);
        }

        const data = await response.json();

        // 5. Update active conversation ID
        if (data.conversation_id && activeConversationId !== data.conversation_id) {
            activeConversationId = data.conversation_id;
        }

        // 6. Update mood visuals
        updateMood(data.mood, data.valence, data.arousal);

        // 7. Render bot reply
        addMessage(data.reply, "bot", data.mood);

        // 8. Speak the reply if voice or avatar is enabled
        if (avatarEnabled || voiceEnabled) {
            speakReply(data.reply, data.mood);
        }

        // 9. Reload conversation list to show new message/title
        loadConversationList();

    } catch (error) {
        hideTypingIndicator();
        addMessage(`Something went wrong: ${error.message}`, "bot", "error");
    } finally {
        isWaiting = false;
        userInput.focus();
    }
}

/**
 * Reset the conversation — clear chat and reset the emotion engine.
 */
async function resetChat() {
    // Stop any ongoing speech
    stopSpeaking();

    try {
        await fetch("/api/reset", { method: "POST" });
    } catch (e) {
        // Even if the API call fails, reset the UI
    }

    activeConversationId = null;

    // Clear all messages except re-add the welcome message
    messagesEl.innerHTML = "";
    addMessage(
        "Hey there! 👋 I'm **Jarvish**, your AI study buddy. Ask me anything — from quantum physics to Shakespeare — and I'll make it click.\n\nWhat are you working on today?",
        "bot",
        "neutral"
    );

    // Reset mood to neutral
    updateMood("neutral");
    userInput.focus();

    // Reload conversation list to show the auto-saved session
    loadConversationList();
}


// -----------------------------------------------------------------------
// MESSAGE RENDERING
// -----------------------------------------------------------------------

/**
 * Add a styled message bubble to the chat area.
 *
 * @param {string} text    - The message text (supports lightweight markdown)
 * @param {string} sender  - "user" or "bot"
 * @param {string} [mood]  - Mood label for bot messages (used for styling)
 */
function addMessage(text, sender, mood = currentMood) {
    const msgDiv = document.createElement("div");
    msgDiv.className = `message ${sender === "user" ? "user-message" : "bot-message"}`;
    if (mood) msgDiv.dataset.mood = mood;

    if (sender === "bot") {
        // Bot avatar
        const avatar = document.createElement("div");
        avatar.className = "message-avatar";
        avatar.textContent = "J";
        msgDiv.appendChild(avatar);
    }

    // Message content wrapper
    const contentDiv = document.createElement("div");
    contentDiv.className = "message-content";

    // The bubble itself
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    if (mood === "error") bubble.classList.add("error-bubble");

    // Render markdown for bot messages, plain text for user
    if (sender === "bot") {
        bubble.innerHTML = renderMarkdown(text);
    } else {
        bubble.innerHTML = `<p>${escapeHtml(text)}</p>`;
    }

    contentDiv.appendChild(bubble);
    msgDiv.appendChild(contentDiv);
    messagesEl.appendChild(msgDiv);

    // Scroll to bottom
    scrollToBottom();
}

/** Smooth-scroll the chat area to the latest message. */
function scrollToBottom() {
    // Small delay so the DOM has time to paint the new element
    requestAnimationFrame(() => {
        chatArea.scrollTop = chatArea.scrollHeight;
    });
}


// -----------------------------------------------------------------------
// TYPING INDICATOR
// -----------------------------------------------------------------------

function showTypingIndicator() {
    const el = document.createElement("div");
    el.className = "message bot-message";
    el.id = "typing-indicator";

    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = "J";

    const content = document.createElement("div");
    content.className = "message-content";

    const bubble = document.createElement("div");
    bubble.className = "message-bubble typing-indicator";
    bubble.innerHTML = `
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
    `;

    content.appendChild(bubble);
    el.appendChild(avatar);
    el.appendChild(content);
    messagesEl.appendChild(el);
    scrollToBottom();
}

function hideTypingIndicator() {
    const el = document.getElementById("typing-indicator");
    if (el) el.remove();
}


// -----------------------------------------------------------------------
// MOOD / ORB UPDATES
// -----------------------------------------------------------------------

/**
 * Update all mood-reactive UI elements.
 *
 * This is the central function that cascades the mood theme across:
 *   • The glowing orb (colour, animation speed)
 *   • The mood badge in the header
 *   • The body class (which overrides CSS custom properties globally)
 *   • The orb description text
 *
 * @param {string} mood     - One of the 8 mood labels
 * @param {number} [valence] - Optional, for future use (e.g. intensity scaling)
 * @param {number} [arousal] - Optional, for future use
 */
function updateMood(mood, valence, arousal) {
    const prevMood = currentMood;
    currentMood = mood;

    // All valid mood labels — used to strip old classes
    const allMoods = [
        "excited", "happy", "curious", "calm",
        "anxious", "sad", "frustrated", "neutral"
    ];

    const moodClass = `mood-${mood}`;

    // Update orb elements (null-safe — orb may be removed from DOM)
    [orbGlow, orbCore, orbParticles].forEach(el => {
        if (!el) return;
        allMoods.forEach(m => el.classList.remove(`mood-${m}`));
        el.classList.add(moodClass);
    });

    // Update body class for global accent colour cascade
    allMoods.forEach(m => document.body.classList.remove(`mood-${m}`));
    document.body.classList.add(moodClass);

    // Update mood badge
    moodLabel.textContent = mood;
    moodBadge.dataset.mood = mood;

    // Update orb description text (null-safe — element may be removed)
    if (orbMoodText) orbMoodText.textContent = MOOD_DESCRIPTIONS[mood] || "Ready to learn";
}


// -----------------------------------------------------------------------
// LIGHTWEIGHT MARKDOWN RENDERER
// -----------------------------------------------------------------------

/**
 * Convert a subset of markdown to HTML for bot messages.
 *
 * Supports:
 *   • **bold** and *italic*
 *   • `inline code` and ```code blocks```
 *   • Bullet lists (- item) and numbered lists (1. item)
 *   • Line breaks (double newline → paragraph)
 *
 * This is intentionally simple — no dependency on a markdown library.
 * For a full-featured renderer, swap in marked.js or similar.
 */
function renderMarkdown(text) {
    if (!text) return "";

    // Step 1: Escape HTML entities to prevent XSS
    let html = escapeHtml(text);

    // Step 2: Code blocks (``` ... ```) — must come before inline processing
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
        return `<pre><code>${code.trim()}</code></pre>`;
    });

    // Step 3: Inline code (`...`)
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Step 4: Bold (**...**)
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

    // Step 5: Italic (*...*)
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");

    // Step 6: Split into paragraphs on double newlines
    const paragraphs = html.split(/\n\n+/);

    html = paragraphs.map(para => {
        para = para.trim();
        if (!para) return "";

        // Check if this paragraph is a list
        const lines = para.split("\n");
        const isBulletList = lines.every(l => /^\s*[-•]\s/.test(l));
        const isNumberedList = lines.every(l => /^\s*\d+[.)]\s/.test(l));

        if (isBulletList) {
            const items = lines.map(l => `<li>${l.replace(/^\s*[-•]\s/, "")}</li>`).join("");
            return `<ul>${items}</ul>`;
        }
        if (isNumberedList) {
            const items = lines.map(l => `<li>${l.replace(/^\s*\d+[.)]\s/, "")}</li>`).join("");
            return `<ol>${items}</ol>`;
        }

        // Check if it's a pre block (already rendered)
        if (para.startsWith("<pre>")) return para;

        // Regular paragraph — convert single newlines to <br>
        return `<p>${para.replace(/\n/g, "<br>")}</p>`;
    }).join("");

    return html;
}

/**
 * Escape HTML special characters to prevent XSS injection.
 * This runs before any markdown processing.
 */
function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}


// =======================================================================
// VOICE ENGINE
// =======================================================================
// Uses the browser's built-in Web Speech API for both STT and TTS.
// No external dependencies or API keys required.
//
// STT: SpeechRecognition (Chrome 33+, Edge 79+)
//   - Click the mic button to start/stop recording
//   - Recognised text is placed into the input field and auto-sent
//
// TTS: SpeechSynthesis with mood-reactive voice parameters
//   - Pitch, rate, and volume vary per mood label
//   - The orb pulses while speaking for visual feedback
//   - Toggle on/off via the speaker button in the header
// =======================================================================


// -----------------------------------------------------------------------
// MOOD → VOICE PARAMETER MAPPING
// -----------------------------------------------------------------------
// Each mood maps to SpeechSynthesis settings that create a noticeably
// different vocal character — faster/higher for excitement, slower/lower
// for sadness, etc.

const MOOD_VOICE_PARAMS = {
    excited:    { rate: 1.20, pitch: 1.30, volume: 1.0 },
    happy:      { rate: 1.05, pitch: 1.15, volume: 0.95 },
    curious:    { rate: 0.95, pitch: 1.10, volume: 0.90 },
    calm:       { rate: 0.85, pitch: 0.95, volume: 0.85 },
    anxious:    { rate: 1.15, pitch: 1.20, volume: 0.85 },
    sad:        { rate: 0.78, pitch: 0.80, volume: 0.70 },
    frustrated: { rate: 1.10, pitch: 0.85, volume: 1.0 },
    neutral:    { rate: 1.00, pitch: 1.00, volume: 0.90 },
};


// -----------------------------------------------------------------------
// STT — Speech-to-Text + Audio Recording
// -----------------------------------------------------------------------
// Two systems run in parallel during recording:
//   1. MediaRecorder — captures actual audio as a playable blob
//   2. SpeechRecognition — live-transcribes speech to text
//
// When the user clicks stop:
//   - A preview bar appears with play/pause, waveform, transcript
//   - User can listen to their recording, then send or discard

let recognition = null;       // SpeechRecognition instance
let mediaRecorder = null;     // MediaRecorder for audio capture
let audioStream = null;       // The MediaStream from getUserMedia
let audioChunks = [];         // Raw audio chunks from MediaRecorder
let recordedAudioBlob = null; // Final audio blob after stop
let recordedAudioUrl = null;  // Object URL for playback
let previewAudio = null;      // <audio> element for playback
let recordingTranscript = ""; // Accumulated transcript from STT
let recordingStartTime = 0;   // Timestamp when recording started
let recordingTimer = null;    // Interval for updating duration display
let sttWantActive = false;    // True when user wants recording on

// Preview bar DOM references (cached after first use)
let previewEl, btnPreviewPlay, btnPreviewSend, btnPreviewDiscard;
let previewDuration, previewTranscript, iconPlay, iconPause;

/**
 * Initialise the STT system — check browser support.
 */
function initSTT() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition && !navigator.mediaDevices) {
        console.warn("[Jarvish STT] No speech/recording APIs. Use Chrome or Edge.");
        btnMic.style.display = "none";
        return;
    }

    console.log("[Jarvish STT] APIs detected. Ready.");

    // Cache preview bar DOM references
    previewEl         = document.getElementById("recording-preview");
    btnPreviewPlay    = document.getElementById("btn-preview-play");
    btnPreviewSend    = document.getElementById("btn-preview-send");
    btnPreviewDiscard = document.getElementById("btn-preview-discard");
    previewDuration   = document.getElementById("preview-duration");
    previewTranscript = document.getElementById("preview-transcript");
    iconPlay          = document.getElementById("icon-play");
    iconPause         = document.getElementById("icon-pause");

    // Wire up preview bar buttons
    btnPreviewPlay.addEventListener("click", togglePreviewPlayback);
    btnPreviewSend.addEventListener("click", sendRecording);
    btnPreviewDiscard.addEventListener("click", discardRecording);

    // Initialise hands-free "Jarvish" wake-word listener
    initWakeWordListener();
}

/**
 * Create a SpeechRecognition instance for live transcription.
 * Re-created each session to avoid Chrome's stale-instance bug.
 */
function createRecognitionInstance() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return null;

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.maxAlternatives = 1;

    rec.onaudiostart = () => {
        console.log("[Jarvish STT] Audio capture started");
        showVoiceStatus("Microphone active — speak now...", "listening");
    };

    rec.onspeechstart = () => {
        console.log("[Jarvish STT] Speech detected");
        showVoiceStatus("Hearing you... keep speaking", "listening");
    };

    rec.onresult = (event) => {
        let interim = "";
        let final = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const t = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                final += t;
            } else {
                interim += t;
            }
        }

        // Show live transcription in the input field
        const currentText = interim || final;
        if (currentText) {
            userInput.value = recordingTranscript + currentText;
            userInput.style.height = "auto";
            userInput.style.height = Math.min(userInput.scrollHeight, 120) + "px";
            showVoiceStatus(`"${currentText.substring(0, 50)}..."`, "listening");
        }

        if (final) {
            recordingTranscript += final;
            console.log("[Jarvish STT] Transcript so far:", recordingTranscript);
        }
    };

    rec.onend = () => {
        console.log("[Jarvish STT] Recognition ended. wantActive:", sttWantActive);
        // Auto-restart if user hasn't clicked stop yet
        if (sttWantActive && isRecording) {
            try {
                const newRec = createRecognitionInstance();
                if (newRec) {
                    recognition = newRec;
                    recognition.start();
                }
            } catch (e) {
                console.warn("[Jarvish STT] Auto-restart failed:", e);
            }
        }
    };

    rec.onerror = (event) => {
        console.error("[Jarvish STT] Error:", event.error);
        if (event.error === "not-allowed") {
            showVoiceStatus("⚠ Mic blocked — click 🔒 in address bar → allow mic", "listening");
            setTimeout(hideVoiceStatus, 6000);
            stopRecording();
        } else if (event.error === "no-speech") {
            showVoiceStatus("No speech heard — keep talking...", "listening");
            // Let onend auto-restart
        } else if (event.error !== "aborted") {
            showVoiceStatus(`⚠ Voice error: ${event.error}`, "listening");
            setTimeout(hideVoiceStatus, 4000);
        }
    };

    return rec;
}


// -----------------------------------------------------------------------
// WAKE-WORD LISTENER ("Jarvish" hands-free voice activation)
// -----------------------------------------------------------------------
let wakeWordRecognizer = null;
let wakeWordEnabled = true;
let wakeWordCooldown = false;
let wakeWordBadge = null;

function initWakeWordListener() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    wakeWordBadge = document.getElementById("wake-word-badge");

    if (!SpeechRecognition) {
        console.warn("[Jarvish WakeWord] SpeechRecognition API not supported.");
        if (wakeWordBadge) wakeWordBadge.style.display = "none";
        return;
    }

    try {
        wakeWordRecognizer = new SpeechRecognition();
        wakeWordRecognizer.continuous = true;
        wakeWordRecognizer.interimResults = true;
        wakeWordRecognizer.lang = "en-US";
        wakeWordRecognizer.maxAlternatives = 1;

        wakeWordRecognizer.onresult = (event) => {
            if (isRecording || wakeWordCooldown) return;

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript.toLowerCase();

                // Check for wake word variations: "jarvish", "jarvis", "javis", "jarv"
                if (transcript.includes("jarvish") || transcript.includes("jarvis") || transcript.includes("javis") || transcript.includes("jarv")) {
                    console.log("[Jarvish WakeWord] Detected wake-word 'Jarvish' in transcript:", transcript);

                    wakeWordCooldown = true;
                    setTimeout(() => { wakeWordCooldown = false; }, 1800);

                    // Toggle mic recording (ON if OFF, OFF if ON)
                    toggleRecording();
                    break;
                }
            }
        };

        wakeWordRecognizer.onend = () => {
            // Auto-restart background wake-word listener if enabled and not currently recording message
            if (wakeWordEnabled && !isRecording) {
                setTimeout(() => {
                    if (wakeWordEnabled && !isRecording && wakeWordRecognizer) {
                        try {
                            wakeWordRecognizer.start();
                        } catch (e) {
                            // Ignored if already running
                        }
                    }
                }, 300);
            }
        };

        wakeWordRecognizer.onerror = (event) => {
            console.warn("[Jarvish WakeWord] Error:", event.error);
            if (event.error === "not-allowed" || event.error === "service-not-allowed") {
                wakeWordEnabled = false;
                if (wakeWordBadge) wakeWordBadge.style.display = "none";
            }
        };

        // Start listening for wake-word
        startWakeWordListening();

        // Pause/resume when tab focus changes
        window.addEventListener("blur", stopWakeWordListening);
        window.addEventListener("focus", startWakeWordListening);

    } catch (e) {
        console.warn("[Jarvish WakeWord] Initialization failed:", e);
        if (wakeWordBadge) wakeWordBadge.style.display = "none";
    }
}

function startWakeWordListening() {
    if (!wakeWordEnabled || isRecording || !wakeWordRecognizer) return;
    try {
        wakeWordRecognizer.start();
        if (wakeWordBadge) {
            wakeWordBadge.classList.add("listening");
            wakeWordBadge.title = "Hands-free wake-word 'Jarvish' ACTIVE — say 'Jarvish' to toggle mic";
        }
    } catch (e) {
        // Ignored if already started
    }
}

function stopWakeWordListening() {
    if (!wakeWordRecognizer) return;
    try {
        wakeWordRecognizer.stop();
        if (wakeWordBadge) {
            wakeWordBadge.classList.remove("listening");
        }
    } catch (e) {
        // Ignored if already stopped
    }
}

/**
 * Toggle recording on/off when the mic button is clicked.
 */
async function toggleRecording() {
    if (isRecording) {
        stopRecording();
        return;
    }

    // Stop any TTS
    stopSpeaking();
    // Hide any existing preview
    hidePreviewBar();

    // ---- Get microphone access ----
    try {
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log("[Jarvish Recorder] Microphone stream obtained");
    } catch (err) {
        console.error("[Jarvish Recorder] Mic error:", err.name);
        if (err.name === "NotAllowedError") {
            showVoiceStatus("⚠ Mic blocked — click 🔒 in address bar → allow mic", "listening");
        } else if (err.name === "NotFoundError") {
            showVoiceStatus("⚠ No microphone found. Connect one and try again.", "listening");
        } else {
            showVoiceStatus(`⚠ Mic error: ${err.message}`, "listening");
        }
        setTimeout(hideVoiceStatus, 5000);
        return;
    }

    // ---- Start MediaRecorder (captures audio) ----
    audioChunks = [];
    recordingTranscript = "";
    userInput.value = "";

    try {
        mediaRecorder = new MediaRecorder(audioStream, {
            mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
                ? "audio/webm;codecs=opus"
                : "audio/webm"
        });
    } catch (e) {
        // Fallback for browsers with limited codec support
        mediaRecorder = new MediaRecorder(audioStream);
    }

    mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
            audioChunks.push(event.data);
            // # TODO Day 6: Stream audio chunk to websocket in real-time here
        }
    };

    mediaRecorder.onstop = async () => {
        console.log("[Jarvish Recorder] MediaRecorder stopped, chunks:", audioChunks.length);
        
        // Collect recorded audio blob
        recordedAudioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
        
        // Enter processing state
        btnMic.classList.remove("recording");
        btnMic.classList.add("processing");
        showVoiceStatus("Processing voice with Deepgram...", "listening");

        try {
            const formData = new FormData();
            formData.append("file", recordedAudioBlob, "voice.webm");

            const response = await fetch("/api/transcribe", {
                method: "POST",
                body: formData
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || `Server error (${response.status})`);
            }

            const data = await response.json();
            const transcript = data.transcript ? data.transcript.trim() : "";

            if (transcript) {
                userInput.value = transcript;
                btnSend.disabled = false;
                
                // Hide voice status
                hideVoiceStatus();
                
                // Auto-submit to the existing /api/chat endpoint
                await sendMessage();
            } else {
                showVoiceStatus("No speech detected. Try again.", "listening");
                setTimeout(hideVoiceStatus, 3000);
            }
        } catch (err) {
            console.error("[Jarvish STT] Deepgram transcription failed:", err);
            showVoiceStatus(`⚠ Voice recognition failed: ${err.message}`, "listening");
            setTimeout(hideVoiceStatus, 5000);
        } finally {
            btnMic.classList.remove("processing");
        }
    };

    mediaRecorder.start(250); // Collect data every 250ms
    console.log("[Jarvish Recorder] Recording started");

    // ---- UI updates ----
    isRecording = true;
    stopWakeWordListening(); // Pause background wake-word recognizer while active recording
    btnMic.classList.remove("processing");
    btnMic.classList.add("recording");
    recordingStartTime = Date.now();
    startRecordingTimer();
    showVoiceStatus("Recording... click 🎤 again to stop", "listening");
}

/**
 * Stop MediaRecorder.
 */
function stopRecording() {
    isRecording = false;
    btnMic.classList.remove("recording");
    stopRecordingTimer();

    // Stop MediaRecorder (triggers onstop → call Deepgram endpoint)
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
    }

    // Release microphone
    if (audioStream) {
        audioStream.getTracks().forEach(t => t.stop());
        audioStream = null;
    }

    // Resume background wake-word listener
    setTimeout(startWakeWordListening, 600);

    hideVoiceStatus();
}

/**
 * Update the duration display every second while recording.
 */
function startRecordingTimer() {
    stopRecordingTimer();
    recordingTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        showVoiceStatus(
            `Recording ${mins}:${secs.toString().padStart(2, "0")} — click 🎤 to stop`,
            "listening"
        );
    }, 1000);
}

function stopRecordingTimer() {
    if (recordingTimer) {
        clearInterval(recordingTimer);
        recordingTimer = null;
    }
}

/**
 * Update UI for recording state (kept for compatibility).
 */
function setRecordingState(recording) {
    isRecording = recording;
    if (recording) {
        btnMic.classList.add("recording");
    } else {
        btnMic.classList.remove("recording");
        hideVoiceStatus();
    }
}


// -----------------------------------------------------------------------
// PREVIEW BAR — Play, Send, Discard
// -----------------------------------------------------------------------

/**
 * Show the recording preview bar with playback controls.
 */
function showPreviewBar() {
    // Set duration display
    const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    previewDuration.textContent = `${mins}:${secs.toString().padStart(2, "0")}`;

    // Set transcript (or fallback message)
    if (recordingTranscript.trim()) {
        previewTranscript.textContent = `"${recordingTranscript.trim()}"`;
    } else {
        previewTranscript.textContent = "(no speech detected — you can still play the audio)";
    }

    // Reset play/pause icons
    setPreviewPlaying(false);

    // Show the bar
    previewEl.style.display = "flex";
}

/**
 * Hide the preview bar and clean up audio resources.
 */
function hidePreviewBar() {
    if (previewEl) previewEl.style.display = "none";

    // Stop and clean up audio
    if (previewAudio) {
        previewAudio.pause();
        previewAudio = null;
    }
    if (recordedAudioUrl) {
        URL.revokeObjectURL(recordedAudioUrl);
        recordedAudioUrl = null;
    }
    recordedAudioBlob = null;
    setPreviewPlaying(false);
}

/**
 * Toggle play/pause of the recorded audio.
 */
function togglePreviewPlayback() {
    if (!previewAudio) return;

    if (previewAudio.paused) {
        previewAudio.play();
        setPreviewPlaying(true);
    } else {
        previewAudio.pause();
        setPreviewPlaying(false);
    }
}

/**
 * Update play/pause icon and waveform animation state.
 */
function setPreviewPlaying(playing) {
    if (!iconPlay || !iconPause || !previewEl) return;

    if (playing) {
        iconPlay.style.display = "none";
        iconPause.style.display = "";
        previewEl.classList.add("playing");
    } else {
        iconPlay.style.display = "";
        iconPause.style.display = "none";
        previewEl.classList.remove("playing");
    }
}

/**
 * Send the transcribed text from the recording as a message.
 */
function sendRecording() {
    const text = recordingTranscript.trim() || userInput.value.trim();
    if (!text) {
        showVoiceStatus("Nothing to send — no speech was detected", "listening");
        setTimeout(hideVoiceStatus, 3000);
        return;
    }

    // Put transcript in input and send
    userInput.value = text;
    btnSend.disabled = false;
    hidePreviewBar();
    sendMessage();
}

/**
 * Discard the recording without sending.
 */
function discardRecording() {
    hidePreviewBar();
    userInput.value = "";
    btnSend.disabled = true;
    recordingTranscript = "";
    userInput.focus();
}


// -----------------------------------------------------------------------
// TTS — Text-to-Speech via Web Speech API SpeechSynthesis
// -----------------------------------------------------------------------

let selectedVoice = null;  // Preferred voice (chosen once on load)

/**
 * Initialise TTS and select the best available voice.
 *
 * We prefer voices in this order:
 *   1. A Google-provided English voice (highest quality on Chrome)
 *   2. Any English female voice (tends to sound more natural)
 *   3. Any English voice
 *   4. The browser default
 *
 * Voices may load asynchronously, so we listen for the voiceschanged event.
 */
function initTTS() {
    if (!window.speechSynthesis) {
        console.warn("SpeechSynthesis not supported. Voice output disabled.");
        btnVoiceToggle.style.display = "none";
        voiceEnabled = false;
        return;
    }

    // Voices may already be loaded or may load async
    selectBestVoice();
    window.speechSynthesis.onvoiceschanged = selectBestVoice;
}

/**
 * Pick the best available English voice from the system.
 */
function selectBestVoice() {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return;

    // Priority 1: Google English voice (best quality in Chrome)
    const googleVoice = voices.find(v =>
        v.name.includes("Google") && v.lang.startsWith("en")
    );
    if (googleVoice) { selectedVoice = googleVoice; return; }

    // Priority 2: Any English female voice
    const femaleVoice = voices.find(v =>
        v.lang.startsWith("en") && /female|samantha|zira|hazel/i.test(v.name)
    );
    if (femaleVoice) { selectedVoice = femaleVoice; return; }

    // Priority 3: Any English voice
    const englishVoice = voices.find(v => v.lang.startsWith("en"));
    if (englishVoice) { selectedVoice = englishVoice; return; }

    // Priority 4: Default
    selectedVoice = voices[0];
}

/**
 * Speak text using SpeechSynthesis with mood-reactive parameters.
 *
 * The mood label controls pitch, rate, and volume to create an
 * emotionally expressive voice — excited speech is faster and
 * higher-pitched, sad speech is slower and softer, etc.
 *
 * @param {string} text - The text to speak
 * @param {string} mood - The current mood label
 */
function speakText(text, mood = "neutral") {
    if (!window.speechSynthesis || (!voiceEnabled && !avatarEnabled)) return;

    // Cancel any ongoing speech first
    stopSpeaking();

    // Strip markdown formatting for cleaner speech
    const cleanText = stripMarkdown(text);
    if (!cleanText.trim()) return;

    const utterance = new SpeechSynthesisUtterance(cleanText);

    // Apply mood-reactive voice parameters
    const params = MOOD_VOICE_PARAMS[mood] || MOOD_VOICE_PARAMS.neutral;
    utterance.rate   = params.rate;
    utterance.pitch  = params.pitch;
    utterance.volume = params.volume;

    // Use our preferred voice if available
    if (selectedVoice) {
        utterance.voice = selectedVoice;
    }

    // Start visual speaking indicator & lip-sync animation immediately
    isSpeaking = true;
    if (orbContainer) orbContainer.classList.add("orb-speaking");
    showVoiceStatus("Speaking...", "speaking");
    if (avatarEnabled) {
        startProceduralLipSync();
    }

    utterance.onstart = () => {
        isSpeaking = true;
        if (orbContainer) orbContainer.classList.add("orb-speaking");
        showVoiceStatus("Speaking...", "speaking");
        if (avatarEnabled) {
            startProceduralLipSync();
        }
    };

    utterance.onend = () => {
        isSpeaking = false;
        if (orbContainer) orbContainer.classList.remove("orb-speaking");
        hideVoiceStatus();
        stopLipSyncAnimation();
    };

    utterance.onerror = (e) => {
        if (e.error !== "interrupted") {
            console.warn("TTS error:", e.error);
        }
        isSpeaking = false;
        if (orbContainer) orbContainer.classList.remove("orb-speaking");
        hideVoiceStatus();
        stopLipSyncAnimation();
    };

    window.speechSynthesis.speak(utterance);
    startChromeTTSWorkaround();
}

let currentAudio = null;
let elevenLabsFallbackActive = false;

function stopSpeaking() {
    if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
    stopLipSyncAnimation();
    isSpeaking = false;
    if (orbContainer) orbContainer.classList.remove("orb-speaking");
    hideVoiceStatus();
    stopChromeTTSWorkaround();
}

/**
 * Chrome workaround: long utterances (>15s) can stall. Pausing and
 * resuming every 10s keeps the audio pipeline alive.
 */
let chromeTTSTimer = null;

function startChromeTTSWorkaround() {
    stopChromeTTSWorkaround();
    chromeTTSTimer = setInterval(() => {
        if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
            window.speechSynthesis.pause();
            window.speechSynthesis.resume();
        } else if (!window.speechSynthesis.speaking) {
            stopChromeTTSWorkaround();
        }
    }, 10000);
}

function stopChromeTTSWorkaround() {
    if (chromeTTSTimer) {
        clearInterval(chromeTTSTimer);
        chromeTTSTimer = null;
    }
}

/**
 * Strip markdown, emojis, special characters, and other non-speakable
 * content from text so TTS only reads natural language.
 */
function stripMarkdown(text) {
    return text
        // ---- Markdown formatting ----
        .replace(/```[\s\S]*?```/g, ". code example omitted. ")  // Code blocks
        .replace(/`([^`]+)`/g, "$1")           // Inline code → just the text
        .replace(/\*\*(.+?)\*\*/g, "$1")       // Bold **text** → text
        .replace(/\*(.+?)\*/g, "$1")           // Italic *text* → text
        .replace(/__(.+?)__/g, "$1")           // Bold __text__ → text
        .replace(/_(.+?)_/g, "$1")             // Italic _text_ → text
        .replace(/~~(.+?)~~/g, "$1")           // Strikethrough ~~text~~ → text
        .replace(/^\s*[-•*]\s/gm, "")          // Bullet markers (-, •, *)
        .replace(/^\s*\d+[.)]\s/gm, "")        // Numbered list markers
        .replace(/#{1,6}\s/g, "")              // Heading markers (# ## ###)
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Links [text](url) → text
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1") // Images ![alt](url) → alt
        .replace(/^>\s?/gm, "")                // Blockquote markers
        .replace(/---+/g, "")                  // Horizontal rules
        .replace(/\|/g, " ")                   // Table pipes

        // ---- URLs and emails ----
        .replace(/https?:\/\/[^\s]+/g, "")     // URLs
        .replace(/www\.[^\s]+/g, "")           // www links
        .replace(/[\w.-]+@[\w.-]+\.\w+/g, "")  // Email addresses

        // ---- Emojis and special Unicode ----
        // Matches most emoji ranges including emoticons, symbols, flags
        .replace(/[\u{1F600}-\u{1F64F}]/gu, "")   // Emoticons (😀-🙏)
        .replace(/[\u{1F300}-\u{1F5FF}]/gu, "")   // Misc symbols & pictographs
        .replace(/[\u{1F680}-\u{1F6FF}]/gu, "")   // Transport & map symbols
        .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, "")   // Flags
        .replace(/[\u{2600}-\u{26FF}]/gu, "")      // Misc symbols (☀★☎)
        .replace(/[\u{2700}-\u{27BF}]/gu, "")      // Dingbats (✂✈✉)
        .replace(/[\u{FE00}-\u{FE0F}]/gu, "")      // Variation selectors
        .replace(/[\u{1F900}-\u{1F9FF}]/gu, "")   // Supplemental symbols
        .replace(/[\u{1FA00}-\u{1FA6F}]/gu, "")   // Chess symbols etc
        .replace(/[\u{1FA70}-\u{1FAFF}]/gu, "")   // Symbols extended-A
        .replace(/[\u{200D}]/gu, "")               // Zero-width joiner (emoji combiner)
        .replace(/[\u{20E3}]/gu, "")               // Combining enclosing keycap
        .replace(/[\u{FE0F}]/gu, "")               // Variation selector-16

        // ---- Special characters that sound bad spoken ----
        .replace(/[*_~`#>|\\]/g, "")           // Remaining markdown chars
        .replace(/\{[^}]*\}/g, "")             // Curly brace blocks {code}
        .replace(/\[[^\]]*\]/g, "")            // Square bracket blocks [ref]
        .replace(/\([^)]*\)/g, "")             // Parenthetical asides (optional)
        .replace(/["""]/g, "")                 // Smart and straight quotes
        .replace(/[<>]/g, "")                  // Angle brackets
        .replace(/&[a-z]+;/gi, "")             // HTML entities (&amp; etc)

        // ---- Clean up whitespace and punctuation ----
        .replace(/([.!?])\1+/g, "$1")          // Repeated punctuation ... → .
        .replace(/\n{2,}/g, ". ")              // Double newlines → sentence break
        .replace(/\n/g, " ")                   // Single newlines → space
        .replace(/\s{2,}/g, " ")               // Collapse multiple spaces
        .trim();
}


// -----------------------------------------------------------------------
// VOICE TOGGLE
// -----------------------------------------------------------------------

/**
 * Toggle voice output on/off via the speaker button in the header.
 */
function toggleVoiceOutput() {
    voiceEnabled = !voiceEnabled;

    // If we just disabled voice, stop any ongoing speech
    if (!voiceEnabled) {
        stopSpeaking();
    }

    updateVoiceToggleUI();
}

/**
 * Update the speaker icon to reflect the current voice toggle state.
 */
function updateVoiceToggleUI() {
    if (voiceEnabled) {
        btnVoiceToggle.classList.add("active");
        iconSpeakerOn.style.display = "";
        iconSpeakerOff.style.display = "none";
        btnVoiceToggle.title = "Voice responses ON (click to mute)";
    } else {
        btnVoiceToggle.classList.remove("active");
        iconSpeakerOn.style.display = "none";
        iconSpeakerOff.style.display = "";
        btnVoiceToggle.title = "Voice responses OFF (click to unmute)";
    }
}


// -----------------------------------------------------------------------
// VOICE STATUS BAR
// -----------------------------------------------------------------------

/**
 * Show the voice status bar below the input.
 * @param {string} text  - Status message to display
 * @param {string} state - "listening" or "speaking" (controls dot colour)
 */
function showVoiceStatus(text, state = "listening") {
    voiceStatus.style.display = "flex";
    voiceStatusText.textContent = text;
    voiceStatusDot.className = `voice-status-dot ${state}`;
}

/**
 * Hide the voice status bar.
 */
function hideVoiceStatus() {
    voiceStatus.style.display = "none";
}


// =======================================================================
// MEMORY SIDEBAR ACTIONS & API
// =======================================================================

/**
 * Open the memory sidebar.
 */
function toggleSidebar() {
    memorySidebar.classList.toggle("open");
    sidebarOverlay.classList.toggle("active");
    if (memorySidebar.classList.contains("open")) {
        loadConversationList();
    }
}

/**
 * Close the memory sidebar.
 */
function closeSidebar() {
    memorySidebar.classList.remove("open");
    sidebarOverlay.classList.remove("active");
}

/**
 * Fetch the conversation headers from the Flask API.
 */
async function loadConversationList() {
    try {
        const response = await fetch("/api/conversations");
        if (!response.ok) throw new Error("Failed to load conversations");
        conversations = await response.json();
        renderConversationList(conversations);
    } catch (e) {
        console.error("[Jarvish History] Error loading list:", e);
    }
}

/**
 * Render the conversation list dynamically in the sidebar.
 * Includes helper for formatting relative or short dates.
 */
function renderConversationList(listToRender) {
    // Clear list but preserve empty state template if list is empty
    const emptyState = document.getElementById("sidebar-empty");

    // Remove all previous cards
    const cards = conversationList.querySelectorAll(".conv-card");
    cards.forEach(c => c.remove());

    if (listToRender.length === 0) {
        if (emptyState) emptyState.style.display = "flex";
        return;
    }

    if (emptyState) emptyState.style.display = "none";

    listToRender.forEach(conv => {
        const card = document.createElement("div");
        card.className = `conv-card ${activeConversationId === conv.id ? "active" : ""}`;
        card.dataset.id = conv.id;

        // Formats ISO date to a friendly short form
        let dateStr = "";
        if (conv.updated_at) {
            try {
                const date = new Date(conv.updated_at);
                dateStr = date.toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit"
                });
            } catch (e) {
                dateStr = conv.updated_at.split("T")[0];
            }
        }

        card.innerHTML = `
            <span class="conv-mood-dot" data-mood="${conv.last_mood || "neutral"}"></span>
            <div class="conv-info">
                <div class="conv-title" title="Double click to rename">${escapeHtml(conv.title)}</div>
                <div class="conv-meta">
                    <span class="conv-msg-count">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                        </svg>
                        ${conv.message_count || 0}
                    </span>
                    <span>•</span>
                    <span>${dateStr}</span>
                </div>
            </div>
            <button class="conv-delete" title="Delete conversation" aria-label="Delete conversation">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    <line x1="10" y1="11" x2="10" y2="17"/>
                    <line x1="14" y1="11" x2="14" y2="17"/>
                </svg>
            </button>
        `;

        // Load conversation on card click (except when clicking delete/rename)
        card.addEventListener("click", (e) => {
            if (e.target.closest(".conv-delete")) return;
            loadConversation(conv.id);
        });

        // Double-click to rename title
        const titleEl = card.querySelector(".conv-title");
        titleEl.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            renameConversationUI(conv.id, titleEl);
        });

        // Delete conversation button handler
        const deleteBtn = card.querySelector(".conv-delete");
        deleteBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            deleteConversation(conv.id);
        });

        conversationList.appendChild(card);
    });
}

/**
 * Filter the sidebar conversation cards in real-time as user types in search.
 */
function filterConversations() {
    const query = searchInput.value.toLowerCase().trim();
    if (!query) {
        renderConversationList(conversations);
        return;
    }

    const filtered = conversations.filter(conv =>
        conv.title.toLowerCase().includes(query)
    );
    renderConversationList(filtered);
}

/**
 * Load a conversation by its ID, render all messages, and update state.
 */
async function loadConversation(id) {
    if (isWaiting) return; // Don't interrupt if bot is thinking

    stopSpeaking(); // Stop current TTS

    try {
        const response = await fetch(`/api/conversations/${id}/load`, {
            method: "POST"
        });

        if (!response.ok) throw new Error("Load failed");

        const data = await response.json();

        // Update active ID
        activeConversationId = id;

        // Update mood visuals
        updateMood(data.mood, data.valence, data.arousal);

        // Clear existing message bubbles in chat UI
        messagesEl.innerHTML = "";

        // Re-render message bubbles from loaded history
        data.messages.forEach(msg => {
            const sender = msg.role === "user" ? "user" : "bot";
            // For loaded bot messages, use the saved last mood or fallback to neutral
            addMessage(msg.text, sender, sender === "bot" ? data.mood : null);
        });

        // Update sidebar visual active states
        document.querySelectorAll(".conv-card").forEach(card => {
            card.classList.toggle("active", card.dataset.id === id);
        });

        // Close sidebar on mobile/smaller screens for convenience
        if (window.innerWidth < 768) {
            closeSidebar();
        }

        userInput.focus();

    } catch (e) {
        console.error("[Jarvish History] Load failed:", e);
        addMessage("Failed to load conversation history.", "bot", "error");
    }
}

/**
 * Delete a conversation. Prompt for confirmation.
 */
async function deleteConversation(id) {
    if (!confirm("Are you sure you want to delete this conversation?")) return;

    try {
        const response = await fetch(`/api/conversations/${id}`, {
            method: "DELETE"
        });

        if (!response.ok) throw new Error("Delete failed");

        // If the deleted conversation was the active one, clear chat area
        if (activeConversationId === id) {
            activeConversationId = null;
            messagesEl.innerHTML = "";
            addMessage(
                "Hey there! 👋 I'm **Jarvish**, your AI study buddy. Ask me anything — from quantum physics to Shakespeare — and I'll make it click.\n\nWhat are you working on today?",
                "bot",
                "neutral"
            );
            updateMood("neutral");
        }

        // Refresh sidebar
        loadConversationList();

    } catch (e) {
        console.error("[Jarvish History] Delete failed:", e);
        alert("Failed to delete conversation.");
    }
}

/**
 * Turn conversation card title into an input box to allow inline renaming.
 */
function renameConversationUI(id, titleEl) {
    const originalText = titleEl.textContent;

    const input = document.createElement("input");
    input.type = "text";
    input.value = originalText;
    input.className = "conv-rename-input";
    input.style.width = "100%";
    input.style.background = "rgba(255, 255, 255, 0.08)";
    input.style.border = "1px solid var(--mood-color)";
    input.style.borderRadius = "4px";
    input.style.color = "var(--text-primary)";
    input.style.padding = "2px 4px";
    input.style.fontSize = "inherit";
    input.style.fontFamily = "inherit";

    titleEl.replaceWith(input);
    input.focus();
    input.select();

    const saveRename = async () => {
        const newTitle = input.value.trim();
        if (!newTitle || newTitle === originalText) {
            input.replaceWith(titleEl);
            return;
        }

        try {
            const response = await fetch(`/api/conversations/${id}/rename`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: newTitle })
            });

            if (!response.ok) throw new Error("Rename failed");

            titleEl.textContent = newTitle;
            input.replaceWith(titleEl);

            // Update in local memory array & reload
            const convObj = conversations.find(c => c.id === id);
            if (convObj) convObj.title = newTitle;

        } catch (e) {
            console.error("[Jarvish History] Rename failed:", e);
            alert("Failed to rename conversation.");
            input.replaceWith(titleEl);
        }
    };

    // Save on Enter, cancel on Escape
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            saveRename();
        } else if (e.key === "Escape") {
            input.replaceWith(titleEl);
        }
    });

    // Save if clicked outside
    input.addEventListener("blur", saveRename);
}


// =======================================================================
// LANDING PAGE LIFECYCLE (Splash -> Welcome Screens)
// =======================================================================

/**
 * Initialise the 2-second Splash -> Welcome Screen landing page overlay lifecycle.
 */
function initLandingPage() {
    const landingPage = document.getElementById("landing-page");
    const splashScreen = document.getElementById("splash-screen");
    const welcomeScreen = document.getElementById("welcome-screen");
    const btnStartChat = document.getElementById("btn-start-chat");

    if (!landingPage || !splashScreen || !welcomeScreen || !btnStartChat) return;

    // Screen 1: Splash transitions to Welcome after 2 seconds
    setTimeout(() => {
        splashScreen.classList.add("fade-out");

        setTimeout(() => {
            splashScreen.style.display = "none";
            welcomeScreen.classList.remove("hidden");
            welcomeScreen.classList.add("visible");

            // Stagger fade-in for welcome elements (~200ms apart)
            const staggerItems = welcomeScreen.querySelectorAll(".stagger-item");
            staggerItems.forEach((item, index) => {
                setTimeout(() => {
                    item.classList.add("show");
                }, index * 200);
            });
        }, 500); // 500ms fade transition
    }, 2000);

    // Clicking "Start Chatting" fades out landing overlay to reveal chat
    btnStartChat.addEventListener("click", () => {
        landingPage.classList.add("fade-out");
        
        setTimeout(() => {
            landingPage.style.display = "none";
            // Focus input field for immediate engagement
            userInput.focus();
        }, 500); // 500ms transition
    });
}


/**
 * Speak bot reply using ElevenLabs TTS API.
 * Maps stability/similarity values on the server based on mood.
 * Bypasses the call and falls back gracefully if muted.
 *
 * @param {string} text - The reply text
 * @param {string} mood - The bot's mood
 */
async function speakReply(text, mood = "neutral") {
    // 1. Check voice/avatar enabled states
    if (!voiceEnabled && !avatarEnabled) return;

    // 1b. If ElevenLabs quota is exceeded, silently switch to browser voice
    if (elevenLabsFallbackActive) {
        speakText(text, mood);
        return;
    }

    // 2. Stop any current speech
    stopSpeaking();

    // Strip markdown formatting for cleaner speech
    const cleanText = stripMarkdown(text);
    if (!cleanText.trim()) return;

    try {
        isSpeaking = true;
        if (orbContainer) orbContainer.classList.add("orb-speaking");
        showVoiceStatus("Speaking...", "speaking");
        if (avatarEnabled) {
            startProceduralLipSync();
        }

        // 3. Fetch ElevenLabs MP3 stream
        const response = await fetch("/api/speak", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ text: cleanText, mood: mood })
        });

        // 4. Check response.ok to prevent crashing on error payloads
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            console.error("ElevenLabs TTS failed on server side:", err.error || response.status);
            
            isSpeaking = false;
            if (orbContainer) orbContainer.classList.remove("orb-speaking");
            hideVoiceStatus();

            // Detect quota/limit issues from status code or server error message
            const isQuotaExceeded = response.status === 429 || 
                                    response.status === 401 ||
                                    (err.error && (
                                        err.error.toLowerCase().includes("quota") || 
                                        err.error.toLowerCase().includes("limit") ||
                                        err.error.toLowerCase().includes("insufficient")
                                    ));

            if (isQuotaExceeded) {
                // Set fallback state so future turns bypass fetch calls
                elevenLabsFallbackActive = true;
                
                // Show a message informing the user
                addMessage("⚠️ ElevenLabs voice limit reached. Switched to browser voice fallback.", "bot", "error");
            }

            // Fall back to the standard browser TTS
            speakText(text, mood);
            return;
        }

        let audioUrl;
        let visemes = null;

        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
            const data = await response.json();
            audioUrl = "data:audio/mpeg;base64," + data.audio;
            if (Array.isArray(data.visemes) && data.visemes.length > 0) {
                visemes = data.visemes;
            }
        } else {
            const blob = await response.blob();
            audioUrl = URL.createObjectURL(blob);
        }

        const audio = new Audio(audioUrl);
        currentAudio = audio;

        audio.onended = () => {
            if (!contentType.includes("application/json")) {
                URL.revokeObjectURL(audioUrl);
            }
            if (currentAudio === audio) {
                currentAudio = null;
                isSpeaking = false;
                if (orbContainer) orbContainer.classList.remove("orb-speaking");
                hideVoiceStatus();
                stopLipSyncAnimation();
            }
        };

        audio.onerror = (e) => {
            console.error("Audio playback error:", e);
            if (!contentType.includes("application/json")) {
                URL.revokeObjectURL(audioUrl);
            }
            if (currentAudio === audio) {
                currentAudio = null;
                isSpeaking = false;
                if (orbContainer) orbContainer.classList.remove("orb-speaking");
                hideVoiceStatus();
                stopLipSyncAnimation();
            }
            // Fall back to browser TTS if playback error occurs
            speakText(text, mood);
        };

        // 5. Hook up lip-sync animation (Rhubarb visemes vs Web Audio amplitude fallback)
        if (avatarEnabled) {
            if (visemes) {
                startVisemeLipSync(visemes, audio);
            } else {
                try {
                    const ctx = getAudioContext();
                    if (ctx.state === "suspended") {
                        await ctx.resume();
                    }

                    if (audioSourceNode) {
                        try {
                            audioSourceNode.disconnect();
                        } catch (e) {}
                    }

                    audioSourceNode = ctx.createMediaElementSource(audio);
                    audioSourceNode.connect(analyser);
                    analyser.connect(ctx.destination);

                    startLipSyncAnimation();
                } catch (e) {
                    console.warn("Web Audio API analyser hook failed, using procedural lip-sync:", e);
                    startProceduralLipSync();
                }
            }
        }

        // 6. Play audio via the Audio Web API
        await audio.play();
    } catch (error) {
        console.error("Error playing audio reply:", error);
        isSpeaking = false;
        if (orbContainer) orbContainer.classList.remove("orb-speaking");
        hideVoiceStatus();
        stopLipSyncAnimation();
        
        // Fall back to standard browser TTS on any unexpected network error
        speakText(text, mood);
    }
}

// -----------------------------------------------------------------------
// AI AVATAR VIDEO GENERATION
// -----------------------------------------------------------------------

/**
 * Toggle avatar output on/off.
 */
function toggleAvatarOutput() {
    avatarEnabled = !avatarEnabled;
    updateAvatarToggleUI();

    if (!avatarEnabled) {
        stopLipSyncAnimation();
    }
}

/**
 * Update avatar toggle button visual state in header.
 */
function updateAvatarToggleUI() {
    const panelAvatar = document.getElementById("panel-avatar");
    const splitDivider = document.getElementById("split-divider");

    if (!btnAvatarToggle) return;

    if (avatarEnabled) {
        btnAvatarToggle.classList.add("active");
        btnAvatarToggle.title = "Video Avatar ON (click to hide)";
        if (panelAvatar) panelAvatar.style.display = "flex";
        if (splitDivider) splitDivider.style.display = "block";
    } else {
        btnAvatarToggle.classList.remove("active");
        btnAvatarToggle.title = "Video Avatar OFF (click to show)";
        if (panelAvatar) panelAvatar.style.display = "none";
        if (splitDivider) splitDivider.style.display = "none";
        stopLipSyncAnimation();
    }
}

/**
 * Generate AI talking avatar using SadTalker API.
 */
// -----------------------------------------------------------------------
// Real-Time Lip-Sync Web Audio API Implementation
// -----------------------------------------------------------------------
let audioCtx = null;
let analyser = null;
let dataArray = null;
let animationFrameId = null;
let audioSourceNode = null;
let proceduralInterval = null;

/**
 * Get or initialize the unified AudioContext and AnalyserNode.
 * Must be called as part of a user-gesture handler (e.g. keydown, click) to satisfy autoplay policy.
 */
function getAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64; // Small fftSize for fast, real-time volume detection
        const bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
    }
    return audioCtx;
}

/**
 * Setup a user interaction listener to resume the AudioContext proactively
 * to prevent modern browsers from blocking dynamic audio analysis.
 */
function initAudioContextResume() {
    const resumeHandler = () => {
        try {
            const ctx = getAudioContext();
            if (ctx && ctx.state === "suspended") {
                ctx.resume().then(() => {
                    console.log("[Jarvish Audio] AudioContext resumed successfully.");
                });
            }
        } catch (e) {
            console.warn("Failed to resume AudioContext:", e);
        }
    };

    // Attach to common user-gesture elements
    document.addEventListener("click", resumeHandler, { once: true });
    document.addEventListener("keydown", resumeHandler, { once: true });
    
    // Explicit UI event buttons
    const sendBtn = document.getElementById("btn-send");
    if (sendBtn) sendBtn.addEventListener("click", resumeHandler);

    const micBtn = document.getElementById("btn-mic");
    if (micBtn) micBtn.addEventListener("click", resumeHandler);

    const welcomeCta = document.querySelector(".welcome-screen button");
    if (welcomeCta) welcomeCta.addEventListener("click", resumeHandler);
}

// Initialize gesture recovery listeners
initAudioContextResume();

// -----------------------------------------------------------------------
// Rhubarb Viseme Timeline Lip-Sync Implementation
// -----------------------------------------------------------------------

const VISEME_TRANSFORMS = {
    X: { scaleY: 1.00, scaleX: 1.00 }, // Silence / Rest (closed mouth)
    A: { scaleY: 1.15, scaleX: 1.00 }, // Parted lips (M, B, P)
    B: { scaleY: 1.30, scaleX: 1.02 }, // Teeth / EE / S / T
    C: { scaleY: 1.45, scaleX: 1.01 }, // Open mouth (EH, AE, I)
    D: { scaleY: 1.55, scaleX: 0.98 }, // Wide open vowels (AA, AH, O)
    E: { scaleY: 1.48, scaleX: 0.92 }, // Rounded open (AO, ER)
    F: { scaleY: 1.20, scaleX: 0.98 }, // Teeth / Lip (F, V)
    G: { scaleY: 1.32, scaleX: 0.88 }, // Pursed lips (W, OO, U)
    H: { scaleY: 1.38, scaleX: 1.00 }  // Open tongue (L)
};

/**
 * Viseme timeline-based lip-sync animation (driven by Rhubarb Lip Sync CLI cues).
 */
function startVisemeLipSync(visemes, audio) {
    stopLipSyncAnimation();

    if (!avatarMouth || !visemes || !visemes.length || !audio) return;

    function updateVisemeMouth() {
        if (!isSpeaking || audio.ended) {
            if (avatarMouth) avatarMouth.style.transform = "scaleY(1) scaleX(1)";
            return;
        }

        // While audio is buffering or paused during speech, keep active minimal procedural opening
        if (audio.paused || audio.readyState < 2) {
            const randomScale = 1.12 + Math.random() * 0.35;
            if (avatarMouth) avatarMouth.style.transform = `scaleY(${randomScale.toFixed(2)})`;
            animationFrameId = requestAnimationFrame(updateVisemeMouth);
            return;
        }

        const currentTime = audio.currentTime;
        // Find the active viseme cue in the timeline
        const cue = visemes.find(c => currentTime >= c.start && currentTime <= c.end);
        if (cue && VISEME_TRANSFORMS[cue.value]) {
            const t = VISEME_TRANSFORMS[cue.value];
            const scaleY = (cue.value === "X") ? 1.20 : t.scaleY;
            if (avatarMouth) avatarMouth.style.transform = `scaleY(${scaleY}) scaleX(${t.scaleX})`;
        } else {
            if (avatarMouth) avatarMouth.style.transform = "scaleY(1.20) scaleX(1.0)";
        }

        if (isSpeaking && !audio.ended) {
            animationFrameId = requestAnimationFrame(updateVisemeMouth);
        } else {
            if (avatarMouth) avatarMouth.style.transform = "scaleY(1) scaleX(1)";
        }
    }

    animationFrameId = requestAnimationFrame(updateVisemeMouth);
}

/**
 * Start the Web Audio API amplitude detection loop for the mouth overlay.
 */
function startLipSyncAnimation() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
    if (proceduralInterval) {
        clearInterval(proceduralInterval);
        proceduralInterval = null;
    }

    if (!avatarMouth) return;

    function updateMouth() {
        if (!isSpeaking || !analyser) {
            if (avatarMouth) avatarMouth.style.transform = "scaleY(1)";
            return;
        }

        analyser.getByteFrequencyData(dataArray);

        // Sum amplitudes to compute average volume
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
        }
        const average = sum / dataArray.length;

        // Map volume (0-255) to minimal scaleY range (1.0 at rest, 1.15 to 1.55 during speech)
        const minThreshold = 5;
        let scaleY = 1.0;
        if (average > minThreshold) {
            const normalized = Math.min((average - minThreshold) / 45, 1.0);
            scaleY = 1.0 + Math.pow(normalized, 0.8) * 0.55;
        } else {
            scaleY = 1.20;
        }

        if (avatarMouth) avatarMouth.style.transform = `scaleY(${scaleY.toFixed(2)})`;

        if (isSpeaking) {
            animationFrameId = requestAnimationFrame(updateMouth);
        } else {
            if (avatarMouth) avatarMouth.style.transform = "scaleY(1)";
        }
    }

    animationFrameId = requestAnimationFrame(updateMouth);
}

/**
 * Fallback procedural lip-sync used when browser TTS is active or Web Audio is unavailable.
 */
function startProceduralLipSync() {
    stopLipSyncAnimation();

    if (!avatarMouth) return;

    proceduralInterval = setInterval(() => {
        if (!isSpeaking) {
            if (avatarMouth) avatarMouth.style.transform = "scaleY(1)";
            clearInterval(proceduralInterval);
            proceduralInterval = null;
            return;
        }

        // Minimal, subtle random mouth opening (1.15 to 1.50)
        const randomScale = 1.15 + Math.random() * 0.35;
        if (avatarMouth) avatarMouth.style.transform = `scaleY(${randomScale.toFixed(2)})`;
    }, 80);
}

/**
 * Stops all lip-sync animations and restores mouth to closed state.
 */
function stopLipSyncAnimation() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    if (proceduralInterval) {
        clearInterval(proceduralInterval);
        proceduralInterval = null;
    }
    if (avatarMouth) {
        avatarMouth.style.transform = "scaleY(1) scaleX(1)";
    }
}

