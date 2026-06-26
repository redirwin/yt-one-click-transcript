// Content script — runs on YouTube watch pages. Triggers YouTube's own
// "Show transcript" panel (which loads via the player's authenticated
// internal API), then reads the rendered cue text from the DOM.

(function () {
  // Guard against multiple injections (the manifest declares this script and
  // the service worker also injects it on click). Without this, each injection
  // registers another onMessage listener and a single click runs the whole
  // extraction several times concurrently.
  if (window.__ytOneClickTranscriptLoaded) return;
  window.__ytOneClickTranscriptLoaded = true;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitFor(predicate, timeoutMs, intervalMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const r = predicate();
      if (r) return r;
      await sleep(intervalMs);
    }
    return null;
  }

  const BRACKET_RE = /\[[^\]]+\]/g;
  function normalizeLine(s) {
    return s.replace(BRACKET_RE, ' ').replace(/\s+/g, ' ').trim();
  }
  function joinLines(lines) {
    return lines.join(' ').replace(/\s+/g, ' ').trim();
  }

  function querySelectorAllDeep(root, selector) {
    const out = new Set();
    const visit = (node) => {
      if (!node) return;
      if (node.querySelectorAll) {
        try { node.querySelectorAll(selector).forEach((el) => out.add(el)); } catch (_) {}
        try {
          node.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) visit(el.shadowRoot); });
        } catch (_) {}
      }
      if (node.shadowRoot) visit(node.shadowRoot);
    };
    visit(root);
    return Array.from(out);
  }

  function findTranscriptPanel() {
    return (
      document.querySelector(
        'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
      ) ||
      document.querySelector(
        'ytd-engagement-panel-section-list-renderer[target-id*="transcript"]',
      ) ||
      document.querySelector('[target-id*="transcript"]')
    );
  }

  function findTranscriptButton() {
    const section = document.querySelector('ytd-video-description-transcript-section-renderer');
    if (section) {
      const b = section.querySelector('button');
      if (b) return b;
    }
    const direct = document.querySelectorAll(
      'button[aria-label*="transcript" i], tp-yt-paper-button[aria-label*="transcript" i]',
    );
    for (const b of direct) {
      if (b && b.offsetParent !== null) return b;
    }
    const all = document.querySelectorAll(
      'button, tp-yt-paper-button, yt-button-shape > button, ytd-button-renderer button',
    );
    for (const b of all) {
      if (!b.offsetParent) continue;
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      const text = (b.innerText || b.textContent || '').toLowerCase().trim();
      if (label.includes('transcript') || text.includes('show transcript') || text === 'transcript') {
        return b;
      }
    }
    return null;
  }

  async function expandDescription() {
    const expanders = document.querySelectorAll(
      '#description tp-yt-paper-button#expand, ' +
        '#description #expand, ' +
        'ytd-text-inline-expander tp-yt-paper-button#expand, ' +
        'ytd-text-inline-expander #expand, ' +
        'tp-yt-paper-button#expand',
    );
    let clicked = false;
    for (const e of expanders) {
      if (e && e.offsetParent !== null) {
        try { e.click(); clicked = true; } catch (_) {}
      }
    }
    await sleep(clicked ? 400 : 100);
  }

  // Pick a single transcript panel to read from. YouTube's SPA navigation can
  // leave a previous video's panel in the DOM alongside the current one, so a
  // document-wide segment query would return both sets and the transcript would
  // be read (and copied) twice. Prefer the expanded/visible panel, otherwise the
  // first panel that actually contains segments.
  function findSegmentScope() {
    const panels = Array.from(
      document.querySelectorAll(
        'ytd-engagement-panel-section-list-renderer[target-id*="transcript"]',
      ),
    );
    if (panels.length === 0) return document;
    const expanded = panels.find(
      (p) => p.getAttribute('visibility') === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED',
    );
    if (expanded) return expanded;
    const withSegments = panels.find((p) =>
      p.querySelector('ytd-transcript-segment-renderer'),
    );
    return withSegments || panels[0];
  }

  // Distinguish auto-generated (ASR) captions from publisher-supplied ones by
  // reading the transcript panel's footer language label, which YouTube renders
  // as e.g. "English (auto-generated)" for ASR tracks. This is a text heuristic
  // and only reliable in an English UI; returns 'unknown' when it can't tell.
  function detectCaptionSource() {
    const scope = findSegmentScope();
    const footer =
      scope.querySelector && scope.querySelector('ytd-transcript-footer-renderer');
    if (!footer) return 'unknown';
    const text = (footer.textContent || '').toLowerCase();
    if (text.includes('auto-generated') || text.includes('auto generated')) {
      return 'auto-generated';
    }
    return text.trim() ? 'publisher' : 'unknown';
  }

  function findSegmentElements() {
    const scope = findSegmentScope();
    const SELECTORS = [
      'ytd-transcript-segment-renderer',
      'ytd-transcript-body-renderer ytd-transcript-segment-renderer',
    ];
    for (const sel of SELECTORS) {
      const found = scope.querySelectorAll(sel);
      if (found.length > 0) return Array.from(found);
    }
    for (const sel of SELECTORS) {
      const deep = querySelectorAllDeep(scope, sel);
      if (deep.length > 0) return deep;
    }
    return [];
  }

  const TIMESTAMP_RE = /\b(\d{1,2}:\d{2}(?::\d{2})?)\b/;
  function readSegmentTimestamp(seg) {
    const el = seg.querySelector('.segment-timestamp, [class*="segment-timestamp"]');
    const fromEl = el && (el.textContent || '').trim();
    if (fromEl) return fromEl;
    const m = (seg.textContent || '').match(TIMESTAMP_RE);
    return m ? m[1] : '';
  }

  function readTranscriptSegments(withTimestamps) {
    const segs = findSegmentElements();
    if (segs.length === 0) return [];
    const TEXT_SELECTORS = [
      'yt-formatted-string.segment-text',
      '.segment-text',
      '[class*="segment-text"]',
      'yt-formatted-string',
    ];
    const lines = [];
    for (const seg of segs) {
      let raw = null;
      for (const ts of TEXT_SELECTORS) {
        const el = seg.querySelector(ts);
        if (el && (el.textContent || '').trim()) {
          raw = el.textContent;
          break;
        }
      }
      if (!raw) {
        raw = (seg.textContent || '').replace(/^\s*\d{1,2}:\d{2}(?::\d{2})?\s*/, '');
      }
      const line = normalizeLine(raw);
      if (!line) continue;
      if (withTimestamps) {
        const time = readSegmentTimestamp(seg);
        lines.push(time ? `[${time}] ${line}` : line);
      } else {
        lines.push(line);
      }
    }
    return lines;
  }

  async function extractTranscript(withTimestamps) {
    // Already rendered (user opened the panel themselves)? Just read it.
    {
      const existing = readTranscriptSegments(withTimestamps);
      if (existing.length > 0) return existing;
    }

    let panel = findTranscriptPanel();
    const wasVisible =
      !!panel && panel.getAttribute('visibility') === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED';
    const prevScroll = { x: window.scrollX, y: window.scrollY };

    try {
      await expandDescription();

      const btn = findTranscriptButton() || (await waitFor(findTranscriptButton, 2000, 100));
      if (!btn && !panel) {
        throw new Error('This video has no transcript available');
      }

      if (btn) {
        try { btn.scrollIntoView({ block: 'center' }); } catch (_) {}
        try { btn.click(); } catch (_) {}
      }

      if (!panel) panel = await waitFor(findTranscriptPanel, 1500, 100);
      if (panel) {
        try { panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED'); } catch (_) {}
      }

      const got = await waitFor(() => {
        const r = findSegmentElements();
        return r.length > 0 ? r : null;
      }, 12000, 150);

      if (!got) {
        throw new Error('Transcript did not load. Open it manually once, then try again.');
      }

      // Wait for the segment count to stabilize.
      let prev = got.length;
      for (let i = 0; i < 25; i++) {
        await sleep(150);
        const cur = findSegmentElements().length;
        if (cur === prev) break;
        prev = cur;
      }

      const lines = readTranscriptSegments(withTimestamps);
      if (lines.length === 0) {
        throw new Error('Transcript loaded but text could not be read');
      }
      return lines;
    } finally {
      if (panel && !wasVisible) {
        try { panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN'); } catch (_) {}
      }
      try { window.scrollTo(prevScroll.x, prevScroll.y); } catch (_) {}
    }
  }

  function getTitle() {
    return (document.title || '').replace(/\s*-\s*YouTube\s*$/, '').trim();
  }

  // A canonical watch URL with just the video id — drops playlist, timestamp,
  // and tracking params that ride along in location.href.
  function getVideoUrl() {
    try {
      const id = new URL(location.href).searchParams.get('v');
      if (id) return `https://www.youtube.com/watch?v=${id}`;
    } catch (_) {}
    return location.href;
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {}
    }
    // execCommand fallback — works in some contexts where the async API
    // refuses without a user-activation chain.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-100000px;top:-100000px;opacity:0;';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }

  const DEFAULT_SETTINGS = {
    includeTimestamps: true,
    includeTitle: true,
    includeUrl: true,
    includePrompt: false,
  };

  const TRANSCRIPT_SEPARATOR = '--- Below is the copied transcript ---';

  // The transcript-cleanup prompt, read from the packaged markdown file so it
  // stays a single source of truth. We use the prompt body — everything after
  // the first standalone "---" line — and drop its trailing "paste the
  // transcript below this line" marker, since the bundle adds its own separator.
  async function getPromptPreamble() {
    try {
      const res = await fetch(chrome.runtime.getURL('prompts/clean-transcript.md'));
      const md = await res.text();
      const idx = md.indexOf('\n---\n');
      const body = idx >= 0 ? md.slice(idx + 5) : md;
      return body.trim().replace(/\s*\n+---[^\n]*paste[^\n]*$/i, '').trim();
    } catch (_) {
      return '';
    }
  }

  async function getSettings() {
    try {
      return await chrome.storage.sync.get(DEFAULT_SETTINGS);
    } catch (_) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  async function extractAndCopy() {
    const isWatch = /^https:\/\/www\.youtube\.com\/watch/.test(location.href);
    if (!isWatch) throw new Error('Open a YouTube video first');

    const { includeTimestamps, includeTitle, includeUrl, includePrompt } = await getSettings();
    const lines = await extractTranscript(includeTimestamps);
    // With timestamps each cue is its own line; without, it's one prose block.
    const body = includeTimestamps ? lines.join('\n') : joinLines(lines);

    const source = detectCaptionSource();
    const sourceLabel =
      source === 'auto-generated'
        ? 'auto-generated'
        : source === 'publisher'
          ? 'publisher-supplied'
          : '';

    const title = getTitle();
    const headerLines = [];
    if (includeTitle && title) headerLines.push(title);
    if (includeUrl) headerLines.push(getVideoUrl());
    if (sourceLabel) headerLines.push(`Source: ${sourceLabel}`);
    let text = headerLines.length ? `${headerLines.join('\n')}\n\n${body}` : body;

    if (includePrompt) {
      const preamble = await getPromptPreamble();
      if (preamble) text = `${preamble}\n\n${TRANSCRIPT_SEPARATOR}\n\n${text}`;
    }

    const copied = await copyToClipboard(text);
    if (!copied) throw new Error('Extracted but failed to write to clipboard');

    return { ok: true, title: getTitle(), segments: lines.length, source };
  }

  // Floating settings panel: an iframe of the extension's own options page,
  // shown over the current YouTube page so the user never leaves the video.
  // Triggered from the toolbar icon's right-click menu (handled in background.js).
  const OVERLAY_ID = 'ytc-options-overlay';
  const OPTIONS_ORIGIN = new URL(chrome.runtime.getURL('options.html')).origin;
  let overlayFrame = null;

  function closeOptionsOverlay() {
    const el = document.getElementById(OVERLAY_ID);
    if (el) el.remove();
    overlayFrame = null;
    window.removeEventListener('keydown', onOverlayKeydown, true);
    window.removeEventListener('message', onOverlayMessage);
  }

  function onOverlayKeydown(e) {
    if (e.key === 'Escape') closeOptionsOverlay();
  }

  // The options page (running inside the iframe) posts its own content height so
  // the iframe can be sized to fit exactly — no scrollbar — and a close request
  // when the user clicks Done.
  function onOverlayMessage(e) {
    if (!overlayFrame || e.source !== overlayFrame.contentWindow) return;
    if (e.origin !== OPTIONS_ORIGIN) return;
    const data = e.data || {};
    if (data.type === 'ytc-options-close') {
      closeOptionsOverlay();
    } else if (data.type === 'ytc-options-height' && typeof data.height === 'number') {
      const max = Math.min(600, Math.floor(window.innerHeight * 0.9));
      overlayFrame.style.height = Math.max(0, Math.min(data.height, max)) + 'px';
    }
  }

  function showOptionsOverlay() {
    // Toggle: a second trigger while open dismisses it.
    if (document.getElementById(OVERLAY_ID)) {
      closeOptionsOverlay();
      return;
    }

    const backdrop = document.createElement('div');
    backdrop.id = OVERLAY_ID;
    backdrop.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.5);' +
      'display:flex;align-items:center;justify-content:center;';
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeOptionsOverlay();
    });

    const frame = document.createElement('iframe');
    frame.src = chrome.runtime.getURL('options.html');
    // Height starts as a sensible guess and is corrected to the exact content
    // height as soon as the page reports it.
    frame.style.cssText =
      'width:560px;max-width:92vw;height:320px;max-height:min(90vh,600px);border:0;' +
      'border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,0.35);background:#fff;';

    overlayFrame = frame;
    backdrop.appendChild(frame);
    document.body.appendChild(backdrop);
    window.addEventListener('keydown', onOverlayKeydown, true);
    window.addEventListener('message', onOverlayMessage);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === 'OPEN_OPTIONS_OVERLAY') {
      showOptionsOverlay();
      return;
    }
    if (msg.type !== 'EXTRACT_AND_COPY') return;
    extractAndCopy()
      .then((payload) => sendResponse(payload))
      .catch((err) => {
        console.warn('[YT OneClick Transcript] extract failed:', err);
        sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
      });
    return true;
  });
})();
