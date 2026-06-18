const dom = {
  supportPill: document.querySelector('#supportPill'),
  fileInput: document.querySelector('#fileInput'),
  dropZone: document.querySelector('#dropZone'),
  fileCard: document.querySelector('#fileCard'),
  fileName: document.querySelector('#fileName'),
  fileSize: document.querySelector('#fileSize'),
  sourceResolution: document.querySelector('#sourceResolution'),
  sourceDuration: document.querySelector('#sourceDuration'),
  outputResolution: document.querySelector('#outputResolution'),
  scaleSelect: document.querySelector('#scaleSelect'),
  presetSelect: document.querySelector('#presetSelect'),
  sharpnessRange: document.querySelector('#sharpnessRange'),
  sharpnessValue: document.querySelector('#sharpnessValue'),
  contrastRange: document.querySelector('#contrastRange'),
  contrastValue: document.querySelector('#contrastValue'),
  fpsSelect: document.querySelector('#fpsSelect'),
  bitrateSelect: document.querySelector('#bitrateSelect'),
  audioCheck: document.querySelector('#audioCheck'),
  previewButton: document.querySelector('#previewButton'),
  resetButton: document.querySelector('#resetButton'),
  compareStage: document.querySelector('#compareStage'),
  beforeCanvas: document.querySelector('#beforeCanvas'),
  afterCanvas: document.querySelector('#afterCanvas'),
  afterLayer: document.querySelector('#afterLayer'),
  divider: document.querySelector('#divider'),
  compareRange: document.querySelector('#compareRange'),
  previewHint: document.querySelector('#previewHint'),
  sourceVideo: document.querySelector('#sourceVideo'),
  exportCanvas: document.querySelector('#exportCanvas'),
  scratchCanvas: document.querySelector('#scratchCanvas'),
  startButton: document.querySelector('#startButton'),
  pauseButton: document.querySelector('#pauseButton'),
  cancelButton: document.querySelector('#cancelButton'),
  statusText: document.querySelector('#statusText'),
  progressText: document.querySelector('#progressText'),
  progressBar: document.querySelector('#progressBar'),
  elapsedTime: document.querySelector('#elapsedTime'),
  etaTime: document.querySelector('#etaTime'),
  formatText: document.querySelector('#formatText'),
  audioText: document.querySelector('#audioText'),
  resultSection: document.querySelector('#resultSection'),
  resultMeta: document.querySelector('#resultMeta'),
  downloadLink: document.querySelector('#downloadLink'),
  issueSection: document.querySelector('#issueSection'),
  issueText: document.querySelector('#issueText'),
  renderSummary: document.querySelector('#renderSummary')
};

const beforeCtx = dom.beforeCanvas.getContext('2d', { alpha: false });
const afterCtx = dom.afterCanvas.getContext('2d', { alpha: false });
const exportCtx = dom.exportCanvas.getContext('2d', { alpha: false });
const scratchCtx = dom.scratchCanvas.getContext('2d', { alpha: false });

const state = {
  file: null,
  objectUrl: '',
  downloadUrl: '',
  recorder: null,
  chunks: [],
  startedAt: 0,
  pausedAt: 0,
  totalPausedMs: 0,
  isExporting: false,
  isPaused: false,
  discardExport: false,
  previewToken: 0,
  exportToken: 0,
  mimeType: '',
  extension: 'webm'
};

const featureReport = getFeatureReport();
setSupportStatus(featureReport);
wireEvents();
syncRangeLabels();
syncCompareSlider();
updateFormatText();

function wireEvents() {
  dom.fileInput.addEventListener('change', () => {
    const [file] = dom.fileInput.files || [];
    if (file) loadFile(file);
  });

  for (const eventName of ['dragenter', 'dragover']) {
    dom.dropZone.addEventListener(eventName, event => {
      event.preventDefault();
      dom.dropZone.classList.add('dragging');
    });
  }

  for (const eventName of ['dragleave', 'drop']) {
    dom.dropZone.addEventListener(eventName, event => {
      event.preventDefault();
      dom.dropZone.classList.remove('dragging');
    });
  }

  dom.dropZone.addEventListener('drop', event => {
    const [file] = event.dataTransfer?.files || [];
    if (file) loadFile(file);
  });

  dom.compareRange.addEventListener('input', syncCompareSlider);

  for (const control of [
    dom.scaleSelect,
    dom.presetSelect,
    dom.sharpnessRange,
    dom.contrastRange,
    dom.fpsSelect,
    dom.bitrateSelect,
    dom.audioCheck
  ]) {
    control.addEventListener('input', () => {
      syncRangeLabels();
      updateOutputResolution();
      updateFormatText();
      drawPreviewFrame();
    });
  }

  dom.previewButton.addEventListener('click', togglePreviewPlayback);
  dom.resetButton.addEventListener('click', resetPreview);
  dom.startButton.addEventListener('click', startExport);
  dom.pauseButton.addEventListener('click', toggleExportPause);
  dom.cancelButton.addEventListener('click', cancelExport);
  window.addEventListener('resize', syncCompareSlider);

  dom.sourceVideo.addEventListener('play', schedulePreviewFrame);
  dom.sourceVideo.addEventListener('pause', updatePreviewButton);
  dom.sourceVideo.addEventListener('ended', () => {
    updatePreviewButton();
    if (state.isExporting) finishExport();
  });
}

function getFeatureReport() {
  const missing = [];
  if (!window.MediaRecorder) missing.push('MediaRecorder');
  if (!HTMLCanvasElement.prototype.captureStream) missing.push('Canvas capture');
  if (!document.createElement('video').canPlayType) missing.push('HTML video');

  const mime = chooseMimeType();
  if (!mime) missing.push('recordable WebM or MP4');

  return { supported: missing.length === 0, missing, mime };
}

function setSupportStatus(report) {
  if (report.supported) {
    dom.supportPill.textContent = 'Browser ready';
    dom.supportPill.className = 'status-pill good';
    hideIssue();
    return;
  }

  dom.supportPill.textContent = 'Limited browser';
  dom.supportPill.className = 'status-pill warn';
  showIssue(`This browser is missing: ${report.missing.join(', ')}. Try a current desktop browser with MediaRecorder and canvas capture support.`);
}

function chooseMimeType() {
  if (!window.MediaRecorder) return '';

  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4'
  ];

  return candidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
}

async function loadFile(file) {
  try {
    clearResult();
    hideIssue();

    if (!file.type.startsWith('video/')) {
      showIssue('Please choose a video file.');
      return;
    }

    state.file = file;
    state.previewToken += 1;
    state.exportToken += 1;
    stopObjectUrl();

    state.objectUrl = URL.createObjectURL(file);
    dom.sourceVideo.src = state.objectUrl;
    dom.sourceVideo.muted = true;
    dom.sourceVideo.loop = false;

    await waitForEvent(dom.sourceVideo, 'loadedmetadata');

    const seekTarget = Number.isFinite(dom.sourceVideo.duration)
      ? Math.min(dom.sourceVideo.duration * 0.18, Math.max(0, dom.sourceVideo.duration - 0.05))
      : 0;
    if (seekTarget > 0) {
      dom.sourceVideo.currentTime = seekTarget;
      await waitForEvent(dom.sourceVideo, 'seeked');
    }

    const width = dom.sourceVideo.videoWidth;
    const height = dom.sourceVideo.videoHeight;
    if (!width || !height) {
      showIssue('The browser could not read the video dimensions.');
      return;
    }

    setCanvasSize(dom.beforeCanvas, width, height);
    setCanvasSize(dom.afterCanvas, width, height);
    updateOutputResolution();

    dom.fileCard.hidden = false;
    dom.fileName.textContent = file.name;
    dom.fileSize.textContent = formatBytes(file.size);
    dom.sourceResolution.textContent = `${width} x ${height}`;
    dom.sourceDuration.textContent = formatClock(dom.sourceVideo.duration);
    dom.previewHint.textContent = 'Drag the slider to inspect the enhanced frame.';
    dom.compareStage.classList.remove('empty');
    dom.previewButton.disabled = false;
    dom.resetButton.disabled = false;
    dom.startButton.disabled = !featureReport.supported;
    dom.statusText.textContent = 'Ready';
    dom.renderSummary.textContent = 'Export records the enhanced canvas in real time and never uploads the source file.';

    drawPreviewFrame();
    updatePreviewButton();
  } catch (error) {
    showIssue(readableError(error, 'The video could not be loaded.'));
  }
}

function setCanvasSize(canvas, width, height) {
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
}

function updateOutputResolution() {
  const width = dom.sourceVideo.videoWidth || 0;
  const height = dom.sourceVideo.videoHeight || 0;
  const scale = getScale();
  if (!width || !height) {
    dom.outputResolution.textContent = '-';
    return;
  }
  dom.outputResolution.textContent = `${Math.round(width * scale)} x ${Math.round(height * scale)}`;
}

function syncRangeLabels() {
  dom.sharpnessValue.textContent = dom.sharpnessRange.value;
  dom.contrastValue.textContent = dom.contrastRange.value;
}

function syncCompareSlider() {
  const value = Number(dom.compareRange.value);
  dom.afterLayer.style.width = `${value}%`;
  dom.divider.style.left = `${value}%`;
  dom.afterCanvas.style.width = `${dom.compareStage.clientWidth}px`;
  dom.afterCanvas.style.height = `${dom.compareStage.clientHeight}px`;
}

function drawPreviewFrame() {
  const video = dom.sourceVideo;
  if (!state.file || !video.videoWidth || !video.videoHeight) return;

  drawBaseFrame(beforeCtx, video, dom.beforeCanvas.width, dom.beforeCanvas.height);
  drawEnhancedFrame(afterCtx, video, dom.afterCanvas.width, dom.afterCanvas.height);
}

function drawBaseFrame(ctx, video, width, height) {
  ctx.save();
  ctx.filter = 'none';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#101820';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(video, 0, 0, width, height);
  ctx.restore();
}

function drawEnhancedFrame(ctx, source, width, height) {
  const settings = getEnhancementSettings();

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.filter = settings.filter;
  ctx.fillStyle = '#101820';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  ctx.restore();
}

function getEnhancementSettings() {
  const preset = dom.presetSelect.value;
  const sharp = Number(dom.sharpnessRange.value) / 100;
  const contrast = Number(dom.contrastRange.value);

  const presetBoost = {
    natural: { contrast: 1.04, saturation: 1.02, blur: 0.8 },
    crisp: { contrast: 1.1, saturation: 1.05, blur: 0.55 },
    soft: { contrast: 1.02, saturation: 1.0, blur: 1.1 }
  }[preset] || { contrast: 1.04, saturation: 1.02, blur: 0.8 };

  return {
    sharpness: Math.min(0.42, sharp),
    blur: presetBoost.blur,
    filter: `contrast(${(presetBoost.contrast + contrast / 180 + sharp / 5).toFixed(3)}) saturate(${presetBoost.saturation})`
  };
}

function schedulePreviewFrame() {
  const token = ++state.previewToken;
  const loop = () => {
    if (token !== state.previewToken || dom.sourceVideo.paused || dom.sourceVideo.ended || state.isExporting) return;
    drawPreviewFrame();
    requestVideoFrame(loop);
  };
  requestVideoFrame(loop);
}

function requestVideoFrame(callback) {
  if ('requestVideoFrameCallback' in dom.sourceVideo) {
    dom.sourceVideo.requestVideoFrameCallback(callback);
  } else {
    requestAnimationFrame(callback);
  }
}

async function togglePreviewPlayback() {
  if (!state.file || state.isExporting) return;
  try {
    if (dom.sourceVideo.paused) {
      if (dom.sourceVideo.ended) dom.sourceVideo.currentTime = 0;
      await dom.sourceVideo.play();
      schedulePreviewFrame();
    } else {
      dom.sourceVideo.pause();
    }
    updatePreviewButton();
  } catch (error) {
    showIssue(readableError(error, 'The preview could not start.'));
  }
}

async function resetPreview() {
  if (!state.file) return;
  dom.sourceVideo.pause();
  await seekSource(0).catch(() => undefined);
  drawPreviewFrame();
  updatePreviewButton();
}

function updatePreviewButton() {
  const path = dom.previewButton.querySelector('path');
  if (!path) return;
  if (dom.sourceVideo.paused) {
    dom.previewButton.title = 'Play preview';
    path.setAttribute('d', 'M8 5v14l11-7z');
  } else {
    dom.previewButton.title = 'Pause preview';
    path.setAttribute('d', 'M8 5h3v14H8zm5 0h3v14h-3z');
  }
}

async function startExport() {
  if (!state.file || state.isExporting) return;
  if (!featureReport.supported) {
    setSupportStatus(featureReport);
    return;
  }

  try {
    clearResult();
    hideIssue();
    state.exportToken += 1;
    state.discardExport = false;
    state.isExporting = true;
    state.isPaused = false;
    state.chunks = [];
    state.startedAt = performance.now();
    state.pausedAt = 0;
    state.totalPausedMs = 0;
    state.mimeType = chooseMimeType();
    state.extension = state.mimeType.includes('mp4') ? 'mp4' : 'webm';

    const scale = getScale();
    const outputWidth = Math.round(dom.sourceVideo.videoWidth * scale);
    const outputHeight = Math.round(dom.sourceVideo.videoHeight * scale);
    setCanvasSize(dom.exportCanvas, outputWidth, outputHeight);
    updateOutputResolution();

    const fps = Number(dom.fpsSelect.value);
    const bitrate = Number(dom.bitrateSelect.value);
    const canvasStream = dom.exportCanvas.captureStream(fps);
    const mediaTracks = [...canvasStream.getVideoTracks()];
    const audioTracks = getAudioTracksForExport();
    mediaTracks.push(...audioTracks);

    const stream = new MediaStream(mediaTracks);
    state.recorder = new MediaRecorder(stream, {
      mimeType: state.mimeType,
      videoBitsPerSecond: bitrate
    });

    state.recorder.addEventListener('dataavailable', event => {
      if (event.data && event.data.size > 0) state.chunks.push(event.data);
    });
    state.recorder.addEventListener('stop', onRecorderStop, { once: true });
    state.recorder.addEventListener('error', event => {
      showIssue(readableError(event.error, 'The browser stopped the recorder.'));
    });

    await seekSource(0);
    drawExportFrame();
    state.recorder.start(1000);
    await dom.sourceVideo.play();
    scheduleExportFrame(state.exportToken);
    setExportControls(true);
    updateProgress();
  } catch (error) {
    state.isExporting = false;
    setExportControls(false);
    showIssue(readableError(error, 'The export could not start.'));
  }
}

function getAudioTracksForExport() {
  if (!dom.audioCheck.checked || typeof dom.sourceVideo.captureStream !== 'function') {
    dom.audioText.textContent = 'Video only';
    return [];
  }

  const sourceStream = dom.sourceVideo.captureStream();
  const tracks = sourceStream.getAudioTracks();
  dom.audioText.textContent = tracks.length ? 'Included' : 'Unavailable';
  return tracks;
}

function scheduleExportFrame(token) {
  if (token !== state.exportToken || !state.isExporting || state.isPaused) return;
  drawExportFrame();
  updateProgress();
  requestVideoFrame(() => scheduleExportFrame(token));
}

function drawExportFrame() {
  if (!dom.sourceVideo.videoWidth || !dom.exportCanvas.width) return;
  drawEnhancedFrame(exportCtx, dom.sourceVideo, dom.exportCanvas.width, dom.exportCanvas.height);
  drawPreviewFrame();
}

function toggleExportPause() {
  if (!state.recorder || !state.isExporting) return;

  if (state.isPaused) {
    state.isPaused = false;
    state.totalPausedMs += performance.now() - state.pausedAt;
    state.pausedAt = 0;
    state.recorder.resume();
    dom.sourceVideo.play().then(() => {
      scheduleExportFrame(state.exportToken);
      updateProgress();
    }).catch(error => showIssue(readableError(error, 'The export could not resume.')));
    dom.pauseButton.textContent = 'Pause';
    dom.statusText.textContent = 'Rendering';
  } else {
    state.isPaused = true;
    state.pausedAt = performance.now();
    state.recorder.pause();
    dom.sourceVideo.pause();
    dom.pauseButton.textContent = 'Resume';
    dom.statusText.textContent = 'Paused';
  }
}

function cancelExport() {
  if (!state.recorder || !state.isExporting) return;
  state.discardExport = true;
  state.exportToken += 1;
  dom.sourceVideo.pause();
  if (state.recorder.state !== 'inactive') state.recorder.stop();
}

function finishExport() {
  if (!state.recorder || state.recorder.state === 'inactive') return;
  state.exportToken += 1;
  state.isExporting = false;
  dom.sourceVideo.pause();
  drawExportFrame();
  state.recorder.stop();
}

function onRecorderStop() {
  const tracks = state.recorder?.stream?.getTracks?.() || [];
  tracks.forEach(track => track.stop());
  setExportControls(false);
  state.isExporting = false;
  state.isPaused = false;
  dom.pauseButton.textContent = 'Pause';

  if (state.discardExport) {
    state.chunks = [];
    state.discardExport = false;
    updateProgress(0);
    dom.statusText.textContent = 'Cancelled';
    return;
  }

  const blob = new Blob(state.chunks, { type: state.mimeType });
  if (state.downloadUrl) URL.revokeObjectURL(state.downloadUrl);
  state.downloadUrl = URL.createObjectURL(blob);

  const baseName = state.file.name.replace(/\.[^.]+$/, '') || 'frameforge-export';
  dom.downloadLink.href = state.downloadUrl;
  dom.downloadLink.download = `${baseName}-upscaled.${state.extension}`;
  dom.resultMeta.textContent = `${formatBytes(blob.size)} ${state.extension.toUpperCase()} file ready.`;
  dom.resultSection.hidden = false;
  dom.statusText.textContent = 'Complete';
  updateProgress(100);
}

function setExportControls(isExporting) {
  dom.startButton.disabled = isExporting || !state.file || !featureReport.supported;
  dom.pauseButton.disabled = !isExporting;
  dom.cancelButton.disabled = !isExporting;
  dom.previewButton.disabled = isExporting || !state.file;
  dom.resetButton.disabled = isExporting || !state.file;
}

function updateProgress(forced) {
  const duration = dom.sourceVideo.duration || 0;
  const progress = Number.isFinite(forced)
    ? forced
    : duration > 0
      ? Math.min(100, Math.max(0, (dom.sourceVideo.currentTime / duration) * 100))
      : 0;

  dom.progressText.textContent = `${Math.round(progress)}%`;
  dom.progressBar.style.width = `${progress}%`;

  if (state.isExporting) {
    const elapsed = performance.now() - state.startedAt - state.totalPausedMs - (state.isPaused ? performance.now() - state.pausedAt : 0);
    const safeElapsed = Math.max(0, elapsed);
    dom.elapsedTime.textContent = formatClock(safeElapsed / 1000);
    if (progress > 1) {
      const totalEstimate = safeElapsed / (progress / 100);
      dom.etaTime.textContent = formatClock(Math.max(0, (totalEstimate - safeElapsed) / 1000));
    } else {
      dom.etaTime.textContent = 'calculating';
    }
    dom.statusText.textContent = state.isPaused ? 'Paused' : 'Rendering';
  }
}

function updateFormatText() {
  const type = chooseMimeType();
  dom.formatText.textContent = type ? type.replace('video/', '').replace(';codecs=', ' ') : '-';
}

function clearResult() {
  if (state.downloadUrl) URL.revokeObjectURL(state.downloadUrl);
  state.downloadUrl = '';
  dom.resultSection.hidden = true;
  dom.downloadLink.removeAttribute('href');
  dom.progressText.textContent = '0%';
  dom.progressBar.style.width = '0%';
  dom.elapsedTime.textContent = '00:00';
  dom.etaTime.textContent = '-';
  dom.statusText.textContent = state.file ? 'Ready' : 'Idle';
}

function showIssue(message) {
  dom.issueText.textContent = message;
  dom.issueSection.hidden = false;
}

function hideIssue() {
  dom.issueSection.hidden = true;
  dom.issueText.textContent = '';
}

function stopObjectUrl() {
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = '';
}

function getScale() {
  return Number(dom.scaleSelect.value) || 2;
}

function seekSource(seconds) {
  if (Math.abs(dom.sourceVideo.currentTime - seconds) < 0.01) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const done = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error('Could not seek the source video.'));
    };
    const cleanup = () => {
      dom.sourceVideo.removeEventListener('seeked', done);
      dom.sourceVideo.removeEventListener('error', fail);
    };
    dom.sourceVideo.addEventListener('seeked', done, { once: true });
    dom.sourceVideo.addEventListener('error', fail, { once: true });
    dom.sourceVideo.currentTime = seconds;
  });
}

function waitForEvent(target, eventName) {
  return new Promise((resolve, reject) => {
    const done = event => {
      cleanup();
      resolve(event);
    };
    const fail = () => {
      cleanup();
      reject(new Error(`Failed while waiting for ${eventName}.`));
    };
    const cleanup = () => {
      target.removeEventListener(eventName, done);
      target.removeEventListener('error', fail);
    };
    target.addEventListener(eventName, done, { once: true });
    target.addEventListener('error', fail, { once: true });
  });
}

function readableError(error, fallback) {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  return error.message || fallback;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '-';
  const total = Math.round(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
