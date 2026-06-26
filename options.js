// Options page — persists header/format preferences to chrome.storage.sync.
// Each key defaults to true (timestamps, title, and URL all shown) when nothing
// is stored yet. When shown as an in-page overlay (inside an iframe) it also
// reports its height so the frame fits without scrolling, and offers a Done
// button to dismiss itself.

const DEFAULTS = {
  includeTimestamps: true,
  includeTitle: true,
  includeUrl: true,
};

const embedded = window.top !== window.self;
const status = document.getElementById('status');

let statusTimer = null;
function flash(message) {
  status.textContent = message;
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    status.textContent = '';
  }, 1500);
}

function postHeight() {
  const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
  window.parent.postMessage({ type: 'ytc-options-height', height }, '*');
}

async function load() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  for (const key of Object.keys(DEFAULTS)) {
    const box = document.getElementById(key);
    if (!box) continue;
    box.checked = stored[key];
    box.addEventListener('change', async () => {
      await chrome.storage.sync.set({ [key]: box.checked });
      flash('Saved');
    });
  }
}

if (embedded) {
  document.body.classList.add('embedded');
  document.getElementById('close').addEventListener('click', () => {
    window.parent.postMessage({ type: 'ytc-options-close' }, '*');
  });
  // Report height now and whenever the content reflows.
  requestAnimationFrame(postHeight);
  window.addEventListener('load', postHeight);
  if (window.ResizeObserver) {
    new ResizeObserver(postHeight).observe(document.body);
  }
}

load();
