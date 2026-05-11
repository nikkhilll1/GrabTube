/* ═══════════════════════════════════════════════════════════════
   GrabTube — Renderer Logic (app.js)
   ═══════════════════════════════════════════════════════════════ */

// ─── DOM Elements ────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const urlInput = $('#url-input');
const btnFetch = $('#btn-fetch');
const btnPaste = $('#btn-paste');
const btnDownload = $('#btn-download');
const dropZone = $('#drop-zone');
const formatSelect = $('#format-select');
const folderPath = $('#folder-path');
const queueList = $('#queue-list');
const queueEmpty = $('#queue-empty');
const queueCount = $('#queue-count');
const videoPreview = $('#video-preview');
const optionsPanel = $('#options-panel');
const statusBanner = $('#app-status-banner');
const statusText = $('#app-status-text');
const toastContainer = $('#toast-container');

// ─── State ───────────────────────────────────────────────────
let currentVideoInfo = null;
let downloads = new Map();
let outputFolder = '';

// ─── Window Controls ─────────────────────────────────────────
$('#btn-minimize').addEventListener('click', () => window.api.minimizeWindow());
$('#btn-maximize').addEventListener('click', () => window.api.maximizeWindow());
$('#btn-close').addEventListener('click', () => window.api.closeWindow());

// ─── Initialize ──────────────────────────────────────────────
async function init() {
  const settings = await window.api.getSettings();
  outputFolder = settings.outputFolder;
  folderPath.textContent = shortenPath(outputFolder);
  folderPath.title = outputFolder;
  $('#toggle-metadata').checked = settings.embedMetadata;
}
init();

// ─── App Status ──────────────────────────────────────────────
window.api.onAppStatus((data) => {
  statusBanner.classList.remove('hidden', 'error', 'ready');
  statusText.textContent = data.message;
  if (data.type === 'ready') {
    statusBanner.classList.add('ready');
    setTimeout(() => statusBanner.classList.add('hidden'), 3000);
  } else if (data.type === 'error') {
    statusBanner.classList.add('error');
  }
});

// ─── URL Input ───────────────────────────────────────────────
urlInput.addEventListener('input', () => {
  const hasUrl = urlInput.value.trim().length > 0;
  btnFetch.disabled = !hasUrl;
});

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!btnFetch.disabled) fetchVideoInfo();
  }
});

btnPaste.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    urlInput.value = text;
    urlInput.dispatchEvent(new Event('input'));
    if (isValidYouTubeUrl(text.trim())) fetchVideoInfo();
  } catch (e) {
    showToast('Could not read clipboard', 'error');
  }
});

btnFetch.addEventListener('click', fetchVideoInfo);

// ─── Drag & Drop ─────────────────────────────────────────────
['dragenter', 'dragover'].forEach(evt => {
  dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
});
['dragleave', 'drop'].forEach(evt => {
  dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.remove('drag-over'); });
});
dropZone.addEventListener('drop', (e) => {
  const text = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list');
  if (text && text.trim()) {
    urlInput.value = text.trim();
    urlInput.dispatchEvent(new Event('input'));
    if (isValidYouTubeUrl(text.trim())) fetchVideoInfo();
  }
});

// Whole window drag support
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const text = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list');
  if (text && text.trim()) {
    urlInput.value = text.trim();
    urlInput.dispatchEvent(new Event('input'));
  }
});

// ─── Fetch Video Info ────────────────────────────────────────
async function fetchVideoInfo() {
  const rawInput = urlInput.value.trim();
  if (!rawInput) return;

  // Support batch: take first URL for preview
  const urls = rawInput.split('\n').map(u => u.trim()).filter(Boolean);
  const firstUrl = urls[0];

  if (!isValidUrl(firstUrl)) {
    showToast('Please enter a valid URL', 'error');
    return;
  }

  btnFetch.classList.add('loading');
  btnFetch.disabled = true;

  const result = await window.api.getVideoInfo(firstUrl);

  btnFetch.classList.remove('loading');
  btnFetch.disabled = false;

  if (result.success) {
    currentVideoInfo = result.data;
    currentVideoInfo._allUrls = urls;
    showVideoPreview(result.data);
    showOptionsPanel(result.data);
    if (urls.length > 1) {
      showToast(`Found ${urls.length} URLs — batch download ready`, 'success');
    }
  } else {
    showToast(result.error || 'Failed to fetch video info', 'error');
  }
}

// ─── Show Video Preview ──────────────────────────────────────
function showVideoPreview(info) {
  videoPreview.classList.remove('hidden');
  $('#preview-thumbnail').src = info.thumbnail;
  $('#preview-title').textContent = info.title;
  $('#preview-channel').textContent = info.channel;
  $('#preview-duration').textContent = info.durationFormatted;
  $('#preview-views span').textContent = formatNumber(info.viewCount) + ' views';
}

$('#btn-clear-preview').addEventListener('click', () => {
  videoPreview.classList.add('hidden');
  optionsPanel.classList.add('hidden');
  currentVideoInfo = null;
  urlInput.value = '';
  btnFetch.disabled = true;
  resetFormatSelect();
});

// ─── Options Panel ───────────────────────────────────────────
function showOptionsPanel(info) {
  optionsPanel.classList.remove('hidden');
  btnDownload.disabled = false;

  // Populate format selector
  formatSelect.innerHTML = '<option value="best-mp4">Best Quality (MP4)</option>';
  if (info.formats) {
    info.formats.forEach(f => {
      if (f.id === 'audio-only') return;
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.label + (f.filesize ? ` — ${formatBytes(f.filesize)}` : '');
      formatSelect.appendChild(opt);
    });
  }
  const audioOpt = document.createElement('option');
  audioOpt.value = 'audio-only';
  audioOpt.textContent = '🎵 Audio Only (MP3)';
  formatSelect.appendChild(audioOpt);

  // Update batch button text
  const urls = currentVideoInfo?._allUrls || [];
  btnDownload.querySelector('span').textContent = urls.length > 1 ? `Download All (${urls.length})` : 'Download';
}

function resetFormatSelect() {
  formatSelect.innerHTML = '<option value="best-mp4">Best Quality (MP4)</option>';
}

// Audio-only toggle syncs with format selector
$('#toggle-audio-only').addEventListener('change', (e) => {
  if (e.target.checked) {
    formatSelect.value = 'audio-only';
  } else if (formatSelect.value === 'audio-only') {
    formatSelect.value = 'best-mp4';
  }
});
formatSelect.addEventListener('change', () => {
  $('#toggle-audio-only').checked = (formatSelect.value === 'audio-only');
});

// ─── Folder Selection ────────────────────────────────────────
$('#btn-change-folder').addEventListener('click', async () => {
  const result = await window.api.selectOutputFolder();
  if (result.success) {
    outputFolder = result.path;
    folderPath.textContent = shortenPath(result.path);
    folderPath.title = result.path;
  }
});
$('#btn-open-folder').addEventListener('click', () => {
  if (outputFolder) window.api.openFolder(outputFolder);
});

// ─── Start Download ──────────────────────────────────────────
btnDownload.addEventListener('click', startDownload);

async function startDownload() {
  if (!currentVideoInfo) return;

  const urls = currentVideoInfo._allUrls || [currentVideoInfo.url];
  const format = formatSelect.value;
  const audioOnly = format === 'audio-only' || $('#toggle-audio-only').checked;
  const subtitles = $('#toggle-subtitles').checked;
  const embedMetadata = $('#toggle-metadata').checked;

  for (const url of urls) {
    const options = { url, format: audioOnly ? 'audio-only' : format, outputFolder, audioOnly, subtitles, embedMetadata };
    const result = await window.api.startDownload(options);

    if (result.success) {
      const title = urls.length === 1 ? currentVideoInfo.title : extractTitleFromUrl(url);
      addToQueue(result.id, title, url);
    } else {
      showToast(`Failed: ${result.error}`, 'error');
    }
  }
}

// ─── Download Queue ──────────────────────────────────────────
function addToQueue(id, title, url) {
  queueEmpty.classList.add('hidden');
  downloads.set(id, { title, url, percent: 0, status: 'downloading' });
  updateQueueCount();

  const item = document.createElement('div');
  item.className = 'queue-item';
  item.id = `queue-${id}`;
  item.innerHTML = `
    <div class="queue-item-icon" id="qicon-${id}">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
    </div>
    <div class="queue-item-info">
      <div class="queue-item-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
      <div class="queue-item-meta">
        <span id="qspeed-${id}">Starting...</span>
        <span id="qeta-${id}"></span>
      </div>
    </div>
    <div class="queue-item-progress">
      <div class="progress-bar-wrapper"><div class="progress-bar" id="qbar-${id}" style="width:0%"></div></div>
      <div class="progress-text" id="qpercent-${id}">0%</div>
    </div>
    <div class="queue-item-actions">
      <button class="btn-icon btn-small" title="Cancel" onclick="cancelDownload('${id}')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
  `;
  queueList.prepend(item);
}

function updateQueueCount() {
  const count = downloads.size;
  queueCount.textContent = `${count} item${count !== 1 ? 's' : ''}`;
}

// ─── Progress Updates ────────────────────────────────────────
window.api.onProgress((data) => {
  const { id, percent, speed, eta, status } = data;
  const bar = $(`#qbar-${id}`);
  const pct = $(`#qpercent-${id}`);
  const spd = $(`#qspeed-${id}`);
  const etaEl = $(`#qeta-${id}`);

  if (!bar) return;

  const p = Math.min(Math.round(percent || 0), 100);
  bar.style.width = `${p}%`;
  pct.textContent = `${p}%`;
  if (speed) spd.textContent = speed;
  if (eta) etaEl.textContent = `ETA: ${eta}`;
  if (status === 'merging') {
    spd.textContent = 'Merging streams...';
    etaEl.textContent = '';
  }
});

window.api.onComplete((data) => {
  const { id, outputFolder: folder } = data;
  const bar = $(`#qbar-${id}`);
  const icon = $(`#qicon-${id}`);
  const pct = $(`#qpercent-${id}`);
  const spd = $(`#qspeed-${id}`);
  const etaEl = $(`#qeta-${id}`);

  if (bar) {
    bar.style.width = '100%';
    bar.classList.add('complete');
    pct.textContent = 'Done!';
    icon.classList.add('complete');
    icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    spd.textContent = 'Complete';
    etaEl.textContent = '';
    icon.classList.add('celebrate');
  }

  if (downloads.has(id)) {
    downloads.get(id).status = 'complete';
    const title = downloads.get(id).title;
    showToast(`Downloaded: ${title}`, 'success');
  }
});

window.api.onError((data) => {
  const { id, error } = data;
  const icon = $(`#qicon-${id}`);
  const spd = $(`#qspeed-${id}`);
  const pct = $(`#qpercent-${id}`);
  const bar = $(`#qbar-${id}`);

  if (icon) {
    icon.classList.add('error');
    icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
  }
  if (spd) spd.textContent = 'Failed';
  if (pct) pct.textContent = 'Error';
  if (bar) bar.style.background = 'var(--accent-red)';

  showToast(error || 'Download failed', 'error');

  if (downloads.has(id)) downloads.get(id).status = 'error';
});

// ─── Cancel Download ─────────────────────────────────────────
window.cancelDownload = async function(id) {
  await window.api.cancelDownload(id);
  const item = $(`#queue-${id}`);
  if (item) item.remove();
  downloads.delete(id);
  updateQueueCount();
  if (downloads.size === 0) queueEmpty.classList.remove('hidden');
  showToast('Download cancelled', 'error');
};

// ─── Toast Notifications ────────────────────────────────────
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const iconSvg = type === 'success'
    ? '<svg class="toast-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>'
    : '<svg class="toast-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  toast.innerHTML = `${iconSvg}<span>${escapeHtml(message)}</span>`;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ─── Utilities ───────────────────────────────────────────────
function isValidYouTubeUrl(url) {
  return /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch|shorts|embed)|youtu\.be\/)/.test(url);
}
function isValidUrl(url) {
  try { new URL(url); return true; } catch { return false; }
}
function formatNumber(num) {
  if (!num) return '0';
  if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toString();
}
function formatBytes(bytes) {
  if (!bytes) return '';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
function shortenPath(p) {
  if (!p) return '';
  const parts = p.replace(/\\/g, '/').split('/');
  if (parts.length <= 3) return p;
  return '~/' + parts.slice(-2).join('/');
}
function extractTitleFromUrl(url) {
  try {
    const u = new URL(url);
    const id = u.searchParams.get('v') || u.pathname.split('/').pop();
    return `Video (${id})`;
  } catch { return 'Unknown Video'; }
}
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
