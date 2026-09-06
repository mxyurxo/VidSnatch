// VidSnatch — Background Service Worker
// Intercepts network requests, detects videos, handles HLS/TS segment merging & downloads

const videoStore = {};   // { tabId: [videoObj] }
const tsStore = {};      // { tabId: { baseUrl: [tsUrl, ...] } }
const m3u8Store = {};    // { tabId: [m3u8Url, ...] }

const VIDEO_EXTENSIONS = /\.(mp4|webm|mkv|mov|avi|flv|wmv|m4v|3gp|ogv)(\?|#|$)/i;
const VIDEO_MIMES = /^video\//i;
const TS_EXTENSION = /\/[^\/]*\.ts(\?|#|$)/i;
const M3U8_EXTENSION = /\.m3u8(\?|#|$)/i;
const M3U8_MIMES = /mpegurl/i;
const BLOCKLIST = /doubleclick|googlesyndication|googleadservices|facebook\.com\/tr|analytics|pixel|beacon|\.gif(\?|#|$)/i;

// ─── Helpers ───

function extractDomain(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

function getVideoType(url, contentType) {
  if (contentType && VIDEO_MIMES.test(contentType)) {
    const m = contentType.match(/video\/(\w+)/i);
    return m ? m[1].toUpperCase() : 'VIDEO';
  }
  const ext = url.match(/\.(\w+)(\?|#|$)/);
  if (ext) {
    const map = { mp4:'MP4', webm:'WebM', mkv:'MKV', mov:'MOV', m4v:'M4V', avi:'AVI', flv:'FLV', m3u8:'M3U8', mpd:'DASH', ts:'TS' };
    return map[ext[1].toLowerCase()] || ext[1].toUpperCase();
  }
  return 'VIDEO';
}

function getBaseDir(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/');
    parts.pop();
    return u.origin + parts.join('/') + '/';
  } catch { return ''; }
}

function isDuplicate(tabId, url) {
  return videoStore[tabId]?.some(v => v.url === url);
}

function resolveUrl(base, relative) {
  try { return new URL(relative, base).href; } catch { return relative; }
}

// ─── Badge ───

function updateBadge(tabId) {
  const count = videoStore[tabId] ? videoStore[tabId].length : 0;
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '', tabId });
  chrome.action.setBadgeBackgroundColor({ color: '#7c3aed', tabId });
}

// ─── Add a detected video ───

function addVideo(tabId, details) {
  const { url, responseHeaders } = details;
  if (BLOCKLIST.test(url)) return;

  let contentType = '', contentLength = 0;
  if (responseHeaders) {
    for (const h of responseHeaders) {
      const n = h.name.toLowerCase();
      if (n === 'content-type') contentType = h.value || '';
      if (n === 'content-length') contentLength = parseInt(h.value) || 0;
    }
  }

  // ── Handle .ts segments ──
  if (TS_EXTENSION.test(url)) {
    if (!tsStore[tabId]) tsStore[tabId] = {};
    const base = getBaseDir(url);
    if (!tsStore[tabId][base]) tsStore[tabId][base] = [];
    if (!tsStore[tabId][base].includes(url)) {
      tsStore[tabId][base].push(url);
      upsertTsVideo(tabId, base);
    }
    return;
  }

  // ── Handle M3U8 playlists ──
  if (M3U8_EXTENSION.test(url) || M3U8_MIMES.test(contentType)) {
    if (!m3u8Store[tabId]) m3u8Store[tabId] = [];
    if (!m3u8Store[tabId].includes(url)) {
      m3u8Store[tabId].push(url);
      parseM3U8(tabId, url);
    }
    return;
  }

  // ── Handle direct video files ──
  const isVideoExt = VIDEO_EXTENSIONS.test(url);
  const isVideoMime = VIDEO_MIMES.test(contentType);
  if (!isVideoExt && !isVideoMime) return;
  if (isDuplicate(tabId, url)) return;

  if (!videoStore[tabId]) videoStore[tabId] = [];
  videoStore[tabId].push({
    url, type: getVideoType(url, contentType), size: contentLength,
    domain: extractDomain(url), isStream: false, segmentCount: 0, segments: null,
    timestamp: Date.now()
  });
  updateBadge(tabId);
}

// ─── Upsert TS stream entry ───

function upsertTsVideo(tabId, base) {
  if (!videoStore[tabId]) videoStore[tabId] = [];
  const segments = tsStore[tabId][base];

  // Sort numerically
  segments.sort((a, b) => {
    const nA = parseInt((a.match(/(\d+)\.ts/i) || [])[1]) || 0;
    const nB = parseInt((b.match(/(\d+)\.ts/i) || [])[1]) || 0;
    return nA - nB;
  });

  const existing = videoStore[tabId].find(v => v.isStream && v.streamBase === base);
  if (existing) {
    existing.segments = [...segments];
    existing.segmentCount = segments.length;
  } else {
    videoStore[tabId].push({
      url: base, type: 'TS Stream', size: 0, domain: extractDomain(base),
      isStream: true, streamBase: base, segmentCount: segments.length,
      segments: [...segments], timestamp: Date.now()
    });
  }
  updateBadge(tabId);
}

// ─── Parse M3U8 playlist ───

async function parseM3U8(tabId, m3u8Url) {
  try {
    const resp = await fetch(m3u8Url);
    if (!resp.ok) return;
    const text = await resp.text();
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    // Master playlist?
    const isMaster = lines.some(l => l.startsWith('#EXT-X-STREAM-INF'));

    if (isMaster) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
          const next = lines[i + 1];
          if (next && !next.startsWith('#')) {
            const variantUrl = resolveUrl(m3u8Url, next);
            if (!m3u8Store[tabId].includes(variantUrl)) {
              m3u8Store[tabId].push(variantUrl);
              parseM3U8(tabId, variantUrl);
            }
          }
        }
      }
      return;
    }

    // Media playlist — collect segments
    const segments = [];
    let totalDuration = 0;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('#EXTINF:')) {
        totalDuration += parseFloat(lines[i].split(':')[1]) || 0;
      } else if (!lines[i].startsWith('#')) {
        segments.push(resolveUrl(m3u8Url, lines[i]));
      }
    }

    if (segments.length === 0) return;

    let resolution = '';
    const resMatch = m3u8Url.match(/(\d{3,4})x(\d{3,4})/);
    if (resMatch) resolution = `${resMatch[1]}x${resMatch[2]}`;

    if (!videoStore[tabId]) videoStore[tabId] = [];

    const entry = {
      url: m3u8Url, m3u8Url, type: 'M3U8', size: 0, domain: extractDomain(m3u8Url),
      isStream: true, streamBase: getBaseDir(m3u8Url), segmentCount: segments.length,
      segments, duration: totalDuration, resolution, timestamp: Date.now()
    };

    const existingIdx = videoStore[tabId].findIndex(v => v.m3u8Url === m3u8Url);
    if (existingIdx >= 0) videoStore[tabId][existingIdx] = entry;
    else videoStore[tabId].push(entry);

    updateBadge(tabId);
  } catch (e) {
    console.warn('VidSnatch: M3U8 parse error', e);
  }
}

// ─── Download & merge TS segments ───

async function downloadAndMergeSegments(segments, sendProgress) {
  const total = segments.length;
  const chunks = [];
  let totalBytes = 0;

  for (let i = 0; i < total; i++) {
    try {
      const resp = await fetch(segments[i]);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buffer = await resp.arrayBuffer();
      chunks.push(buffer);
      totalBytes += buffer.byteLength;
      sendProgress({
        state: 'downloading',
        segmentsDone: i + 1, totalSegments: total,
        bytesDownloaded: totalBytes,
        percent: Math.round(((i + 1) / total) * 100)
      });
    } catch (e) {
      console.warn(`VidSnatch: Segment ${i + 1} failed:`, e);
      // Skip broken segments, continue
    }
  }

  if (chunks.length === 0) throw new Error('No segments downloaded');
  return new Blob(chunks, { type: 'video/mp2t' });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ─── Network interception ───

chrome.webRequest.onHeadersReceived.addListener(
  (details) => { if (details.tabId >= 0) addVideo(details.tabId, details); },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

// ─── Tab lifecycle ───

chrome.tabs.onRemoved.addListener((tabId) => {
  delete videoStore[tabId]; delete tsStore[tabId]; delete m3u8Store[tabId];
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    delete videoStore[tabId]; delete tsStore[tabId]; delete m3u8Store[tabId];
    updateBadge(tabId);
  }
});

// ─── Messaging ───

const mergeJobs = {};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.action === 'getVideos') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return sendResponse({ videos: [], tabInfo: {} });
      const tabId = tabs[0].id;
      sendResponse({
        videos: videoStore[tabId] || [],
        tabInfo: { url: tabs[0].url, title: tabs[0].title, domain: extractDomain(tabs[0].url) }
      });
    });
    return true;
  }

  if (message.action === 'addVideosFromContent') {
    const tabId = sender.tab?.id;
    if (!tabId) return;
    for (const v of (message.videos || [])) {
      if (TS_EXTENSION.test(v.url)) {
        if (!tsStore[tabId]) tsStore[tabId] = {};
        const base = getBaseDir(v.url);
        if (!tsStore[tabId][base]) tsStore[tabId][base] = [];
        if (!tsStore[tabId][base].includes(v.url)) {
          tsStore[tabId][base].push(v.url);
          upsertTsVideo(tabId, base);
        }
      } else if (M3U8_EXTENSION.test(v.url)) {
        if (!m3u8Store[tabId]) m3u8Store[tabId] = [];
        if (!m3u8Store[tabId].includes(v.url)) {
          m3u8Store[tabId].push(v.url);
          parseM3U8(tabId, v.url);
        }
      } else if (!isDuplicate(tabId, v.url)) {
        if (!videoStore[tabId]) videoStore[tabId] = [];
        videoStore[tabId].push({
          url: v.url, type: v.type || 'MP4', size: v.size || 0,
          domain: extractDomain(v.url), isStream: false,
          duration: v.duration || 0, width: v.width || 0, height: v.height || 0,
          timestamp: Date.now()
        });
      }
    }
    updateBadge(tabId);
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'downloadVideo') {
    chrome.downloads.download({
      url: message.url, filename: message.filename || 'video.mp4', saveAs: true
    }, (downloadId) => {
      sendResponse(chrome.runtime.lastError
        ? { success: false, error: chrome.runtime.lastError.message }
        : { success: true, downloadId });
    });
    return true;
  }

  if (message.action === 'downloadMergedStream') {
    const { segments, filename } = message;
    const jobId = 'job_' + Date.now();
    mergeJobs[jobId] = { state: 'starting', percent: 0, segmentsDone: 0, totalSegments: segments.length, bytesDownloaded: 0 };
    sendResponse({ success: true, jobId });

    (async () => {
      try {
        const blob = await downloadAndMergeSegments(segments, (p) => { mergeJobs[jobId] = { ...p }; });
        mergeJobs[jobId] = { state: 'converting', percent: 99, segmentsDone: segments.length, totalSegments: segments.length, bytesDownloaded: mergeJobs[jobId].bytesDownloaded };

        const dataUrl = await blobToDataUrl(blob);
        chrome.downloads.download({ url: dataUrl, filename: filename || 'video.ts', saveAs: true }, (dlId) => {
          mergeJobs[jobId] = chrome.runtime.lastError
            ? { state: 'error', error: chrome.runtime.lastError.message }
            : { state: 'complete', percent: 100, downloadId: dlId };
        });
      } catch (e) {
        mergeJobs[jobId] = { state: 'error', error: e.message };
      }
    })();
    return true;
  }

  if (message.action === 'getMergeProgress') {
    sendResponse(mergeJobs[message.jobId] || { state: 'unknown' });
    return true;
  }

  if (message.action === 'getDownloadProgress') {
    chrome.downloads.search({ id: message.downloadId }, (items) => {
      sendResponse(items?.[0] ? { state: items[0].state, bytesReceived: items[0].bytesReceived, totalBytes: items[0].totalBytes } : { state: 'unknown' });
    });
    return true;
  }
});
