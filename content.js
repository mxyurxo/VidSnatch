// VidSnatch — Content Script
// Scans DOM + Shadow DOM for video elements, detects Mux/web component players,
// intercepts fetch/XHR for video & TS URLs

(function() {
  'use strict';

  const detected = new Set();

  function getType(url) {
    const m = url.match(/\.(\w+)(\?|#|$)/);
    if (!m) return 'VIDEO';
    const map = { mp4:'MP4', webm:'WebM', mkv:'MKV', mov:'MOV', m4v:'M4V', avi:'AVI', flv:'FLV', m3u8:'M3U8', mpd:'DASH', ts:'TS' };
    return map[m[1].toLowerCase()] || m[1].toUpperCase();
  }

  function isValid(url) {
    return url && !url.startsWith('blob:') && !url.startsWith('data:') && url.length > 10;
  }

  function send(videos) {
    if (!videos.length) return;
    try { chrome.runtime.sendMessage({ action: 'addVideosFromContent', videos }); } catch {}
  }

  // ─── Deep DOM traversal that crosses Shadow DOM boundaries ───
  function querySelectorAllDeep(selector, root = document) {
    const results = [];
    // First, query the root itself
    root.querySelectorAll(selector).forEach(el => results.push(el));
    
    // Then, find all elements in this root and check for shadow roots
    const allElements = root.querySelectorAll('*');
    for (const el of allElements) {
      if (el.shadowRoot) {
        // Recursively search inside shadow DOM
        const innerResults = querySelectorAllDeep(selector, el.shadowRoot);
        results.push(...innerResults);
      }
    }
    return results;
  }

  // Get all elements (including shadow DOM) to find custom video players
  function getAllElementsDeep(root = document) {
    const results = [];
    const all = root.querySelectorAll('*');
    for (const el of all) {
      results.push(el);
      if (el.shadowRoot) {
        results.push(...getAllElementsDeep(el.shadowRoot));
      }
    }
    return results;
  }

  function scan() {
    const found = [];
    const videoPat = /\.(mp4|webm|mkv|mov|avi|flv|m4v|m3u8|mpd|ts)(\?|#|$)/i;

    // ─── 1. Find <video> elements (including inside Shadow DOM) ───
    const videos = querySelectorAllDeep('video');
    for (const v of videos) {
      [v.src, v.currentSrc].forEach(src => {
        if (src && isValid(src) && !detected.has(src)) {
          detected.add(src);
          found.push({ url: src, type: getType(src), duration: v.duration || 0, width: v.videoWidth || 0, height: v.videoHeight || 0 });
        }
      });
      // Check <source> children
      v.querySelectorAll('source').forEach(s => {
        if (s.src && isValid(s.src) && !detected.has(s.src)) {
          detected.add(s.src);
          found.push({ url: s.src, type: getType(s.src), duration: v.duration || 0, width: v.videoWidth || 0, height: v.videoHeight || 0 });
        }
      });
    }

    // ─── 2. Detect Mux Player (<mux-player>, <mux-video>) ───
    const muxPlayers = querySelectorAllDeep('mux-player');
    for (const mp of muxPlayers) {
      // Try to get playback-id and construct the M3U8 URL
      const playbackId = mp.getAttribute('playback-id');
      const directSrc = mp.getAttribute('src');
      
      let m3u8Url = '';
      if (directSrc && directSrc.includes('.m3u8')) {
        m3u8Url = directSrc;
      } else if (playbackId) {
        m3u8Url = `https://stream.mux.com/${playbackId}.m3u8?redundant_streams=true`;
      }

      if (m3u8Url && !detected.has(m3u8Url)) {
        detected.add(m3u8Url);
        found.push({
          url: m3u8Url,
          type: 'M3U8',
          duration: 0,
          width: 0,
          height: 0
        });
      }
    }

    // Also check <mux-video> elements directly
    const muxVideos = querySelectorAllDeep('mux-video');
    for (const mv of muxVideos) {
      const src = mv.getAttribute('src');
      if (src && isValid(src) && !detected.has(src)) {
        detected.add(src);
        found.push({ url: src, type: getType(src) });
      }
      const playbackId = mv.getAttribute('playback-id');
      if (playbackId) {
        const m3u8Url = `https://stream.mux.com/${playbackId}.m3u8?redundant_streams=true`;
        if (!detected.has(m3u8Url)) {
          detected.add(m3u8Url);
          found.push({ url: m3u8Url, type: 'M3U8' });
        }
      }
    }

    // ─── 3. Detect other common web component video players ───
    // Wistia, Vidyard, JWPlayer, etc. — check for known patterns
    const allEls = getAllElementsDeep();
    for (const el of allEls) {
      const tagName = el.tagName?.toLowerCase() || '';
      
      // Video.js players
      if (tagName === 'video-js' || el.classList?.contains('video-js')) {
        const innerVideo = el.querySelector('video') || el.shadowRoot?.querySelector('video');
        if (innerVideo) {
          const src = innerVideo.src || innerVideo.currentSrc;
          if (src && isValid(src) && !detected.has(src)) {
            detected.add(src);
            found.push({ url: src, type: getType(src), duration: innerVideo.duration || 0, width: innerVideo.videoWidth || 0, height: innerVideo.videoHeight || 0 });
          }
        }
      }

      // Check data-src attributes on video containers
      const dataSrc = el.getAttribute('data-src') || el.getAttribute('data-video-src') || el.getAttribute('data-video-url');
      if (dataSrc && isValid(dataSrc) && videoPat.test(dataSrc) && !detected.has(dataSrc)) {
        detected.add(dataSrc);
        found.push({ url: dataSrc, type: getType(dataSrc) });
      }
    }

    // ─── 4. Standalone <source> elements ───
    const sources = querySelectorAllDeep('source');
    for (const s of sources) {
      if (s.src && isValid(s.src) && !detected.has(s.src) && videoPat.test(s.src)) {
        detected.add(s.src);
        found.push({ url: s.src, type: getType(s.src) });
      }
    }

    // ─── 5. <embed> and <object> ───
    const embeds = querySelectorAllDeep('embed[src], object[data]');
    for (const el of embeds) {
      const u = el.src || el.getAttribute('data');
      if (u && isValid(u) && !detected.has(u) && videoPat.test(u)) {
        detected.add(u);
        found.push({ url: u, type: getType(u) });
      }
    }

    // ─── 6. <a> links to video files ───
    document.querySelectorAll('a[href]').forEach(a => {
      if (a.href && isValid(a.href) && !detected.has(a.href) && videoPat.test(a.href)) {
        detected.add(a.href);
        found.push({ url: a.href, type: getType(a.href) });
      }
    });

    // ─── 7. Scan page source for M3U8 URLs in scripts/attributes ───
    try {
      const html = document.documentElement.innerHTML;
      // Find M3U8 URLs in page source
      const m3u8Regex = /https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi;
      let match;
      while ((match = m3u8Regex.exec(html)) !== null) {
        const url = match[0].replace(/[\\'"]/g, '');
        if (isValid(url) && !detected.has(url)) {
          detected.add(url);
          found.push({ url, type: 'M3U8' });
        }
      }

      // Find MP4 URLs in page source
      const mp4Regex = /https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/gi;
      while ((match = mp4Regex.exec(html)) !== null) {
        const url = match[0].replace(/[\\'"]/g, '');
        if (isValid(url) && !detected.has(url)) {
          detected.add(url);
          found.push({ url, type: 'MP4' });
        }
      }

      // Find Mux playback IDs in page source (pattern: playback-id="XXXXX")
      const muxIdRegex = /playback-id=["']([a-zA-Z0-9]+)["']/gi;
      while ((match = muxIdRegex.exec(html)) !== null) {
        const playbackId = match[1];
        const m3u8Url = `https://stream.mux.com/${playbackId}.m3u8?redundant_streams=true`;
        if (!detected.has(m3u8Url)) {
          detected.add(m3u8Url);
          found.push({ url: m3u8Url, type: 'M3U8' });
        }
      }
    } catch (e) {
      // Ignore errors from source scanning
    }

    return found;
  }

  // Initial scan
  send(scan());

  // Watch DOM for dynamic content (including shadow roots being attached)
  new MutationObserver(() => {
    const v = scan();
    if (v.length) send(v);
  }).observe(document.documentElement, { childList: true, subtree: true });

  // Re-scan periodically for lazy-loaded / dynamically created players
  let scanCount = 0;
  const scanInterval = setInterval(() => {
    const v = scan();
    if (v.length) send(v);
    scanCount++;
    if (scanCount >= 10) clearInterval(scanInterval); // Stop after ~10 seconds
  }, 1000);

  // Intercept fetch
  const _fetch = window.fetch;
  window.fetch = function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    if (url && /\.(mp4|webm|m3u8|mpd|ts)(\?|#|$)/i.test(url) && isValid(url) && !detected.has(url)) {
      detected.add(url);
      send([{ url, type: getType(url) }]);
    }
    return _fetch.apply(this, args);
  };

  // Intercept XHR
  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    if (url && typeof url === 'string' && /\.(mp4|webm|m3u8|mpd|ts)(\?|#|$)/i.test(url) && isValid(url) && !detected.has(url)) {
      detected.add(url);
      send([{ url, type: getType(url) }]);
    }
    return _open.call(this, method, url, ...rest);
  };

})();
