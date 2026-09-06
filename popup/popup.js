// VidSnatch — Popup Logic
// Handles rendering, format selection, direct downloads, and TS segment merge downloads

document.addEventListener('DOMContentLoaded', () => {
  const videoList = document.getElementById('videoList');
  const pageDomain = document.getElementById('pageDomain');
  const videoCount = document.getElementById('videoCount');

  let activeDropdown = null;

  // ─── Utilities ───

  function fmtBytes(b) {
    if (!b) return '';
    const u = ['B','KB','MB','GB'];
    let i = 0, s = b;
    while (s >= 1024 && i < u.length - 1) { s /= 1024; i++; }
    return `${s.toFixed(i > 0 ? 1 : 0)} ${u[i]}`;
  }

  function fmtDuration(sec) {
    if (!sec || !isFinite(sec)) return '';
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function fmtRes(w, h) {
    if (!w || !h) return '';
    if (h >= 2160) return '4K';
    if (h >= 1440) return '1440p';
    if (h >= 1080) return '1080p';
    if (h >= 720) return '720p';
    if (h >= 480) return '480p';
    if (h >= 360) return '360p';
    return `${w}×${h}`;
  }

  function filenameFromUrl(url) {
    try {
      const p = new URL(url).pathname.split('/');
      const last = p[p.length - 1];
      if (last && last.includes('.')) return decodeURIComponent(last);
    } catch {}
    return 'video';
  }

  // ─── SVG Icons ───
  const IC = {
    play: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M8 5L19 12L8 19V5Z" fill="#7c3aed"/></svg>`,
    stream: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M4 8h4v8H4zM10 6h4v12h-4zM16 10h4v4h-4z" fill="#7c3aed" opacity="0.9"/></svg>`,
    dur: `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.2"/><path d="M6 3.5V6.5L8 7.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
    res: `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1.5" y="2.5" width="9" height="7" rx="1" stroke="currentColor" stroke-width="1.2"/></svg>`,
    size: `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 10V3C2 2.45 2.45 2 3 2H7L10 5V10C10 10.55 9.55 11 9 11H3C2.45 11 2 10.55 2 10Z" stroke="currentColor" stroke-width="1.2"/></svg>`,
    fmt: `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1.5" y="1.5" width="9" height="9" rx="2" stroke="currentColor" stroke-width="1.2"/><path d="M4.5 4L7.5 6L4.5 8V4Z" fill="currentColor"/></svg>`,
    domain: `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.2"/><path d="M1.5 6H10.5" stroke="currentColor" stroke-width="0.8"/><ellipse cx="6" cy="6" rx="2" ry="4.5" stroke="currentColor" stroke-width="0.8"/></svg>`,
    dl: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2V9M7 9L4 6.5M7 9L10 6.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.5 11H11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    check: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7L6 10L11 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    chev: `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3 4L5 6L7 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
    ok: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="#22c55e" stroke-width="1.5"/><path d="M4.5 7L6.5 9L9.5 5" stroke="#22c55e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    seg: `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="3" width="3" height="6" rx="0.5" fill="currentColor" opacity="0.6"/><rect x="4.5" y="3" width="3" height="6" rx="0.5" fill="currentColor" opacity="0.8"/><rect x="8" y="3" width="3" height="6" rx="0.5" fill="currentColor"/></svg>`,
    spinner: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" class="spin"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.5" stroke-dasharray="20 12" stroke-linecap="round"/></svg>`
  };

  // ─── Badge helper ───
  function badge(icon, text, cls = '') {
    return `<span class="badge ${cls}">${icon} ${text}</span>`;
  }

  // ─── Format options (for non-stream) ───
  const FORMATS = [
    { id: 'mp4', name: 'MP4', desc: 'Universal compatibility' },
    { id: 'webm', name: 'WebM', desc: 'Web playback' }
  ];

  // ─── Create a video card ───
  function createCard(video, idx) {
    const el = document.createElement('div');
    el.className = 'video-card';
    el.dataset.index = idx;

    const isStream = video.isStream;
    const title = isStream
      ? (video.domain || 'Stream') + ' — ' + (video.resolution || video.type)
      : filenameFromUrl(video.url);

    // Build badges
    let badges = '';
    const dur = fmtDuration(video.duration);
    if (dur) badges += badge(IC.dur, dur);

    const res = video.resolution || fmtRes(video.width, video.height);
    if (res) badges += badge(IC.res, res);

    const sz = fmtBytes(video.size);
    if (sz) badges += badge(IC.size, sz);

    badges += badge(IC.fmt, video.type, 'badge-format');

    if (isStream && video.segmentCount) {
      badges += badge(IC.seg, `${video.segmentCount} segments`, 'badge-segments');
    }

    if (video.domain) badges += badge(IC.domain, video.domain);

    // For streams: output format is .ts (merged) or .mp4
    // For direct files: mp4 or webm
    const defaultFmt = isStream ? 'ts' : (video.type === 'WebM' ? 'webm' : 'mp4');

    const streamFormats = [
      { id: 'ts', name: 'TS', desc: 'Merged stream (VLC)' },
      { id: 'mp4', name: 'MP4', desc: 'Universal compatibility' }
    ];
    const fmtList = isStream ? streamFormats : FORMATS;
    const selectedFmt = fmtList[0];

    el.innerHTML = `
      <div class="card-header">
        <div class="video-thumb ${isStream ? 'stream-thumb' : ''}">
          ${isStream ? IC.stream : IC.play}
        </div>
        <div class="video-info">
          <div class="video-title" title="${title}">${title}</div>
          <div class="meta-badges">${badges}</div>
        </div>
      </div>
      <div class="card-actions">
        <div class="format-selector" data-idx="${idx}">
          <button class="format-btn" data-idx="${idx}">
            <span class="fmt-label">${selectedFmt.name}</span>
            <span class="fmt-desc">${selectedFmt.desc}</span>
            ${IC.chev}
          </button>
          <div class="format-dropdown" data-idx="${idx}">
            ${fmtList.map((f, fi) => `
              <div class="format-option ${fi === 0 ? 'selected' : ''}" data-format="${f.id}" data-idx="${idx}">
                <div>
                  <div class="format-option-name">${f.name}</div>
                  <div class="format-option-desc">${f.desc}</div>
                </div>
                <span class="format-check">${IC.check}</span>
              </div>
            `).join('')}
          </div>
        </div>
        <button class="download-btn" data-idx="${idx}" data-stream="${isStream ? '1' : '0'}">
          ${IC.dl}
          <span>${isStream ? 'Merge & Save' : 'Save to Computer'}</span>
        </button>
      </div>
      <div class="progress-container" data-idx="${idx}">
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" data-idx="${idx}"></div>
        </div>
        <div class="progress-info">
          <span class="progress-size" data-idx="${idx}"></span>
          <span class="progress-percent" data-idx="${idx}"></span>
        </div>
        <div class="progress-segments" data-idx="${idx}" style="display:none">
          <span class="seg-icon">${IC.seg}</span>
          <span class="seg-text"></span>
        </div>
      </div>
    `;
    return el;
  }

  // ─── Render ───
  let currentVideos = [];

  function render(videos, tabInfo) {
    pageDomain.textContent = tabInfo.domain || tabInfo.url || 'Unknown page';
    videoCount.textContent = `${videos.length} video${videos.length !== 1 ? 's' : ''} found`;
    videoList.innerHTML = '';
    currentVideos = videos;

    if (videos.length === 0) {
      videoList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <rect x="6" y="10" width="36" height="28" rx="4" stroke="#444" stroke-width="2"/>
              <path d="M20 18L30 24L20 30V18Z" fill="#444"/>
            </svg>
          </div>
          <p class="empty-title">No videos detected</p>
          <p class="empty-subtitle">Play or load a video on this page</p>
        </div>`;
      return;
    }

    // Sort: streams first, then by size
    videos.sort((a, b) => {
      if (a.isStream && !b.isStream) return -1;
      if (!a.isStream && b.isStream) return 1;
      return (b.size || 0) - (a.size || 0);
    });

    videos.forEach((v, i) => videoList.appendChild(createCard(v, i)));
  }

  // ─── Event Delegation ───
  videoList.addEventListener('click', (e) => {
    // Format button
    const fBtn = e.target.closest('.format-btn');
    if (fBtn) {
      e.stopPropagation();
      const dd = videoList.querySelector(`.format-dropdown[data-idx="${fBtn.dataset.idx}"]`);
      if (activeDropdown && activeDropdown !== dd) activeDropdown.classList.remove('open');
      dd.classList.toggle('open');
      activeDropdown = dd.classList.contains('open') ? dd : null;
      return;
    }

    // Format option
    const fOpt = e.target.closest('.format-option');
    if (fOpt) {
      e.stopPropagation();
      const { idx, format } = fOpt.dataset;
      const dd = fOpt.closest('.format-dropdown');
      dd.querySelectorAll('.format-option').forEach(o => o.classList.remove('selected'));
      fOpt.classList.add('selected');
      const btn = videoList.querySelector(`.format-btn[data-idx="${idx}"]`);
      btn.querySelector('.fmt-label').textContent = fOpt.querySelector('.format-option-name').textContent;
      btn.querySelector('.fmt-desc').textContent = fOpt.querySelector('.format-option-desc').textContent;
      dd.classList.remove('open');
      activeDropdown = null;
      return;
    }

    // Download button
    const dBtn = e.target.closest('.download-btn');
    if (dBtn && !dBtn.disabled) {
      const idx = parseInt(dBtn.dataset.idx);
      const isStream = dBtn.dataset.stream === '1';
      const video = currentVideos[idx];
      if (!video) return;

      const fmt = videoList.querySelector(`.format-btn[data-idx="${idx}"] .fmt-label`).textContent.toLowerCase();

      if (isStream) {
        startStreamDownload(video, idx, fmt, dBtn);
      } else {
        startDirectDownload(video, idx, fmt, dBtn);
      }
    }
  });

  document.addEventListener('click', () => {
    if (activeDropdown) { activeDropdown.classList.remove('open'); activeDropdown = null; }
  });

  // ─── Direct Download ───
  function startDirectDownload(video, idx, fmt, btn) {
    let filename = filenameFromUrl(video.url);
    filename = filename.replace(/\.\w+$/, `.${fmt}`) || `video.${fmt}`;

    btn.disabled = true;
    btn.innerHTML = `${IC.spinner} <span>Downloading...</span>`;
    btn.classList.add('downloading');

    const prog = videoList.querySelector(`.progress-container[data-idx="${idx}"]`);
    if (prog) prog.classList.add('active');

    chrome.runtime.sendMessage({ action: 'downloadVideo', url: video.url, filename }, (resp) => {
      if (resp?.success) {
        pollDirectProgress(resp.downloadId, idx, btn);
      } else {
        resetBtn(btn, idx, false);
      }
    });
  }

  function pollDirectProgress(dlId, idx, btn) {
    const fill = videoList.querySelector(`.progress-bar-fill[data-idx="${idx}"]`);
    const szEl = videoList.querySelector(`.progress-size[data-idx="${idx}"]`);
    const pctEl = videoList.querySelector(`.progress-percent[data-idx="${idx}"]`);
    const prog = videoList.querySelector(`.progress-container[data-idx="${idx}"]`);

    const iv = setInterval(() => {
      chrome.runtime.sendMessage({ action: 'getDownloadProgress', downloadId: dlId }, (r) => {
        if (!r) { clearInterval(iv); return; }
        if (r.state === 'in_progress') {
          const pct = r.totalBytes > 0 ? Math.round((r.bytesReceived / r.totalBytes) * 100) : 0;
          if (fill) fill.style.width = `${pct}%`;
          if (szEl) szEl.textContent = `${fmtBytes(r.bytesReceived)} / ${fmtBytes(r.totalBytes)}`;
          if (pctEl) pctEl.textContent = `${pct}%`;
        } else if (r.state === 'complete') {
          clearInterval(iv);
          if (fill) fill.style.width = '100%';
          if (pctEl) pctEl.textContent = '100%';
          btn.classList.remove('downloading');
          btn.innerHTML = `${IC.ok} <span style="color:#22c55e">Downloaded!</span>`;
          setTimeout(() => resetBtn(btn, idx, false), 3000);
        } else {
          clearInterval(iv);
          resetBtn(btn, idx, false);
        }
      });
    }, 500);
  }

  // ─── Stream Merge Download ───
  function startStreamDownload(video, idx, fmt, btn) {
    if (!video.segments || video.segments.length === 0) {
      btn.textContent = 'No segments found';
      setTimeout(() => resetBtn(btn, idx, true), 2000);
      return;
    }

    const filename = `${video.domain || 'video'}_${video.resolution || 'stream'}.${fmt === 'mp4' ? 'mp4' : 'ts'}`;

    btn.disabled = true;
    btn.innerHTML = `${IC.spinner} <span>Merging ${video.segments.length} segments...</span>`;
    btn.classList.add('downloading');

    const prog = videoList.querySelector(`.progress-container[data-idx="${idx}"]`);
    const segDiv = videoList.querySelector(`.progress-segments[data-idx="${idx}"]`);
    if (prog) prog.classList.add('active');
    if (segDiv) segDiv.style.display = 'flex';

    chrome.runtime.sendMessage({
      action: 'downloadMergedStream',
      segments: video.segments,
      filename
    }, (resp) => {
      if (resp?.success) {
        pollMergeProgress(resp.jobId, idx, btn, video.segments.length);
      } else {
        resetBtn(btn, idx, true);
      }
    });
  }

  function pollMergeProgress(jobId, idx, btn, totalSegs) {
    const fill = videoList.querySelector(`.progress-bar-fill[data-idx="${idx}"]`);
    const szEl = videoList.querySelector(`.progress-size[data-idx="${idx}"]`);
    const pctEl = videoList.querySelector(`.progress-percent[data-idx="${idx}"]`);
    const segText = videoList.querySelector(`.progress-segments[data-idx="${idx}"] .seg-text`);
    const prog = videoList.querySelector(`.progress-container[data-idx="${idx}"]`);

    const iv = setInterval(() => {
      chrome.runtime.sendMessage({ action: 'getMergeProgress', jobId }, (r) => {
        if (!r) { clearInterval(iv); return; }

        if (r.state === 'downloading') {
          const pct = r.percent || 0;
          if (fill) fill.style.width = `${pct}%`;
          if (szEl) szEl.textContent = fmtBytes(r.bytesDownloaded);
          if (pctEl) pctEl.textContent = `${pct}%`;
          if (segText) segText.textContent = `${r.segmentsDone} / ${r.totalSegments} segments`;
          btn.innerHTML = `${IC.spinner} <span>Merging... ${r.segmentsDone}/${r.totalSegments}</span>`;
        } else if (r.state === 'converting') {
          if (fill) fill.style.width = '99%';
          if (pctEl) pctEl.textContent = '99%';
          btn.innerHTML = `${IC.spinner} <span>Saving file...</span>`;
        } else if (r.state === 'complete') {
          clearInterval(iv);
          if (fill) fill.style.width = '100%';
          if (pctEl) pctEl.textContent = '100%';
          if (segText) segText.textContent = `${totalSegs} / ${totalSegs} segments ✓`;
          btn.classList.remove('downloading');
          btn.innerHTML = `${IC.ok} <span style="color:#22c55e">Merged & Saved!</span>`;
          setTimeout(() => resetBtn(btn, idx, true), 4000);
        } else if (r.state === 'error') {
          clearInterval(iv);
          btn.classList.remove('downloading');
          btn.innerHTML = `<span style="color:#ef4444">Error: ${r.error || 'Failed'}</span>`;
          setTimeout(() => resetBtn(btn, idx, true), 3000);
        }
      });
    }, 600);
  }

  // ─── Reset button to default ───
  function resetBtn(btn, idx, isStream) {
    btn.disabled = false;
    btn.classList.remove('downloading');
    btn.innerHTML = `${IC.dl} <span>${isStream ? 'Merge & Save' : 'Save to Computer'}</span>`;
    const prog = videoList.querySelector(`.progress-container[data-idx="${idx}"]`);
    if (prog) prog.classList.remove('active');
    const segDiv = videoList.querySelector(`.progress-segments[data-idx="${idx}"]`);
    if (segDiv) segDiv.style.display = 'none';
  }

  // ─── Init ───
  function init() {
    videoList.innerHTML = `
      <div class="scanning">
        <div class="scanning-dots"><span></span><span></span><span></span></div>
        <span class="scanning-text">Scanning for videos...</span>
      </div>`;

    chrome.runtime.sendMessage({ action: 'getVideos' }, (resp) => {
      if (chrome.runtime.lastError) {
        videoList.innerHTML = `<div class="empty-state"><p class="empty-title">Connection error</p><p class="empty-subtitle">Try reloading the page</p></div>`;
        return;
      }
      const { videos, tabInfo } = resp || { videos: [], tabInfo: {} };
      setTimeout(() => render(videos, tabInfo), 300);
    });
  }

  init();
});
