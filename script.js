/* ═══════════════════════════════════════════════════════════
   Hand Tracker by dxio — script.js
   Modules: Landing · Camera · MediaPipe · Gesture · Drawing · Render · UI
═══════════════════════════════════════════════════════════ */

'use strict';

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[0,17],[17,18],[18,19],[19,20]
];

const FINGER_TIPS   = [4, 8, 12, 16, 20];
const PINCH_THRESH  = 0.075;  // normalized distance
const OPEN_FRAMES   = 30;     // frames to hold open hand before modal
const CURSOR_LERP   = 0.55;   // cursor smoothing (0=no move, 1=instant)

const MODE_META = {
  idle:  { icon: '✋', text: 'No hand detected' },
  draw:  { icon: '✏️', text: 'Drawing' },
  erase: { icon: '🧹', text: 'Erasing' },
  grab:  { icon: '✊', text: 'Moving canvas' },
  open:  { icon: '🖐️', text: 'Hold to clear…' },
};

// ─────────────────────────────────────────────────────────────
// APPLICATION STATE
// ─────────────────────────────────────────────────────────────

const S = {
  // Drawing data
  strokes:       [],   // completed stroke objects
  currentStroke: null, // stroke being drawn right now

  // Active mode
  mode: 'idle',

  // Grab/move
  grabAnchor:  null,       // {x,y} canvas coords when pinch started
  grabOffset:  { x: 0, y: 0 },

  // Open hand hold
  openFrames:  0,
  modalOpen:   false,

  // User settings
  color: '#7c5cfc',
  size:  6,

  // Smoothed index tip position (canvas coords)
  curX: 0,
  curY: 0,
};

// ─────────────────────────────────────────────────────────────
// DOM CACHE
// ─────────────────────────────────────────────────────────────

const dom = {};
let   drawCtx, webcamCtx;

function cacheDOM() {
  [
    'landing','app','startBtn',
    'drawCanvas','webcamCanvas','inputVideo',
    'modeChip','modeIcon','modeText',
    'holdBar','holdFill',
    'colorPicker','brushSizeSlider','sizeVal',
    'undoBtn','clearBtn',
    'clearModal','confirmClear','cancelClear',
    'camError'
  ].forEach(id => dom[id] = document.getElementById(id));
}

// ─────────────────────────────────────────────────────────────
// ENTRY
// ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  cacheDOM();
  landingSetup();
});

// ─────────────────────────────────────────────────────────────
// MODULE: LANDING PAGE
// ─────────────────────────────────────────────────────────────

function landingSetup() {
  dom.startBtn.addEventListener('click', landingTransition);
}

function landingTransition() {
  dom.startBtn.disabled = true;
  dom.landing.classList.add('exit');

  setTimeout(() => {
    dom.landing.classList.add('hidden');
    dom.app.classList.remove('hidden');
    appInit();
  }, 560);
}

// ─────────────────────────────────────────────────────────────
// MODULE: APP INIT
// ─────────────────────────────────────────────────────────────

function appInit() {
  canvasSetup();
  toolbarSetup();
  modalSetup();
  renderStart();
  cameraSetup();
}

// ─────────────────────────────────────────────────────────────
// MODULE: CANVAS
// ─────────────────────────────────────────────────────────────

function canvasSetup() {
  drawCtx   = dom.drawCanvas.getContext('2d');
  webcamCtx = dom.webcamCanvas.getContext('2d');

  resizeDrawCanvas();
  window.addEventListener('resize', () => {
    // Preserve drawing on resize via snapshot
    const snap = document.createElement('canvas');
    snap.width  = dom.drawCanvas.width;
    snap.height = dom.drawCanvas.height;
    snap.getContext('2d').drawImage(dom.drawCanvas, 0, 0);
    resizeDrawCanvas();
    drawCtx.drawImage(snap, 0, 0);
  });
}

function resizeDrawCanvas() {
  dom.drawCanvas.width  = window.innerWidth;
  dom.drawCanvas.height = window.innerHeight;
}

// ─────────────────────────────────────────────────────────────
// MODULE: TOOLBAR
// ─────────────────────────────────────────────────────────────

function toolbarSetup() {
  // Color picker — sync swatch ring background
  dom.colorPicker.addEventListener('input', e => {
    S.color = e.target.value;
    const ring = document.querySelector('.color-swatch-ring');
    if (ring) ring.style.background = S.color;
  });
  // Set initial swatch color
  const ring = document.querySelector('.color-swatch-ring');
  if (ring) ring.style.background = S.color;

  // Brush size
  dom.brushSizeSlider.addEventListener('input', e => {
    S.size = parseInt(e.target.value, 10);
    dom.sizeVal.textContent = S.size;
  });

  // Undo
  dom.undoBtn.addEventListener('click', undoStroke);

  // Manual clear button
  dom.clearBtn.addEventListener('click', showModal);
}

// ─────────────────────────────────────────────────────────────
// MODULE: MODAL
// ─────────────────────────────────────────────────────────────

function modalSetup() {
  dom.confirmClear.addEventListener('click', () => { clearAll(); hideModal(); });
  dom.cancelClear .addEventListener('click', hideModal);
  dom.clearModal  .addEventListener('click', e => { if (e.target === dom.clearModal) hideModal(); });
}

function showModal() {
  if (S.modalOpen) return;
  S.modalOpen = true;
  dom.clearModal.classList.remove('hidden');
}

function hideModal() {
  S.modalOpen    = false;
  S.openFrames   = 0;
  dom.clearModal.classList.add('hidden');
  uiHoldBar(0);
}

// ─────────────────────────────────────────────────────────────
// MODULE: CAMERA & MEDIAPIPE
// ─────────────────────────────────────────────────────────────

function cameraSetup() {
  // Check API
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showCamError();
    return;
  }

  navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
    .then(stream => {
      dom.inputVideo.srcObject = stream;
      dom.inputVideo.play();
      mediaPipeSetup();
    })
    .catch(err => {
      console.error('[HandTracker] Camera error:', err);
      showCamError();
    });
}

function showCamError() {
  dom.camError.classList.remove('hidden');
  const wp = document.getElementById('webcamPanel');
  if (wp) wp.style.display = 'none';
}

function mediaPipeSetup() {
  const hands = new Hands({
    locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });

  hands.setOptions({
    maxNumHands:            1,
    modelComplexity:        1,
    minDetectionConfidence: 0.72,
    minTrackingConfidence:  0.65,
  });

  hands.onResults(onHandResults);

  const camera = new Camera(dom.inputVideo, {
    onFrame: async () => { await hands.send({ image: dom.inputVideo }); },
    width: 640, height: 480
  });

  camera.start().catch(err => {
    console.error('[HandTracker] MediaPipe camera error:', err);
    showCamError();
  });
}

// ─────────────────────────────────────────────────────────────
// MODULE: HAND RESULTS
// ─────────────────────────────────────────────────────────────

function onHandResults(results) {
  const lms = results.multiHandLandmarks && results.multiHandLandmarks.length > 0
    ? results.multiHandLandmarks[0]
    : null;

  // Draw webcam preview regardless
  drawWebcamPreview(lms);

  if (!lms) {
    // No hand visible — clean up any active gesture
    if (S.mode === 'draw' || S.mode === 'erase') finalizeStroke();
    if (S.mode === 'grab') finalizeGrab();
    S.openFrames = 0;
    uiHoldBar(0);
    uiMode('idle');
    return;
  }

  processGesture(lms);
}

// ─────────────────────────────────────────────────────────────
// MODULE: WEBCAM PREVIEW RENDERER
// ─────────────────────────────────────────────────────────────

function drawWebcamPreview(landmarks) {
  const W = dom.webcamCanvas.width;
  const H = dom.webcamCanvas.height;

  webcamCtx.clearRect(0, 0, W, H);

  // Mirrored video
  webcamCtx.save();
  webcamCtx.translate(W, 0);
  webcamCtx.scale(-1, 1);
  webcamCtx.drawImage(dom.inputVideo, 0, 0, W, H);
  webcamCtx.restore();

  if (!landmarks) return;

  // Helper: landmark → preview canvas coords (mirrored)
  const px = lm => (1 - lm.x) * W;
  const py = lm => lm.y * H;

  // Skeleton connections
  webcamCtx.strokeStyle = 'rgba(124,92,252,.55)';
  webcamCtx.lineWidth   = 1.5;

  HAND_CONNECTIONS.forEach(([a, b]) => {
    webcamCtx.beginPath();
    webcamCtx.moveTo(px(landmarks[a]), py(landmarks[a]));
    webcamCtx.lineTo(px(landmarks[b]), py(landmarks[b]));
    webcamCtx.stroke();
  });

  // Landmark dots
  landmarks.forEach((lm, i) => {
    const x = px(lm), y = py(lm);
    const isTip = FINGER_TIPS.includes(i);

    webcamCtx.beginPath();
    webcamCtx.arc(x, y, isTip ? 4.5 : 2.5, 0, Math.PI * 2);

    if (i === 8) {
      // Index tip — highlighted
      webcamCtx.fillStyle = '#ff4fa3';
      webcamCtx.shadowColor = '#ff4fa3';
      webcamCtx.shadowBlur  = 8;
    } else if (isTip) {
      webcamCtx.fillStyle = '#7c5cfc';
      webcamCtx.shadowColor = '#7c5cfc';
      webcamCtx.shadowBlur  = 6;
    } else {
      webcamCtx.fillStyle = 'rgba(255,255,255,.75)';
      webcamCtx.shadowBlur = 0;
    }

    webcamCtx.fill();
    webcamCtx.shadowBlur = 0;
  });
}

// ─────────────────────────────────────────────────────────────
// MODULE: GESTURE DETECTION
// ─────────────────────────────────────────────────────────────

/**
 * Returns the current gesture label based on landmark positions.
 * Priority: open > grab > erase > draw > idle
 */
function detectGesture(lm) {
  // Finger extended: tip Y is above PIP Y (y=0 at top of image)
  const indexUp  = lm[8].y  < lm[6].y;
  const middleUp = lm[12].y < lm[10].y;
  const ringUp   = lm[16].y < lm[14].y;
  const pinkyUp  = lm[20].y < lm[18].y;

  // Pinch: thumb tip ↔ index tip distance in normalized space
  const pinchDist = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
  const pinching  = pinchDist < PINCH_THRESH;

  // ─ 1. Open hand (all four fingers extended)
  if (indexUp && middleUp && ringUp && pinkyUp) return 'open';

  // ─ 2. Pinch / grab
  if (pinching) return 'grab';

  // ─ 3. Erase (index + middle, ring + pinky down)
  if (indexUp && middleUp && !ringUp && !pinkyUp) return 'erase';

  // ─ 4. Draw (index only)
  if (indexUp && !middleUp && !ringUp && !pinkyUp) return 'draw';

  return 'idle';
}

// ─────────────────────────────────────────────────────────────
// MODULE: GESTURE PROCESSING (state machine)
// ─────────────────────────────────────────────────────────────

function processGesture(lm) {
  const W = dom.drawCanvas.width;
  const H = dom.drawCanvas.height;

  // Canvas-space index fingertip (mirrored X)
  const rawTipX = (1 - lm[8].x) * W;
  const rawTipY = lm[8].y * H;

  // Smoothed cursor via lerp
  S.curX += (rawTipX - S.curX) * CURSOR_LERP;
  S.curY += (rawTipY - S.curY) * CURSOR_LERP;

  // Pinch midpoint (mirrored)
  const pinchX = (1 - (lm[4].x + lm[8].x) / 2) * W;
  const pinchY = ((lm[4].y + lm[8].y) / 2) * H;

  const gesture = detectGesture(lm);

  // ── Mode transition ──
  if (gesture !== S.mode) {
    onModeExit(S.mode);
    S.mode = gesture;
    onModeEnter(gesture, S.curX, S.curY, pinchX, pinchY);
    uiMode(gesture);
  }

  // ── Mode update (each frame) ──
  onModeUpdate(gesture, S.curX, S.curY, pinchX, pinchY);
}

function onModeExit(mode) {
  if (mode === 'draw' || mode === 'erase') finalizeStroke();
  if (mode === 'grab')  finalizeGrab();
  if (mode === 'open') {
    S.openFrames = 0;
    dom.holdBar.classList.add('hidden');
    uiHoldBar(0);
  }
}

function onModeEnter(mode, tipX, tipY, pinchX, pinchY) {
  if (mode === 'draw') {
    S.currentStroke = { points: [], color: S.color, size: S.size, isEraser: false };
  }
  if (mode === 'erase') {
    S.currentStroke = { points: [], color: '#ffffff', size: S.size, isEraser: true };
  }
  if (mode === 'grab') {
    S.grabAnchor = { x: pinchX, y: pinchY };
  }
  if (mode === 'open') {
    dom.holdBar.classList.remove('hidden');
  }
}

function onModeUpdate(mode, tipX, tipY, pinchX, pinchY) {
  // ── Draw: push point ──
  if (mode === 'draw' && S.currentStroke) {
    S.currentStroke.points.push({ x: tipX, y: tipY });
  }

  // ── Erase: push point ──
  if (mode === 'erase' && S.currentStroke) {
    S.currentStroke.points.push({ x: tipX, y: tipY });
  }

  // ── Grab: update offset ──
  if (mode === 'grab' && S.grabAnchor) {
    S.grabOffset = {
      x: pinchX - S.grabAnchor.x,
      y: pinchY - S.grabAnchor.y,
    };
  }

  // ── Open hand: count frames toward modal ──
  if (mode === 'open' && !S.modalOpen) {
    S.openFrames++;
    const pct = Math.min(S.openFrames / OPEN_FRAMES, 1);
    uiHoldBar(pct);
    dom.modeText.textContent = `Hold to clear… ${Math.round(pct * 100)}%`;

    if (S.openFrames >= OPEN_FRAMES) {
      S.openFrames = 0;
      uiHoldBar(0);
      showModal();
    }
  }
}

// ─────────────────────────────────────────────────────────────
// MODULE: DRAWING ENGINE
// ─────────────────────────────────────────────────────────────

/** Commit the current in-progress stroke to the strokes array. */
function finalizeStroke() {
  if (S.currentStroke && S.currentStroke.points.length > 0) {
    S.strokes.push(S.currentStroke);
  }
  S.currentStroke = null;
}

/** Apply accumulated grab offset to all stroke coords, then reset. */
function finalizeGrab() {
  const { x: dx, y: dy } = S.grabOffset;
  if (dx === 0 && dy === 0) return;

  const applyOffset = pt => { pt.x += dx; pt.y += dy; };

  S.strokes.forEach(s => s.points.forEach(applyOffset));
  if (S.currentStroke) S.currentStroke.points.forEach(applyOffset);

  S.grabOffset = { x: 0, y: 0 };
  S.grabAnchor = null;
}

/** Remove last completed stroke (undo). */
function undoStroke() {
  S.strokes.pop();
}

/** Clear all drawing data. */
function clearAll() {
  S.strokes       = [];
  S.currentStroke = null;
  S.grabOffset    = { x: 0, y: 0 };
  S.grabAnchor    = null;
}

/**
 * Render a single stroke using quadratic bezier interpolation
 * for smooth curves between sampled points.
 */
function renderStroke(ctx, stroke) {
  const pts = stroke.points;
  if (!pts || pts.length === 0) return;

  ctx.save();
  ctx.lineCap    = 'round';
  ctx.lineJoin   = 'round';
  ctx.lineWidth  = stroke.isEraser ? stroke.size * 5 : stroke.size;
  ctx.strokeStyle = stroke.isEraser ? '#ffffff' : stroke.color;
  ctx.fillStyle   = stroke.isEraser ? '#ffffff' : stroke.color;

  if (pts.length === 1) {
    // Single dot
    const r = stroke.isEraser ? stroke.size * 2.5 : stroke.size / 2;
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, Math.max(r, 1), 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Smooth quadratic bezier through midpoints
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);

    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) * 0.5;
      const my = (pts[i].y + pts[i + 1].y) * 0.5;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }

    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }

  ctx.restore();
}

// ─────────────────────────────────────────────────────────────
// MODULE: RENDER LOOP
// ─────────────────────────────────────────────────────────────

function renderStart() {
  (function loop() {
    renderFrame();
    requestAnimationFrame(loop);
  })();
}

function renderFrame() {
  const canvas = dom.drawCanvas;
  const ctx    = drawCtx;
  const W      = canvas.width;
  const H      = canvas.height;

  // ── Clear to white ──
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // ── Apply grab translation ──
  ctx.save();
  ctx.translate(S.grabOffset.x, S.grabOffset.y);

  // ── Render completed strokes (chronological order) ──
  S.strokes.forEach(s => renderStroke(ctx, s));

  // ── Render current in-progress stroke ──
  if (S.currentStroke) renderStroke(ctx, S.currentStroke);

  ctx.restore();

  // ── Overlay: cursor indicators (no grab translation) ──
  renderCursorOverlay(ctx, W, H);
}

function renderCursorOverlay(ctx, W, H) {
  const x = S.curX;
  const y = S.curY;

  // Only show cursor if a hand is present
  if (S.mode === 'idle') return;

  ctx.save();

  if (S.mode === 'draw') {
    // Draw cursor: filled circle with color ring
    const r = S.size / 2;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(r, 3), 0, Math.PI * 2);
    ctx.fillStyle = S.color;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(r, 3) + 3, 0, Math.PI * 2);
    ctx.strokeStyle = S.color;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.4;
    ctx.stroke();
  }

  if (S.mode === 'erase') {
    // Eraser cursor: dashed circle showing erase radius
    const r = Math.max(S.size * 2.5, 10);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,79,163,.7)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    // Small center dot
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,79,163,.8)';
    ctx.fill();
  }

  if (S.mode === 'grab') {
    // Grab cursor: concentric rings at pinch midpoint
    const gx = S.grabAnchor
      ? S.grabAnchor.x + S.grabOffset.x
      : x;
    const gy = S.grabAnchor
      ? S.grabAnchor.y + S.grabOffset.y
      : y;

    [20, 10].forEach((r, i) => {
      ctx.beginPath();
      ctx.arc(gx, gy, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(0,229,255,${i === 0 ? .4 : .7})`;
      ctx.lineWidth = i === 0 ? 1.5 : 2;
      ctx.stroke();
    });
    ctx.beginPath();
    ctx.arc(gx, gy, 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,229,255,.9)';
    ctx.fill();
  }

  if (S.mode === 'open') {
    // Open hand: expanding ring pulse
    const r = 28;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,255,157,.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,255,157,.8)';
    ctx.fill();
  }

  ctx.restore();
}

// ─────────────────────────────────────────────────────────────
// MODULE: UI HELPERS
// ─────────────────────────────────────────────────────────────

/** Update mode chip label, icon, and color. */
function uiMode(mode) {
  S.mode = mode;
  const meta = MODE_META[mode] || MODE_META.idle;
  dom.modeIcon.textContent = meta.icon;
  dom.modeText.textContent = meta.text;
  dom.modeChip.dataset.mode = mode;
}

/** Update the open-hand hold progress bar (0–1). */
function uiHoldBar(pct) {
  dom.holdFill.style.width = (pct * 100).toFixed(1) + '%';
}
