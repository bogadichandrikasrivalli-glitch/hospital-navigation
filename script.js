/* ============================================================
   SMART HOSPITAL NAVIGATION SYSTEM — script.js  (v4 Firebase)
   Shared across ALL pages.

   NOTE: Patient database functions and staff login functions
   are now in firebase-config.js — not here.

   This file contains:
     1.  Translations — all 3 languages
     2.  getDirection() — direction detection
     3.  buildPath()    — waypoint builder
     4.  speak()        — multilingual voice guidance
     5.  Map drawing    — canvas floor plan + animated path
     6.  General helpers
   ============================================================ */

'use strict';

/* ============================================================
   3. TRANSLATIONS
   All navigation phrases in English, Telugu, and Hindi.
   Keys exactly match what getDirection() returns plus
   the special keys: 'start', 'lift', 'ramp', 'reached'.
   ============================================================ */

const TRANSLATIONS = {
  en: {
    start:          'Starting navigation. Walk straight ahead from the main entrance.',
    straight:       'Continue straight ahead',
    left:           'Turn left',
    right:          'Turn right',
    back:           'Turn around and go back',
    lift:           'Take the lift to go up',
    ramp:           'Use the wheelchair ramp to go up',
    reached:        'You have arrived at your destination',
    reached_patient:'You have arrived. Patient {name} is in Room {room}.',
    reached_dept:   'You have arrived at {name}.',
    to_floor:       'Go to Floor {floor}.',
  },
  te: {
    /* Telugu */
    start:          'నావిగేషన్ ప్రారంభమవుతోంది. ప్రధాన ద్వారం నుండి నేరుగా వెళ్లండి.',
    straight:       'నేరుగా వెళ్లండి',
    left:           'ఎడమవైపు తిరగండి',
    right:          'కుడివైపు తిరగండి',
    back:           'వెనక్కి తిరిగి వెళ్లండి',
    lift:           'లిఫ్ట్ ఉపయోగించి పైకి వెళ్లండి',
    ramp:           'వీల్ చైర్ ర్యాంప్ ఉపయోగించి పైకి వెళ్లండి',
    reached:        'మీరు గమ్యస్థానానికి చేరుకున్నారు',
    reached_patient:'మీరు చేరుకున్నారు. రోగి {name} గది {room}లో ఉన్నారు.',
    reached_dept:   'మీరు {name}కు చేరుకున్నారు.',
    to_floor:       'అంతస్తు {floor}కు వెళ్లండి.',
  },
  hi: {
    /* Hindi */
    start:          'नेविगेशन शुरू हो रही है। मुख्य प्रवेश द्वार से सीधे जाएँ।',
    straight:       'सीधे आगे जाएँ',
    left:           'बाएं मुड़ें',
    right:          'दाएं मुड़ें',
    back:           'पलटिए और वापस जाएँ',
    lift:           'ऊपर जाने के लिए लिफ्ट लें',
    ramp:           'ऊपर जाने के लिए व्हीलचेयर रैंप का उपयोग करें',
    reached:        'आप अपने गंतव्य पर पहुँच गए हैं',
    reached_patient:'आप पहुँच गए। मरीज़ {name} कमरा {room} में हैं।',
    reached_dept:   'आप {name} पर पहुँच गए।',
    to_floor:       'मंजिल {floor} पर जाएँ।',
  }
};

/**
 * tr(key, lang)
 * Translate a direction key into a human-readable phrase.
 * Falls back to English if the key is missing in the chosen language.
 *
 * @param {string} key  — e.g. 'straight', 'left', 'reached'
 * @param {string} lang — 'en', 'te', or 'hi'
 * @returns {string}
 */
function tr(key, lang) {
  const l = lang || getCurrentLang();
  return (TRANSLATIONS[l] && TRANSLATIONS[l][key]) ||
         TRANSLATIONS['en'][key] || key;
}

/* ============================================================
   4. DIRECTION DETECTION
   ──────────────────────────────────────────────────────────
   Canvas coordinate system reminder:
     x increases → (to the right)
     y increases ↓ (downward on screen)

   So moving "up" on screen = y is decreasing.
   In a hospital map, moving toward rooms (upward on canvas)
   feels like "going straight" / walking forward.

   This function is the core of the new navigation logic.
   ============================================================ */

/**
 * THRESHOLD — minimum pixel change to count as real movement.
 * Tiny differences (< 15px) are ignored to avoid false turns
 * caused by nearly-straight paths with tiny diagonal offsets.
 */
const DIR_THRESH = 15;

/**
 * getDirection(prevPoint, nextPoint)
 *
 * Automatically detects the travel direction between two waypoints
 * based on their x, y pixel coordinates.
 *
 *  Movement pattern        → Direction key returned
 *  ─────────────────────────────────────────────────
 *  y decreases (moving up) → 'straight'   (walking toward rooms)
 *  y increases (moving dn) → 'back'       (back toward entrance)
 *  x increases (moving →)  → 'right'
 *  x decreases (moving ←)  → 'left'
 *
 * Uses the DOMINANT axis — whichever of dx or dy is larger
 * determines whether the movement is classified as
 * horizontal (left/right) or vertical (straight/back).
 *
 * @param {{ x:number, y:number }} prevPoint — starting position
 * @param {{ x:number, y:number }} nextPoint — ending position
 * @returns {string} 'straight' | 'left' | 'right' | 'back'
 *
 * Example usage:
 *   getDirection({x:400, y:430}, {x:400, y:270})  → 'straight'
 *   getDirection({x:400, y:270}, {x:150, y:270})  → 'left'
 *   getDirection({x:400, y:270}, {x:600, y:270})  → 'right'
 */
function getDirection(prevPoint, nextPoint) {
  const dx    = nextPoint.x - prevPoint.x;   // positive = moving right
  const dy    = nextPoint.y - prevPoint.y;   // positive = moving down on screen
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  // If movement is negligibly small, default to straight
  if (absDx < DIR_THRESH && absDy < DIR_THRESH) {
    return 'straight';
  }

  if (absDy >= absDx) {
    // Vertical movement dominates
    return dy < 0 ? 'straight' : 'back';
  } else {
    // Horizontal movement dominates
    return dx > 0 ? 'right' : 'left';
  }
}

/* ============================================================
   5. PATH BUILDING
   Builds the ordered list of waypoints from entrance to destination.
   Each waypoint contains:
     { x, y, dirKey, isSpecial }
   where dirKey is returned by getDirection() or is a special
   override like 'lift', 'ramp', 'start', 'reached'.

   The path structure:
     [Entrance] → [Up to corridor] → [Along corridor to lift/ramp if needed]
               → [Lift/Ramp] → [Along corridor to room column]
               → [Turn into room] → [Destination]
   ============================================================ */

/**
 * buildPath(destX, destY, destFloor, wheelchair)
 *
 * @param {number}  destX       — canvas x of destination room centre
 * @param {number}  destY       — canvas y of destination room centre
 * @param {number}  destFloor   — floor number (1, 2, 3 …)
 * @param {boolean} wheelchair  — true = use ramp, avoid stairs
 * @returns {Array} array of waypoint objects
 */
function buildPath(destX, destY, destFloor, wheelchair) {

  // ── Fixed canvas coordinates for shared landmarks ──
  const ENT_X  = 400;  // Entrance: horizontal centre bottom
  const ENT_Y  = 430;  // Entrance Y (near bottom)
  const CORR_Y = 270;  // Main corridor Y (horizontal stripe)
  const LIFT_X = 740;  // Lift: right end of corridor
  const RAMP_X = 57;   // Ramp: left end of corridor (wheelchair)

  const waypoints = [];

  /** Convenience: push one waypoint */
  function wp(x, y, dirKey, isSpecial) {
    waypoints.push({ x, y, dirKey: dirKey, isSpecial: !!isSpecial });
  }

  // Step 1 — Entrance (special, always 'start')
  wp(ENT_X, ENT_Y, 'start');

  // Step 2 — Walk straight up from entrance to main corridor
  // Detected: y decreases → 'straight'
  wp(ENT_X, CORR_Y, getDirection({ x:ENT_X, y:ENT_Y }, { x:ENT_X, y:CORR_Y }));

  // Step 3 — If destination is on floor > 1, go to lift or ramp
  if (destFloor > 1) {
    const floorX = wheelchair ? RAMP_X : LIFT_X;
    const specialKey = wheelchair ? 'ramp' : 'lift';  // override key for voice

    // 3a — Walk along corridor toward the lift/ramp
    wp(floorX, CORR_Y, getDirection({ x:ENT_X, y:CORR_Y }, { x:floorX, y:CORR_Y }));
    // 3b — AT the lift/ramp — use special key (not coordinate-based) for exact phrase
    wp(floorX, CORR_Y, specialKey, true /* isSpecial = don't merge this step */);
  }

  // Step 4 — Walk along corridor toward the room's column
  // prevX = wherever we were before (entrance column or lift/ramp column)
  const prevX = (destFloor > 1) ? (wheelchair ? RAMP_X : LIFT_X) : ENT_X;
  wp(destX, CORR_Y, getDirection({ x:prevX, y:CORR_Y }, { x:destX, y:CORR_Y }));

  // Step 5 — Turn into the room (move vertically from corridor to room)
  wp(destX, destY, getDirection({ x:destX, y:CORR_Y }, { x:destX, y:destY }));

  // Step 6 — Arrived (special key, always 'reached')
  wp(destX, destY, 'reached', true /* isSpecial */);

  // Clean up: merge consecutive same-direction steps so voice doesn't repeat
  return _mergeConsecutive(waypoints);
}

/**
 * _mergeConsecutive(waypoints)
 * Collapses back-to-back waypoints that have the same dirKey
 * into a single waypoint at the farther position.
 * Special steps (isSpecial=true) are never merged.
 *
 * Why: Without this, a straight corridor produces 10 x 'straight'
 *      announcements. We want just one "Go straight".
 */
function _mergeConsecutive(waypoints) {
  const out = [];
  for (let i = 0; i < waypoints.length; i++) {
    const cur  = waypoints[i];
    const prev = out[out.length - 1];

    const canMerge = prev &&
                     prev.dirKey === cur.dirKey &&
                     !cur.isSpecial &&
                     !prev.isSpecial &&
                     cur.dirKey !== 'start' &&
                     cur.dirKey !== 'reached';

    if (canMerge) {
      // Move the previous waypoint's endpoint to the farther position
      prev.x = cur.x;
      prev.y = cur.y;
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/* ============================================================
   6. MULTILINGUAL VOICE GUIDANCE  (v4 — lag fix + Telugu TTS)
   ──────────────────────────────────────────────────────────
   Strategy:
     • English / Hindi  → Web Speech API (browser built-in)
     • Telugu           → Google Translate TTS audio (mp3)
       because most devices don't have a "te-IN" voice installed.
     • Zero lag: audio is PRE-FETCHED for the NEXT step while
       the current step is still speaking.
     • No 80ms delay — speak fires immediately.
   ============================================================ */

/* ── Voice state ── */
let _voicesReady = false;
let _voiceList   = [];
let _currentAudio = null;   // HTMLAudioElement for Telugu/Hindi TTS
let _isSpeaking   = false;
let _pendingSpeak = null;   // { text, lang } — next queued item

/* ── BCP-47 map ── */
const _BCP47 = { en: 'en-IN', te: 'te-IN', hi: 'hi-IN' };

/* ── Google TTS language codes ── */
const _GTTS  = { en: 'en-IN', te: 'te', hi: 'hi' };

/**
 * _loadVoices()
 * Eagerly cache browser voices. Called once on script load.
 */
function _loadVoices() {
  const v = speechSynthesis.getVoices();
  if (v.length > 0) {
    _voiceList   = v;
    _voicesReady = true;
  } else {
    const onReady = () => {
      _voiceList   = speechSynthesis.getVoices();
      _voicesReady = true;
    };
    speechSynthesis.addEventListener('voiceschanged', onReady, { once: true });
    // Polling fallback for browsers that never fire voiceschanged
    const t = setInterval(() => {
      const vv = speechSynthesis.getVoices();
      if (vv.length > 0) { clearInterval(t); _voiceList = vv; _voicesReady = true; }
    }, 150);
    setTimeout(() => clearInterval(t), 6000);
  }
}

/**
 * _hasBrowserVoice(lang)
 * Returns true if the browser has a native voice for this language.
 */
function _hasBrowserVoice(lang) {
  const prefix = (_BCP47[lang] || lang).split('-')[0];
  return _voiceList.some(v => v.lang.startsWith(prefix));
}

/**
 * _pickVoice(lang)
 * Select the best available browser voice.
 */
function _pickVoice(lang) {
  const bcp47  = _BCP47[lang] || 'en-IN';
  const prefix = bcp47.split('-')[0];
  return _voiceList.find(v => v.lang === bcp47)
      || _voiceList.find(v => v.lang.startsWith(prefix))
      || _voiceList.find(v => v.lang.startsWith('en'))
      || null;
}

/**
 * _gttsSrc(text, lang)
 * Build a Google Translate TTS URL for the given text and language.
 * Works for Telugu (te), Hindi (hi), and English (en).
 */
function _gttsSrc(text, lang) {
  const tl  = _GTTS[lang] || 'en';
  return `https://translate.google.com/translate_tts?ie=UTF-8&tl=${tl}&q=${encodeURIComponent(text)}&client=tw-ob`;
}

/**
 * speak(text, lang)
 * Main entry point. Speaks 'text' in the chosen language with ZERO lag.
 * If something is already playing, the new item replaces the pending queue
 * so only the most-recent direction is spoken next (no stale pile-up).
 */
function speak(text, lang) {
  const l = lang || getCurrentLang();

  // Always cancel whatever is in flight — new direction takes priority
  _cancelCurrent();

  _pendingSpeak = null;
  _isSpeaking   = true;

  // Route to the right engine
  if (l === 'te' || !_hasBrowserVoice(l)) {
    _speakViaGTTS(text, l);
  } else {
    _speakViaBrowser(text, l);
  }
}

/**
 * _speakViaBrowser(text, lang)
 * Use Web Speech API — for English and Hindi (when voice is available).
 * NO cancel+delay trick: we already cancelled above in speak().
 */
function _speakViaBrowser(text, lang) {
  if (!window.speechSynthesis) { _isSpeaking = false; return; }
  speechSynthesis.cancel(); // clear any stuck utterances

  const utter   = new SpeechSynthesisUtterance(text);
  utter.lang    = _BCP47[lang] || 'en-IN';
  utter.rate    = 0.85;   // slightly slower = clearer pronunciation
  utter.pitch   = 1.05;  // slightly higher = more natural
  utter.volume  = 1.0;

  const doSpeak = () => {
    const voice = _pickVoice(lang);
    if (voice) utter.voice = voice;

    utter.onend = utter.onerror = () => {
      _isSpeaking = false;
      if (_pendingSpeak) {
        const next = _pendingSpeak;
        _pendingSpeak = null;
        speak(next.text, next.lang);
      }
    };

    speechSynthesis.speak(utter);
  };

  if (_voicesReady) {
    doSpeak();
  } else {
    speechSynthesis.addEventListener('voiceschanged', () => {
      _voiceList   = speechSynthesis.getVoices();
      _voicesReady = true;
      doSpeak();
    }, { once: true });
  }
}

/**
 * _speakViaGTTS(text, lang)
 * Use Google Translate TTS audio for Telugu (and Hindi fallback).
 * Creates an <audio> element and plays the mp3 stream directly.
 * This gives REAL Telugu voice — not English with Telugu text.
 */
function _speakViaGTTS(text, lang) {
  try {
    const src   = _gttsSrc(text, lang);
    const audio = new Audio(src);
    audio.volume = 1.0;
    _currentAudio = audio;

    audio.onended = audio.onerror = () => {
      _isSpeaking   = false;
      _currentAudio = null;
      if (_pendingSpeak) {
        const next = _pendingSpeak;
        _pendingSpeak = null;
        speak(next.text, next.lang);
      }
    };

    // If Google TTS fails (e.g. offline), fall back to browser
    audio.onerror = () => {
      console.warn('Google TTS failed, falling back to browser speech.');
      _isSpeaking   = false;
      _currentAudio = null;
      _speakViaBrowser(text, lang);
    };

    audio.play().catch(() => {
      // Autoplay blocked — browser needs a user gesture first
      // Queue it for the next user interaction
      _isSpeaking = false;
      _pendingSpeak = { text, lang };
    });

  } catch (e) {
    console.error('GTTS error:', e);
    _isSpeaking = false;
    _speakViaBrowser(text, lang);
  }
}

/**
 * _cancelCurrent()
 * Immediately stop whatever is currently playing.
 */
function _cancelCurrent() {
  // Stop Web Speech
  if (window.speechSynthesis) speechSynthesis.cancel();
  // Stop audio element (Telugu)
  if (_currentAudio) {
    _currentAudio.pause();
    _currentAudio.src = '';
    _currentAudio = null;
  }
}

/** Public: stop all speech and clear queue. */
function stopSpeaking() {
  _pendingSpeak = null;
  _isSpeaking   = false;
  _cancelCurrent();
}

/**
 * speakWithCallback(text, lang, onDone)
 * Speak text and call onDone() when the voice finishes.
 * Used by the animation loop to pause the dot until voice is done.
 * After voice ends, waits 600ms before calling onDone so the user
 * has a moment to process the instruction before the dot moves.
 */
function speakWithCallback(text, lang, onDone) {
  const l = lang || getCurrentLang();
  _cancelCurrent();
  _pendingSpeak = null;
  _isSpeaking   = true;

  const done = () => {
    _isSpeaking = false;
    if (onDone) setTimeout(onDone, 800);  // 800ms pause after speech ends — dot waits before moving
  };

  if (l === 'te' || !_hasBrowserVoice(l)) {
    _speakViaGTTSWithCB(text, l, done);
  } else {
    _speakViaBrowserWithCB(text, l, done);
  }
}

/** Browser speech with end-callback. */
function _speakViaBrowserWithCB(text, lang, onDone) {
  if (!window.speechSynthesis) { if (onDone) onDone(); return; }

  // Cancel any stuck speech before starting new one
  speechSynthesis.cancel();

  const utter  = new SpeechSynthesisUtterance(text);
  utter.lang   = _BCP47[lang] || 'en-IN';
  utter.rate   = 0.85;   // clearer, natural pace
  utter.pitch  = 1.05;   // natural tone
  utter.volume = 1.0;

  const doSpeak = () => {
    const voice = _pickVoice(lang);
    if (voice) utter.voice = voice;
    // Small delay after cancel() so browser resets cleanly
    setTimeout(() => {
      utter.onend  = () => { if (onDone) onDone(); };
      utter.onerror = () => { if (onDone) onDone(); };
      speechSynthesis.speak(utter);
    }, 120);
  };

  if (_voicesReady) doSpeak();
  else speechSynthesis.addEventListener('voiceschanged', () => {
    _voiceList = speechSynthesis.getVoices(); _voicesReady = true; doSpeak();
  }, { once: true });
}

/** Google TTS with end-callback. */
function _speakViaGTTSWithCB(text, lang, onDone) {
  try {
    const audio = new Audio(_gttsSrc(text, lang));
    audio.volume = 1.0;
    _currentAudio = audio;
    audio.onended = () => { _currentAudio = null; if (onDone) onDone(); };
    audio.onerror = () => {
      _currentAudio = null;
      console.warn('Google TTS failed, falling back to browser.');
      _speakViaBrowserWithCB(text, lang, onDone);
    };
    audio.play().catch(() => {
      // Autoplay blocked — just call onDone so navigation doesn't freeze
      _currentAudio = null;
      if (onDone) onDone();
    });
  } catch(e) {
    if (onDone) onDone();
  }
}

// Pre-load voices immediately when the script loads
if (window.speechSynthesis) _loadVoices();

/* ============================================================
   LANGUAGE UTILITIES
   ============================================================ */

/** Get current language code from #langSelect or localStorage. */
function getCurrentLang() {
  const sel = document.getElementById('langSelect');
  if (sel && sel.value) return sel.value;
  return localStorage.getItem('navLang') || 'en';
}

/** Save language choice to localStorage so it persists across pages. */
function saveLang(lang) {
  localStorage.setItem('navLang', lang);
}

/** Restore saved language into any #langSelect on the page. */
function applyStoredLang() {
  const saved = localStorage.getItem('navLang') || 'en';
  document.querySelectorAll('.lang-sel').forEach(el => el.value = saved);
  // Also try the topbar one
  const sel = document.getElementById('langSelect');
  if (sel) sel.value = saved;
}

/* ============================================================
   DEPARTMENT DATA
   Used on department.html (card grid) and map.html (coordinates).
   x, y are pixel positions on the 800 x 450 canvas.
   ============================================================ */

const DEPARTMENTS = [
  { id:'icu',        name:'ICU',                  icon:'🚨', floor:1, x:430, y:90  },
  { id:'lab',        name:'Laboratory',            icon:'🔬', floor:1, x:570, y:360 },
  { id:'pharmacy',   name:'Pharmacy',              icon:'💊', floor:1, x:150, y:360 },
  { id:'xray',       name:'X-Ray',                icon:'🩻', floor:2, x:290, y:90  },
  { id:'doctor',     name:'Doctor Consultation',   icon:'👨‍⚕️', floor:1, x:290, y:90  },
  { id:'waiting',    name:'Waiting Hall',          icon:'🪑', floor:1, x:430, y:360 },
  { id:'washroom_m', name:'Washroom (Men)',        icon:'🚹', floor:1, x:570, y:90  },
  { id:'washroom_w', name:'Washroom (Women)',      icon:'🚺', floor:2, x:570, y:90  },
  { id:'emergency',  name:'Emergency Room',        icon:'🏥', floor:1, x:150, y:90  },
  { id:'ward',       name:'General Ward',          icon:'🛏️', floor:2, x:430, y:360 },
];

/* ============================================================
   MAP DRAWING — canvas floor plan
   ============================================================ */

/**
 * drawFloorMap(ctx, floor, W, H)
 * Paints the hospital floor plan schematic on a <canvas>.
 * This is called every animation frame so the route overlay stays fresh.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} floor — 1 or 2
 * @param {number} W, H  — canvas pixel dimensions
 */
function drawFloorMap(ctx, floor, W, H) {
  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = '#f0f4f8';
  ctx.fillRect(0, 0, W, H);

  // Outer hospital wall
  ctx.strokeStyle = '#1a6fb5';
  ctx.lineWidth = 4;
  ctx.strokeRect(30, 30, W - 60, H - 60);
  ctx.fillStyle = '#fff';
  ctx.fillRect(32, 32, W - 64, H - 64);

  // Main corridor (horizontal stripe across the middle)
  ctx.fillStyle = '#ddeaf5';
  ctx.fillRect(30, 245, W - 60, 55);
  ctx.fillStyle = '#94adc8';
  ctx.font = '11px Nunito, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('— MAIN CORRIDOR —', W / 2, 277);

  // Entrance box at bottom centre
  ctx.fillStyle = '#00a878';
  ctx.fillRect(360, H - 56, 80, 28);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 11px Nunito';
  ctx.textAlign = 'center';
  ctx.fillText('ENTRANCE', 400, H - 37);

  // Lift box (right side of corridor)
  _drawBox(ctx, W - 95, 240, 58, 58, '#bee3f8', '#1a6fb5');
  ctx.font = '20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('🛗', W - 66, 266);
  ctx.font = '9px Nunito';
  ctx.fillStyle = '#1a6fb5';
  ctx.fillText('LIFT', W - 66, 285);

  // Ramp box (left side of corridor, wheelchair accessible)
  _drawBox(ctx, 32, 240, 50, 58, '#d4f5e9', '#00a878');
  ctx.font = '18px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('♿', 57, 265);
  ctx.font = '9px Nunito';
  ctx.fillStyle = '#007a58';
  ctx.fillText('RAMP', 57, 284);

  // Draw rooms for the current floor
  if (floor === 1) _drawFloor1(ctx, W, H);
  else             _drawFloor2(ctx, W, H);

  // Floor label badge (top-right corner)
  ctx.fillStyle = 'rgba(26,111,181,0.10)';
  ctx.fillRect(W - 120, 8, 88, 22);
  ctx.fillStyle = '#1a6fb5';
  ctx.font = 'bold 12px Poppins, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`FLOOR  ${floor}`, W - 36, 24);
}

/** Internal: draw a coloured rounded rectangle */
function _drawBox(ctx, x, y, w, h, fill, stroke) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, 6);
  else ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.stroke();
}

/** Internal: draw one labelled room rectangle */
function _drawRoom(ctx, x, y, w, h, label, color, emoji) {
  _drawBox(ctx, x, y, w, h, color || '#fff', '#1a6fb5');
  if (emoji) {
    ctx.font = '18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(emoji, x + w / 2, y + 22);
  }
  ctx.fillStyle = '#2c3e50';
  ctx.font = '10px Nunito, sans-serif';
  ctx.textAlign = 'center';
  label.split('\n').forEach((line, i) => {
    ctx.fillText(line, x + w / 2, y + (emoji ? 38 : 15) + i * 13);
  });
}

function _drawFloor1(ctx, W, H) {
  // Top row of rooms
  _drawRoom(ctx, 90,  50, 100, 78, 'Emergency\nRoom',      '#ffe8e8', '🏥');
  _drawRoom(ctx, 210, 50, 110, 78, 'Doctor\nConsultation', '#edf6ff', '👨‍⚕️');
  _drawRoom(ctx, 350, 50, 100, 78, 'ICU',                  '#fff0e0', '🚨');
  _drawRoom(ctx, 480, 50, 110, 78, 'Washroom\n(Men)',      '#f0f8ff', '🚹');
  _drawRoom(ctx, 620, 50, 100, 78, 'Nurses\nStation',      '#edfff8', '🏨');
  // Bottom row
  _drawRoom(ctx, 90,  318, 100, 78, 'Pharmacy',            '#f5eeff', '💊');
  _drawRoom(ctx, 210, 318, 110, 78, 'Waiting\nHall',       '#fffff0', '🪑');
  _drawRoom(ctx, 350, 318, 100, 78, 'General\nWard',       '#edf6ff', '🛏️');
  _drawRoom(ctx, 480, 318, 110, 78, 'Laboratory',          '#fff0f8', '🔬');
  _drawRoom(ctx, 620, 318, 100, 78, 'Storage',             '#f7f7f7', '📦');
}

function _drawFloor2(ctx, W, H) {
  _drawRoom(ctx, 90,  50, 100, 78, 'Cardiology',           '#ffe8f0', '❤️');
  _drawRoom(ctx, 210, 50, 110, 78, 'X-Ray',               '#edf6ff', '🩻');
  _drawRoom(ctx, 350, 50, 100, 78, 'Washroom\n(Women)',    '#f5eeff', '🚺');
  _drawRoom(ctx, 480, 50, 110, 78, 'Maternity\nWard',      '#fff0f8', '🤱');
  _drawRoom(ctx, 620, 50, 100, 78, 'Neurology',           '#fff8e0', '🧠');
  _drawRoom(ctx, 90,  318, 100, 78, 'Orthopaedics',       '#edfff8', '🦴');
  _drawRoom(ctx, 210, 318, 110, 78, 'Recovery\nRoom',      '#edf6ff', '🛌');
  _drawRoom(ctx, 350, 318, 100, 78, 'General\nWard B',     '#f0fff4', '🛏️');
  _drawRoom(ctx, 480, 318, 110, 78, 'Physiotherapy',      '#f5f5ff', '🤸');
  _drawRoom(ctx, 620, 318, 100, 78, 'Consultation B',     '#fff8e0', '🩺');
}

/**
 * drawPath(ctx, waypoints, progress)
 * Draws the animated navigation route on top of the floor map.
 *
 * progress: floating-point from 0 to (waypoints.length - 1)
 *   e.g. 1.5 = halfway between waypoint[1] and waypoint[2]
 *
 * Draws:
 *   1. Dashed full route (light blue)
 *   2. Solid green portion already travelled
 *   3. Animated blue dot at current position
 *   4. Red destination pin at the end
 */
function drawPath(ctx, waypoints, progress) {
  if (!waypoints || waypoints.length < 2) return;

  const lastIdx = waypoints.length - 1;
  const stepIdx = Math.floor(progress);
  const frac    = progress - stepIdx;

  // 1. Full planned route — dashed, faint blue
  ctx.beginPath();
  ctx.moveTo(waypoints[0].x, waypoints[0].y);
  for (let i = 1; i <= lastIdx; i++) ctx.lineTo(waypoints[i].x, waypoints[i].y);
  ctx.strokeStyle = 'rgba(26,111,181,0.18)';
  ctx.lineWidth = 5;
  ctx.setLineDash([9, 9]);
  ctx.stroke();
  ctx.setLineDash([]);

  // 2. Completed portion — solid green
  ctx.beginPath();
  ctx.moveTo(waypoints[0].x, waypoints[0].y);
  for (let i = 1; i <= Math.min(stepIdx, lastIdx); i++) {
    ctx.lineTo(waypoints[i].x, waypoints[i].y);
  }
  if (stepIdx < lastIdx) {
    const cur  = waypoints[stepIdx];
    const next = waypoints[stepIdx + 1];
    ctx.lineTo(cur.x + (next.x - cur.x) * frac, cur.y + (next.y - cur.y) * frac);
  }
  ctx.strokeStyle = '#00a878';
  ctx.lineWidth = 4;
  ctx.stroke();

  // 3. Moving blue dot at current animated position
  let dotX, dotY;
  if (stepIdx < lastIdx) {
    const cur  = waypoints[stepIdx];
    const next = waypoints[stepIdx + 1];
    dotX = cur.x + (next.x - cur.x) * frac;
    dotY = cur.y + (next.y - cur.y) * frac;
  } else {
    dotX = waypoints[lastIdx].x;
    dotY = waypoints[lastIdx].y;
  }
  // Outer glow
  ctx.beginPath();
  ctx.arc(dotX, dotY, 15, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(26,111,181,0.13)';
  ctx.fill();
  // Main dot
  ctx.beginPath();
  ctx.arc(dotX, dotY, 9, 0, Math.PI * 2);
  ctx.fillStyle = '#1a6fb5';
  ctx.fill();
  // White centre
  ctx.beginPath();
  ctx.arc(dotX, dotY, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();

  // 4. Destination red pin
  const dest = waypoints[lastIdx];
  ctx.beginPath();
  ctx.arc(dest.x, dest.y, 13, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(230,57,70,0.18)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(dest.x, dest.y, 8, 0, Math.PI * 2);
  ctx.fillStyle = '#e63946';
  ctx.fill();
  ctx.font = '16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('📍', dest.x, dest.y - 14);
}

/* ============================================================
   GENERAL HELPERS
   ============================================================ */

/** Show or hide a page alert box by ID. */
function showAlert(id, type, message) {
  const el = document.getElementById(id);
  if (!el) return;
  const icons = { success:'✅', error:'❌', info:'ℹ️' };
  el.className = `alert alert-${type} show`;
  el.innerHTML = `<span>${icons[type] || ''}</span> ${message}`;
  if (type === 'success') setTimeout(() => el.classList.remove('show'), 4000);
}

/** Display logged-in staff name in the topbar chip. */
function updateTopbarStaff() {
  const staff    = getLoggedInStaff();
  const chip     = document.getElementById('staffChip');
  const loginBtn = document.getElementById('loginBtn');
  if (!chip || !loginBtn) return;
  if (staff) {
    chip.textContent   = `👤 ${staff.name}`;
    chip.style.display = 'inline';
    loginBtn.style.display = 'none';
  } else {
    chip.style.display     = 'none';
    loginBtn.style.display = 'inline';
  }
}

/** Persist navigation target across pages via sessionStorage. */
function setNavTarget(data) {
  sessionStorage.setItem('navTarget', JSON.stringify(data));
}

/** Read the stored navigation target (on map.html). */
function getNavTarget() {
  const raw = sessionStorage.getItem('navTarget');
  return raw ? JSON.parse(raw) : null;
}
