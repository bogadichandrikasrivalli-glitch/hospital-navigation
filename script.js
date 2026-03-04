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

/*    Telugu Voice — uses Web Speech API with te-IN.
   If browser has no Telugu voice, speaks English translation.
   ============================================================ */

/* ══════════════════════════════════════════════════════════
   VOICE ENGINE — Simple, Reliable, No External APIs
   Works on Chrome, Firefox, Safari, Mobile
   ══════════════════════════════════════════════════════════ */

let _voiceList   = [];
let _voicesReady = false;
let _isSpeaking  = false;
let _pendingSpeak = null;
let _currentAudio = null;

const _BCP47 = { en: 'en-IN', te: 'te-IN', hi: 'hi-IN' };

/* Load all available browser voices */
function _loadVoices() {
  const load = () => {
    _voiceList   = speechSynthesis.getVoices();
    _voicesReady = _voiceList.length > 0;
  };
  load();
  speechSynthesis.addEventListener('voiceschanged', load);
  // Polling fallback
  const t = setInterval(() => {
    if (_voiceList.length > 0) { clearInterval(t); return; }
    _voiceList   = speechSynthesis.getVoices();
    _voicesReady = _voiceList.length > 0;
  }, 200);
  setTimeout(() => clearInterval(t), 8000);
}

/* Pick best voice for language */
function _pickVoice(lang) {
  const bcp = _BCP47[lang] || 'en-IN';
  const pre = bcp.split('-')[0];
  return _voiceList.find(v => v.lang === bcp)
      || _voiceList.find(v => v.lang.startsWith(pre))
      || _voiceList.find(v => v.lang.startsWith('en'))
      || (_voiceList.length > 0 ? _voiceList[0] : null);
}

/* Check if browser has a native voice for this lang */
function _hasBrowserVoice(lang) {
  const pre = (_BCP47[lang] || lang).split('-')[0];
  return _voiceList.some(v => v.lang.startsWith(pre));
}

/**
 * speak(text, lang) — fire and forget
 */
function speak(text, lang) {
  if (!window.speechSynthesis) return;
  const l = lang || getCurrentLang();
  speechSynthesis.cancel();
  _isSpeaking   = true;
  _pendingSpeak = null;
  _doSpeak(text, l, () => { _isSpeaking = false; });
}

/**
 * speakWithCallback(text, lang, onDone)
 * Speak and call onDone() when finished.
 * Used by map animation to pause dot until voice ends.
 */
function speakWithCallback(text, lang, onDone) {
  if (!window.speechSynthesis) { if (onDone) onDone(); return; }
  const l = lang || getCurrentLang();
  speechSynthesis.cancel();
  _isSpeaking = true;
  setTimeout(() => {
    _doSpeak(text, l, () => {
      _isSpeaking = false;
      if (onDone) setTimeout(onDone, 800);
    });
  }, 150);
}

/**
 * _doSpeak(text, lang, onDone)
 * Core speak function — handles all languages cleanly.
 *
 * Telugu strategy:
 *   1. Try te-IN browser voice (works on Android Chrome, some PCs)
 *   2. If no Telugu voice → translate text to English equivalent
 *      and speak in English so user still hears directions clearly
 */
function _doSpeak(text, lang, onDone) {
  // For Telugu — check if browser has te-IN voice
  // If not, use English directions (always works)
  let speakLang = lang;
  let speakText = text;

  if (lang === 'te' && !_hasBrowserVoice('te')) {
    // No Telugu voice on this device → speak in English
    speakLang = 'en';
    speakText = _teToEn(text);
  }

  const utter    = new SpeechSynthesisUtterance(speakText);
  utter.lang     = _BCP47[speakLang] || 'en-IN';
  utter.rate     = 0.85;
  utter.pitch    = 1.05;
  utter.volume   = 1.0;

  const voice = _pickVoice(speakLang);
  if (voice) utter.voice = voice;

  utter.onend   = () => { if (onDone) onDone(); };
  utter.onerror = () => { if (onDone) onDone(); };

  if (_voicesReady) {
    speechSynthesis.speak(utter);
  } else {
    speechSynthesis.addEventListener('voiceschanged', () => {
      _voiceList   = speechSynthesis.getVoices();
      _voicesReady = true;
      const v = _pickVoice(speakLang);
      if (v) utter.voice = v;
      speechSynthesis.speak(utter);
    }, { once: true });
    // Also try directly after 500ms in case event never fires
    setTimeout(() => {
      if (!utter.onend._called) speechSynthesis.speak(utter);
    }, 500);
  }
}

/**
 * _teToEn(teText)
 * Maps Telugu navigation phrases to English equivalents.
 * Used as fallback when device has no Telugu voice.
 */
function _teToEn(teText) {
  const map = {
    'నావిగేషన్ ప్రారంభమవుతోంది. ప్రధాన ద్వారం నుండి నేరుగా వెళ్లండి.': 'Starting navigation. Walk straight from the main entrance.',
    'నేరుగా వెళ్లండి':          'Continue straight ahead',
    'ఎడమవైపు తిరగండి':           'Turn left',
    'కుడివైపు తిరగండి':           'Turn right',
    'వెనక్కి తిరిగి వెళ్లండి':   'Turn around and go back',
    'లిఫ్ట్ ఉపయోగించి పైకి వెళ్లండి':        'Take the lift to go up',
    'వీల్ చైర్ ర్యాంప్ ఉపయోగించి పైకి వెళ్లండి': 'Use the wheelchair ramp',
    'మీరు గమ్యస్థానానికి చేరుకున్నారు':       'You have arrived at your destination',
  };
  // Check exact match first
  if (map[teText]) return map[teText];
  // Check partial match
  for (const [te, en] of Object.entries(map)) {
    if (teText.includes(te)) return en;
  }
  return teText; // return original if no match
}

/** Stop all speech immediately */
function stopSpeaking() {
  if (window.speechSynthesis) speechSynthesis.cancel();
  if (_currentAudio) { _currentAudio.pause(); _currentAudio = null; }
  _isSpeaking   = false;
  _pendingSpeak = null;
}

/** Alias used in map.html */
function _cancelCurrent() { stopSpeaking(); }

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
