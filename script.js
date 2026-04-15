let videoElement, previewCanvas, previewCtx, drawingCanvas, drawingCtx;
let handsInstance, cameraInstance;
let strokes = [];
let currentStroke = null;
let canvasOffsetX = 0;
let canvasOffsetY = 0;
let tempOffsetX = 0;
let tempOffsetY = 0;
let isGrabbing = false;
let grabStartX = 0;
let grabStartY = 0;
let currentPointerX = 0;
let currentPointerY = 0;
let isDrawing = false;
let isErasing = false;
let lastOpenHandTime = 0;
let handDetected = false;
const PREVIEW_WIDTH = 320;
const PREVIEW_HEIGHT = 240;
const ERASE_RADIUS = 35;
function isFingerExtended(landmarks, tipIdx, pipIdx) {
return landmarks[tipIdx].y < landmarks[pipIdx].y - 0.03;
}
function getDistance(a, b) {
return Math.hypot(a.x - b.x, a.y - b.y);
}
function detectGestures(landmarks) {
if (!landmarks || landmarks.length < 21) return;
const thumbTip = landmarks[4];
const indexTip = landmarks[8];
const indexPIP = landmarks[6];
const middleTip = landmarks[12];
const middlePIP = landmarks[10];
const indexExtended = isFingerExtended(landmarks, 8, 6);
const middleExtended = isFingerExtended(landmarks, 12, 10);
const ringExtended = isFingerExtended(landmarks, 16, 14);
const pinkyExtended = isFingerExtended(landmarks, 20, 18);
const pinchDist = getDistance(thumbTip, indexTip);
const isPinch = pinchDist < 0.075;
const isOpenHand = indexExtended && middleExtended && ringExtended && pinkyExtended;
const offsetX = isGrabbing ? tempOffsetX : canvasOffsetX;
const offsetY = isGrabbing ? tempOffsetY : canvasOffsetY;
const logicalX = currentPointerX - offsetX;
const logicalY = currentPointerY - offsetY;
if (isPinch) {
if (!isGrabbing) {
isGrabbing = true;
grabStartX = currentPointerX;
grabStartY = currentPointerY;
tempOffsetX = canvasOffsetX;
tempOffsetY = canvasOffsetY;
} else {
tempOffsetX = canvasOffsetX + (currentPointerX - grabStartX);
tempOffsetY = canvasOffsetY + (currentPointerY - grabStartY);
}
isDrawing = false;
isErasing = false;
return;
} else if (isGrabbing) {
canvasOffsetX = tempOffsetX;
canvasOffsetY = tempOffsetY;
isGrabbing = false;
}
if (indexExtended && middleExtended && !isPinch) {
isErasing = true;
isDrawing = false;
for (let i = strokes.length - 1; i >= 0; i--) {
const path = strokes[i].points;
const newPath = [];
for (let j = 0; j < path.length; j++) {
const p = path[j];
const d = Math.hypot(p.x - logicalX, p.y - logicalY);
if (d > ERASE_RADIUS) newPath.push(p);
}
if (newPath.length > 1) {
strokes[i].points = newPath;
} else {
strokes.splice(i, 1);
}
}
return;
} else {
isErasing = false;
}
if (indexExtended && !middleExtended && !isPinch) {
isDrawing = true;
if (!currentStroke) {
currentStroke = { points: [] };
strokes.push(currentStroke);
}
const lastPoint = currentStroke.points[currentStroke.points.length - 1];
if (!lastPoint || Math.hypot(currentPointerX - (lastPoint.x + offsetX), currentPointerY - (lastPoint.y + offsetY)) > 4) {
currentStroke.points.push({ x: logicalX, y: logicalY });
}
return;
} else {
if (isDrawing) {
isDrawing = false;
currentStroke = null;
}
}
if (isOpenHand && Date.now() - lastOpenHandTime > 800) {
lastOpenHandTime = Date.now();
showModal();
}
}
function onHandResults(results) {
previewCtx.save();
previewCtx.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
previewCtx.drawImage(videoElement, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
handDetected = false;
if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
handDetected = true;
const landmarks = results.multiHandLandmarks[0];
drawConnectors(previewCtx, landmarks, Hands.HAND_CONNECTIONS, {
color: '#00ff9d',
lineWidth: 3
});
drawLandmarks(previewCtx, landmarks, {
color: '#00f5ff',
lineWidth: 1,
radius: 3
});
const tip = landmarks[8];
currentPointerX = tip.x * drawingCanvas.width;
currentPointerY = tip.y * drawingCanvas.height;
detectGestures(landmarks);
}
previewCtx.restore();
}
function drawLoop() {
const ctx = drawingCtx;
const w = drawingCanvas.width;
const h = drawingCanvas.height;
ctx.save();
ctx.fillStyle = '#ffffff';
ctx.fillRect(0, 0, w, h);
const offsetX = isGrabbing ? tempOffsetX : canvasOffsetX;
const offsetY = isGrabbing ? tempOffsetY : canvasOffsetY;
ctx.strokeStyle = '#111111';
ctx.lineWidth = 6;
ctx.lineJoin = 'round';
ctx.lineCap = 'round';
for (let stroke of strokes) {
if (stroke.points.length < 2) continue;
ctx.shadowBlur = 8;
ctx.shadowColor = 'rgba(0, 245, 255, 0.2)';
ctx.beginPath();
ctx.moveTo(stroke.points[0].x + offsetX, stroke.points[0].y + offsetY);
for (let i = 1; i < stroke.points.length; i++) {
ctx.lineTo(stroke.points[i].x + offsetX, stroke.points[i].y + offsetY);
}
ctx.stroke();
}
if (currentStroke && currentStroke.points.length > 1) {
ctx.beginPath();
ctx.moveTo(currentStroke.points[0].x + offsetX, currentStroke.points[0].y + offsetY);
for (let i = 1; i < currentStroke.points.length; i++) {
ctx.lineTo(currentStroke.points[i].x + offsetX, currentStroke.points[i].y + offsetY);
}
ctx.stroke();
}
if (handDetected) {
ctx.shadowBlur = 0;
if (isErasing) {
ctx.globalAlpha = 0.25;
ctx.fillStyle = '#ff2d55';
ctx.beginPath();
ctx.arc(currentPointerX, currentPointerY, ERASE_RADIUS, 0, Math.PI * 2);
ctx.fill();
ctx.globalAlpha = 1;
} else {
ctx.fillStyle = '#00f5ff';
ctx.beginPath();
ctx.arc(currentPointerX, currentPointerY, 12, 0, Math.PI * 2);
ctx.fill();
ctx.strokeStyle = '#ffffff';
ctx.lineWidth = 3;
ctx.beginPath();
ctx.arc(currentPointerX, currentPointerY, 18, 0, Math.PI * 2);
ctx.stroke();
}
}
ctx.restore();
requestAnimationFrame(drawLoop);
}
async function startCamera() {
const errorEl = document.getElementById('error-message');
try {
const stream = await navigator.mediaDevices.getUserMedia({
video: { width: 640, height: 480, facingMode: 'user' }
});
videoElement.srcObject = stream;
await videoElement.play();
handsInstance = new Hands({
locateFile: (file) => https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}
});
handsInstance.setOptions({
maxNumHands: 1,
modelComplexity: 1,
minDetectionConfidence: 0.75,
minTrackingConfidence: 0.65
});
handsInstance.onResults(onHandResults);
cameraInstance = new Camera(videoElement, {
onFrame: async () => {
if (handsInstance) await handsInstance.send({ image: videoElement });
},
width: 640,
height: 480
});
await cameraInstance.start();
drawLoop();
} catch (err) {
console.error(err);
errorEl.textContent = err.name === 'NotAllowedError'
? 'Camera access denied. Please allow permission and refresh the page.'
: 'Cannot access camera. Make sure you are on HTTPS (GitHub Pages) and try again.';
errorEl.classList.remove('hidden');
}
}
function resizeCanvas() {
const canvas = drawingCanvas;
if (canvas.clientWidth > 0 && canvas.clientHeight > 0) {
canvas.width = canvas.clientWidth;
canvas.height = canvas.clientHeight;
}
}
function showModal() {
const modal = document.getElementById('modal');
modal.classList.add('show');
}
function hideModal() {
const modal = document.getElementById('modal');
modal.classList.remove('show');
}
function initUI() {
const startBtn = document.getElementById('start-btn');
const app = document.getElementById('app');
const landing = document.getElementById('landing');
startBtn.addEventListener('click', () => {
landing.style.opacity = '0';
landing.style.transform = 'scale(0.95)';
setTimeout(() => {
landing.classList.add('hidden');
app.style.display = 'block';
setTimeout(() => {
app.style.opacity = '1';
resizeCanvas();
startCamera();
}, 80);
}, 600);
});
drawingCanvas = document.getElementById('drawing-canvas');
previewCanvas = document.getElementById('preview-canvas');
previewCtx = previewCanvas.getContext('2d');
drawingCtx = drawingCanvas.getContext('2d', { alpha: false });
videoElement = document.getElementById('input-video');
window.addEventListener('resize', () => {
if (app.style.display === 'block') resizeCanvas();
});
const modal = document.getElementById('modal');
document.getElementById('modal-cancel').addEventListener('click', hideModal);
document.getElementById('modal-delete').addEventListener('click', () => {
strokes = [];
canvasOffsetX = 0;
canvasOffsetY = 0;
hideModal();
});
modal.addEventListener('click', (e) => {
if (e.target === modal) hideModal();
});
}
window.onload = initUI;
