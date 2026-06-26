// Content script — runs on YouTube watch pages. Triggers YouTube's own
// "Show transcript" panel (which loads via the player's authenticated
// internal API), then reads the rendered cue text from the DOM.

(function () {
  // Guard against multiple injections (the manifest declares this script and
  // the service worker also injects it on click). Without this, each injection
  // registers another onMessage listener and a single click runs the whole
  // extraction several times concurrently.
  if (window.__ytTranscriptExtractorLoaded) return;
  window.__ytTranscriptExtractorLoaded = true;

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

  function readTranscriptSegments() {
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
      if (line) lines.push(line);
    }
    return lines;
  }

  async function extractTranscript() {
    // Already rendered (user opened the panel themselves)? Just read it.
    {
      const existing = readTranscriptSegments();
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

      const lines = readTranscriptSegments();
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

  async function extractAndCopy() {
    const isWatch = /^https:\/\/www\.youtube\.com\/watch/.test(location.href);
    if (!isWatch) throw new Error('Open a YouTube video first');

    const lines = await extractTranscript();
    const text = joinLines(lines);
    const copied = await copyToClipboard(text);
    if (!copied) throw new Error('Extracted but failed to write to clipboard');

    return { ok: true, title: getTitle(), segments: lines.length };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== 'EXTRACT_AND_COPY') return;
    extractAndCopy()
      .then((payload) => sendResponse(payload))
      .catch((err) => {
        console.warn('[YT Transcript] extract failed:', err);
        sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
      });
    return true;
  });
})();
