const video = document.getElementById('video');
const socket = io();
const log = document.getElementById('log') || null;

let stream = null;
let cameraOn = true;

function addLog(msg) {
  if (log) {
    const time = new Date().toLocaleTimeString();
    log.innerHTML = `[${time}] ${msg}<br>` + log.innerHTML;
  }
}

// Load model face-api.js
Promise.all([
  faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
  faceapi.nets.faceExpressionNet.loadFromUri('/models')
]).then(() => {
  addLog("✅ Model face-api dimuat");
  startVideo();
});

// Mulai kamera
function startVideo() {
  navigator.mediaDevices.getUserMedia({ video: true })
    .then(s => {
      stream = s;
      video.srcObject = stream;
      addLog("📷 Kamera aktif");

      initGestureDetection();
    })
    .catch(err => addLog("🚫 Gagal akses kamera: " + err));
}

// ON/OFF kamera
function toggleCamera() {
  const btn = document.getElementById('toggleCameraBtn');

  if (cameraOn && stream) {
    stream.getTracks().forEach(track => track.stop());
    video.srcObject = null;
    btn.innerText = '🟢 Nyalakan Kamera';
    addLog("🛑 Kamera dimatikan");
  } else {
    startVideo();
    btn.innerText = '🔴 Matikan Kamera';
    addLog("✅ Kamera dinyalakan kembali");
  }

  cameraOn = !cameraOn;
}

// Saat video diputar, mulai deteksi emosi
video.addEventListener('play', () => {
  addLog("▶️ Video diputar");

  const canvas = faceapi.createCanvasFromMedia(video);
  document.body.append(canvas);
  const displaySize = { width: video.width, height: video.height };
  faceapi.matchDimensions(canvas, displaySize);

  setInterval(async () => {
    if (!cameraOn) return;

    const detections = await faceapi
      .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
      .withFaceExpressions();

    const resized = faceapi.resizeResults(detections, displaySize);
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    faceapi.draw.drawDetections(canvas, resized);
    faceapi.draw.drawFaceExpressions(canvas, resized);

    if (detections.length > 0) {
      const expressions = detections[0].expressions;
      const dominant = Object.keys(expressions).reduce((a, b) =>
        expressions[a] > expressions[b] ? a : b
      );
      addLog(`😊 Emosi terdeteksi: ${dominant}`);
      socket.emit('deteksiEmosi', dominant);
    }
  }, 2000);
});

// Inisialisasi gesture tangan
function initGestureDetection() {
  const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });

  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.5
  });

  hands.onResults(onHandResults);

  const camera = new Camera(video, {
    onFrame: async () => {
      if (cameraOn) {
        await hands.send({ image: video });
      }
    },
    width: 640,
    height: 480
  });

  camera.start();
}

// Deteksi jumlah jari yang terbuka
function onHandResults(results) {
  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) return;

  const landmarks = results.multiHandLandmarks[0];
  const fingerTips = [8, 12, 16, 20]; // jari telunjuk - kelingking
  const thumbTip = 4;
  let count = 0;

  // Jempol
  if (landmarks[thumbTip].x < landmarks[3].x) count++;

  // Jari lainnya
  fingerTips.forEach((tip) => {
    if (landmarks[tip].y < landmarks[tip - 2].y) count++;
  });

  addLog(`🖐️ Gesture terdeteksi: ${count}`);
  socket.emit('deteksiGesture', count);
}
