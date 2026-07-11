'use strict';

/* =========================================================
   Controle de Vídeo por Roteiro — MVP (modo retrato)
   Vanilla JS. Sem dependências.
   ========================================================= */

// ---------- Estado global ----------
const state = {
  tomadas: [],          // [{ titulo, camera, angulo, duracao, texto }]
  index: 0,             // tomada atual
  facing: 'environment',// 'environment' (traseira) | 'user' (frontal)
  stream: null,
  recorder: null,
  chunks: [],
  recording: false,
  mirror: false,
  gridOn: false,
  wakeLock: null,
  // teleprompter
  promptRAF: null,
  promptY: 0,           // posição vertical do texto (px, negativa ao subir)
  promptSpeed: 4,       // 0..20
  promptPlaying: false,
  lastTs: 0,
  // timer
  recStart: 0,
  recRAF: null,
  // gravação em canvas 9:16
  recCanvas: null,
  rctx: null,
  drawRAF: null,
  canvasStream: null,
  lastUrl: null,
};

// ---------- Atalhos de DOM ----------
const $ = (id) => document.getElementById(id);
const el = {
  setup: $('setup-screen'),
  camera: $('camera-screen'),
  fileInput: $('file-input'),
  btnSample: $('btn-sample'),
  tomadasCard: $('tomadas-card'),
  tomadasList: $('tomadas-list'),
  btnStart: $('btn-start'),

  preview: $('preview'),
  gridOverlay: $('grid-overlay'),
  btnExit: $('btn-exit'),
  counter: $('tomada-counter'),
  title: $('tomada-title'),
  meta: $('tomada-meta'),
  recStatus: $('rec-status'),
  recTimer: $('rec-timer'),

  prompter: $('prompter'),
  prompterText: $('prompter-text'),
  countdown: $('countdown'),

  prompterControls: $('prompter-controls'),
  speedRange: $('speed-range'),
  speedVal: $('speed-val'),
  fontRange: $('font-range'),
  togglePlay: $('toggle-play'),
  toggleMirror: $('toggle-mirror'),
  toggleGrid: $('toggle-grid'),

  btnPrev: $('btn-prev'),
  btnNext: $('btn-next'),
  btnFlip: $('btn-flip'),
  btnRecord: $('btn-record'),
  btnSettings: $('btn-settings'),

  reviewPanel: $('review-panel'),
  reviewVideo: $('review-video'),
  btnMarkGood: $('btn-mark-good'),
  btnMarkRedo: $('btn-mark-redo'),
  btnDownload: $('btn-download'),
  btnDelete: $('btn-delete'),
  btnCloseReview: $('btn-close-review'),

  toast: $('toast'),
};

// =========================================================
// 1. PARSER DO ROTEIRO
// =========================================================
function parseRoteiro(raw) {
  const text = raw.replace(/\r\n/g, '\n').trim();

  // Tenta JSON primeiro
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const json = JSON.parse(text);
      const arr = Array.isArray(json) ? json : (json.tomadas || []);
      return arr.map((t, i) => normalizeTomada(t, i));
    } catch (_) { /* segue para o parser de texto */ }
  }

  // Parser do formato de texto com blocos "# Título"
  const tomadas = [];
  const blocks = text.split(/\n(?=#\s)/);
  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split('\n');
    let titulo = 'Tomada';
    if (lines[0].startsWith('#')) {
      titulo = lines.shift().replace(/^#+\s*/, '').trim();
    }
    const meta = {};
    const sepIdx = lines.findIndex((l) => l.trim() === '---');
    const metaLines = sepIdx >= 0 ? lines.slice(0, sepIdx) : lines;
    const bodyLines = sepIdx >= 0 ? lines.slice(sepIdx + 1) : [];

    for (const line of metaLines) {
      const m = line.match(/^\s*([\wÀ-ÿ]+)\s*:\s*(.+)$/);
      if (m) meta[m[1].toLowerCase()] = m[2].trim();
    }
    const texto = (sepIdx >= 0 ? bodyLines.join('\n') : metaLines.join('\n')).trim();

    tomadas.push(normalizeTomada({ titulo, ...meta, texto }, tomadas.length));
  }
  return tomadas;
}

function normalizeTomada(t, i) {
  const camRaw = String(t.camera || t.câmera || '').toLowerCase();
  const facing = /front|frontal|user|self/.test(camRaw) ? 'user' : 'environment';
  let dur = 0;
  const durRaw = String(t.duracao || t.duração || t.duration || '');
  const dm = durRaw.match(/(\d+)/);
  if (dm) dur = parseInt(dm[1], 10);
  return {
    titulo: t.titulo || t.título || `Tomada ${i + 1}`,
    facing,
    cameraLabel: facing === 'user' ? 'frontal' : 'traseira',
    angulo: t.angulo || t.ângulo || t.angle || '',
    duracao: dur, // segundos (0 = sem alvo)
    texto: (t.texto || t.text || '').trim(),
    status: null, // 'good' | 'redo' | null
  };
}

// =========================================================
// 2. TELA DE SETUP
// =========================================================
function loadRoteiro(raw) {
  const tomadas = parseRoteiro(raw);
  if (!tomadas.length) {
    showToast('Não encontrei nenhuma tomada no arquivo.');
    return;
  }
  state.tomadas = tomadas;
  renderTomadasList();
  el.tomadasCard.hidden = false;
  el.btnStart.disabled = false;
  showToast(`${tomadas.length} tomada(s) carregada(s).`);
}

function renderTomadasList() {
  el.tomadasList.innerHTML = '';
  state.tomadas.forEach((t) => {
    const li = document.createElement('li');
    const sub = [t.angulo, t.duracao ? `${t.duracao}s` : ''].filter(Boolean).join(' · ');
    li.innerHTML = `
      <div class="t-head">
        <span class="t-badge ${t.facing === 'user' ? 'front' : ''}">${t.cameraLabel}</span>
        <span class="t-title">${escapeHtml(t.titulo)}</span>
      </div>
      ${sub ? `<span class="t-sub">${escapeHtml(sub)}</span>` : ''}`;
    el.tomadasList.appendChild(li);
  });
}

el.fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => loadRoteiro(String(reader.result));
  reader.onerror = () => showToast('Falha ao ler o arquivo.');
  reader.readAsText(file);
});

el.btnSample.addEventListener('click', () => loadRoteiro(SAMPLE_ROTEIRO));

el.btnStart.addEventListener('click', startSession);

// =========================================================
// 3. SESSÃO DE CÂMERA
// =========================================================
async function startSession() {
  el.setup.hidden = true;
  el.camera.hidden = false;
  state.index = 0;
  await openCamera();
  applyTomada();
  requestWakeLock();
}

async function openCamera() {
  stopStream();
  try {
    const constraints = {
      audio: true,
      video: {
        facingMode: { ideal: state.facing },
        width: { ideal: 1080 },
        height: { ideal: 1920 },
      },
    };
    state.stream = await navigator.mediaDevices.getUserMedia(constraints);
    el.preview.srcObject = state.stream;
    // Espelha o preview quando a câmera frontal está ativa (comportamento natural)
    el.preview.classList.toggle('mirror', state.facing === 'user');
  } catch (err) {
    console.error(err);
    showToast('Não consegui abrir a câmera. Verifique a permissão e o HTTPS.');
  }
}

function stopStream() {
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
}

// Aplica os dados da tomada atual (câmera, textos, teleprompter)
async function applyTomada() {
  const t = state.tomadas[state.index];
  if (!t) return;

  el.counter.textContent = `${state.index + 1} / ${state.tomadas.length}`;
  el.title.textContent = t.titulo;
  const metaParts = [`Câmera ${t.cameraLabel}`];
  if (t.angulo) metaParts.push(t.angulo);
  if (t.duracao) metaParts.push(`alvo ${t.duracao}s`);
  el.meta.textContent = metaParts.join(' · ');

  el.btnPrev.disabled = state.index === 0;
  el.btnNext.disabled = state.index === state.tomadas.length - 1;

  // Troca de câmera se a tomada pedir outra que não a ativa
  if (t.facing !== state.facing) {
    state.facing = t.facing;
    await openCamera();
  }

  resetPrompter(t.texto);
}

function goTo(index) {
  if (state.recording) { showToast('Pare a gravação antes de trocar de tomada.'); return; }
  if (index < 0 || index >= state.tomadas.length) return;
  state.index = index;
  applyTomada();
}

el.btnPrev.addEventListener('click', () => goTo(state.index - 1));
el.btnNext.addEventListener('click', () => goTo(state.index + 1));

el.btnFlip.addEventListener('click', async () => {
  if (state.recording) { showToast('Pare a gravação antes de virar a câmera.'); return; }
  state.facing = state.facing === 'user' ? 'environment' : 'user';
  await openCamera();
});

el.btnExit.addEventListener('click', () => {
  if (state.recording) stopRecording();
  stopStream();
  stopPrompter();
  releaseWakeLock();
  el.camera.hidden = true;
  el.setup.hidden = false;
});

// =========================================================
// 4. TELEPROMPTER
// =========================================================
function applyPromptTransform() {
  el.prompterText.style.transform = `translateY(${-state.promptY}px)`;
}

function resetPrompter(texto) {
  pausePrompter();
  el.prompterText.textContent = texto || '(sem texto para esta tomada)';
  el.prompter.getBoundingClientRect(); // reflow
  state.promptY = el.prompter.clientHeight; // começa logo abaixo do topo visível
  applyPromptTransform();
}

function startPrompter() {
  stopPrompter();
  state.lastTs = 0;
  const step = (ts) => {
    if (!state.lastTs) state.lastTs = ts;
    const dt = (ts - state.lastTs) / 1000;
    state.lastTs = ts;
    // px por segundo: velocidade 0..20 => 0..280 px/s
    const pxPerSec = state.promptSpeed * 14;
    state.promptY += pxPerSec * dt;
    applyPromptTransform();
    const maxScroll = el.prompter.clientHeight + el.prompterText.scrollHeight;
    if (state.promptY < maxScroll) {
      state.promptRAF = requestAnimationFrame(step);
    } else {
      pausePrompter(); // chegou ao fim
    }
  };
  state.promptRAF = requestAnimationFrame(step);
}

function stopPrompter() {
  if (state.promptRAF) cancelAnimationFrame(state.promptRAF);
  state.promptRAF = null;
}

function playPrompter() {
  startPrompter();
  state.promptPlaying = true;
  el.togglePlay.textContent = '❚❚ Pausar';
  el.togglePlay.classList.add('active');
}

function pausePrompter() {
  stopPrompter();
  state.promptPlaying = false;
  el.togglePlay.textContent = '▶ Rolar';
  el.togglePlay.classList.remove('active');
}

// Arrastar o texto com o dedo para posicionar
let dragging = false, dragStartY = 0, dragStartPromptY = 0;
el.prompter.addEventListener('pointerdown', (e) => {
  dragging = true;
  dragStartY = e.clientY;
  dragStartPromptY = state.promptY;
  if (state.promptPlaying) pausePrompter();
  try { el.prompter.setPointerCapture(e.pointerId); } catch (_) {}
});
el.prompter.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  state.promptY = dragStartPromptY + (dragStartY - e.clientY);
  applyPromptTransform();
});
const endDrag = () => { dragging = false; };
el.prompter.addEventListener('pointerup', endDrag);
el.prompter.addEventListener('pointercancel', endDrag);

el.togglePlay.addEventListener('click', () => {
  if (state.promptPlaying) pausePrompter();
  else playPrompter();
});

el.speedRange.addEventListener('input', (e) => {
  state.promptSpeed = parseInt(e.target.value, 10);
  el.speedVal.textContent = e.target.value;
});
el.fontRange.addEventListener('input', (e) => {
  el.prompterText.style.fontSize = `${e.target.value}px`;
});
el.prompterText.style.fontSize = `${el.fontRange.value}px`;

el.toggleMirror.addEventListener('click', () => {
  state.mirror = !state.mirror;
  el.prompterText.classList.toggle('mirror', state.mirror);
  el.toggleMirror.classList.toggle('active', state.mirror);
});

el.toggleGrid.addEventListener('click', () => {
  state.gridOn = !state.gridOn;
  el.gridOverlay.hidden = !state.gridOn;
  el.toggleGrid.classList.toggle('active', state.gridOn);
});

el.btnSettings.addEventListener('click', () => {
  el.prompterControls.hidden = !el.prompterControls.hidden;
});

// =========================================================
// 5. GRAVAÇÃO
// =========================================================
function pickMimeType() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  for (const c of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

el.btnRecord.addEventListener('click', () => {
  if (state.recording) stopRecording();
  else startCountdownThenRecord();
});

function startCountdownThenRecord() {
  if (!state.stream) { showToast('Câmera não está pronta.'); return; }
  let n = 3;
  el.countdown.hidden = false;
  el.countdown.textContent = n;
  const tick = () => {
    n -= 1;
    if (n > 0) {
      el.countdown.textContent = n;
      setTimeout(tick, 1000);
    } else {
      el.countdown.hidden = true;
      startRecording();
    }
  };
  setTimeout(tick, 1000);
}

// Canvas 9:16 para forçar o arquivo em retrato (o sensor costuma entregar paisagem)
function setupRecCanvas() {
  if (!state.recCanvas) {
    state.recCanvas = document.createElement('canvas');
    state.recCanvas.width = 1080;
    state.recCanvas.height = 1920;
    state.rctx = state.recCanvas.getContext('2d');
  }
}

function startDrawLoop() {
  const c = state.recCanvas, ctx = state.rctx, v = el.preview;
  const draw = () => {
    const cw = c.width, ch = c.height, vw = v.videoWidth, vh = v.videoHeight;
    if (vw && vh) {
      // recorte "cover" centralizado, igual ao que o preview mostra na tela
      const scale = Math.max(cw / vw, ch / vh);
      const dw = vw * scale, dh = vh * scale;
      const dx = (cw - dw) / 2, dy = (ch - dh) / 2;
      ctx.drawImage(v, dx, dy, dw, dh);
    }
    state.drawRAF = requestAnimationFrame(draw);
  };
  draw();
}

function stopDrawLoop() {
  if (state.drawRAF) cancelAnimationFrame(state.drawRAF);
  state.drawRAF = null;
  if (state.canvasStream) {
    state.canvasStream.getVideoTracks().forEach((t) => t.stop());
    state.canvasStream = null;
  }
}

function startRecording() {
  // Monta um stream 9:16 desenhando o preview num canvas 1080x1920.
  let recStream;
  const canUseCanvas = typeof HTMLCanvasElement.prototype.captureStream === 'function'
    && el.preview.videoWidth > 0;
  if (canUseCanvas) {
    setupRecCanvas();
    startDrawLoop();
    state.canvasStream = state.recCanvas.captureStream(30);
    state.stream.getAudioTracks().forEach((t) => state.canvasStream.addTrack(t));
    recStream = state.canvasStream;
  } else {
    recStream = state.stream; // fallback: grava o stream cru
  }

  const mime = pickMimeType();
  try {
    state.recorder = new MediaRecorder(recStream, mime ? { mimeType: mime } : undefined);
  } catch (err) {
    console.error(err);
    showToast('Este navegador não permite gravar vídeo aqui.');
    stopDrawLoop();
    return;
  }
  state.chunks = [];
  state.recorder.ondataavailable = (e) => { if (e.data.size) state.chunks.push(e.data); };
  state.recorder.onstop = onRecordingStop;
  state.recorder.start();
  state.recording = true;

  el.btnRecord.classList.add('recording');
  el.recStatus.classList.add('active');
  startRecTimer();
  playPrompter();
}

function stopRecording() {
  if (state.recorder && state.recording) {
    state.recorder.stop();
  }
  state.recording = false;
  el.btnRecord.classList.remove('recording');
  stopRecTimer();
  stopDrawLoop();
  pausePrompter();
}

function onRecordingStop() {
  el.recStatus.classList.remove('active');
  if (state.lastUrl) { URL.revokeObjectURL(state.lastUrl); state.lastUrl = null; }
  const type = state.recorder.mimeType || 'video/webm';
  const blob = new Blob(state.chunks, { type });
  const url = URL.createObjectURL(blob);
  state.lastUrl = url;
  const ext = type.includes('mp4') ? 'mp4' : 'webm';
  const t = state.tomadas[state.index];
  const safeName = (t.titulo || `tomada-${state.index + 1}`).replace(/[^\wÀ-ÿ-]+/g, '_');

  el.reviewVideo.src = url;
  el.btnDownload.href = url;
  el.btnDownload.download = `${state.index + 1}_${safeName}.${ext}`;
  el.reviewPanel.hidden = false;
}

// Timer de gravação
function startRecTimer() {
  state.recStart = performance.now();
  const t = state.tomadas[state.index];
  el.recTimer.classList.remove('over');
  const loop = () => {
    const sec = (performance.now() - state.recStart) / 1000;
    el.recTimer.textContent = fmtTime(sec);
    if (t.duracao && sec >= t.duracao) el.recTimer.classList.add('over');
    state.recRAF = requestAnimationFrame(loop);
  };
  loop();
}
function stopRecTimer() {
  if (state.recRAF) cancelAnimationFrame(state.recRAF);
  state.recRAF = null;
}

// =========================================================
// 6. PAINEL DE REVISÃO
// =========================================================
function closeReview() {
  el.reviewPanel.hidden = true;
  el.reviewVideo.pause();
  el.reviewVideo.removeAttribute('src');
  el.reviewVideo.load();
}
el.btnCloseReview.addEventListener('click', closeReview);

el.btnDelete.addEventListener('click', () => {
  if (state.lastUrl) { URL.revokeObjectURL(state.lastUrl); state.lastUrl = null; }
  showToast('Gravação excluída.');
  closeReview();
});

el.btnMarkGood.addEventListener('click', () => {
  state.tomadas[state.index].status = 'good';
  showToast('Tomada marcada como boa.');
  closeReview();
  if (state.index < state.tomadas.length - 1) goTo(state.index + 1);
});
el.btnMarkRedo.addEventListener('click', () => {
  state.tomadas[state.index].status = 'redo';
  showToast('Marcada para refazer.');
  closeReview();
});

// =========================================================
// 7. UTILITÁRIOS
// =========================================================
function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

let toastTimer = null;
function showToast(msg) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2600);
}

// Wake Lock (mantém a tela acesa)
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      state.wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (_) { /* opcional */ }
}
function releaseWakeLock() {
  if (state.wakeLock) { state.wakeLock.release().catch(() => {}); state.wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !el.camera.hidden) requestWakeLock();
});

// =========================================================
// 8. ROTEIRO DE EXEMPLO
// =========================================================
const SAMPLE_ROTEIRO = `# Abertura
camera: frontal
angulo: close, braço estendido na altura dos olhos
duracao: 12s
---
Oi, pessoal! Hoje eu vou mostrar uma dica rápida
que vai facilitar a gravação dos seus vídeos.
Fica até o final que tem um bônus.

# Demonstração
camera: traseira
angulo: plano médio, celular na horizontal apoiado
duracao: 25s
---
Repare como o teleprompter mantém o texto rolando
enquanto você fala olhando direto para a câmera.
Você controla a velocidade e o tamanho da fonte.

# Encerramento
camera: frontal
angulo: close, sorrindo
duracao: 10s
---
Curtiu? Então segue o perfil e compartilha com quem
também cria conteúdo. Até o próximo vídeo!`;

// =========================================================
// 9. SERVICE WORKER (PWA)
// =========================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
