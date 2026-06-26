// Service worker. Handles clicks on the toolbar icon by sending a message
// to the YouTube tab's content script and surfacing the result via a badge.

const COLOR_OK = '#1b5e20';
const COLOR_ERR = '#a40000';
const COLOR_BUSY = '#1a3d80';
const BADGE_CLEAR_MS = 4000;

function setBadge(tabId, text, color, title) {
  if (tabId == null) return;
  chrome.action.setBadgeText({ tabId, text: text || '' });
  if (color) chrome.action.setBadgeBackgroundColor({ tabId, color });
  if (title) chrome.action.setTitle({ tabId, title });
}

function scheduleClear(tabId, delay) {
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: '' });
    chrome.action.setTitle({ tabId, title: 'Copy YouTube transcript' });
  }, delay);
}

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch (_) {
    // Already injected, or page disallows injection. Either way, the
    // sendMessage below will tell us if there's a real problem.
  }
}

// Right-click the toolbar icon → "Settings" to open the options panel as an
// overlay over the current YouTube page. Off YouTube (where we can't inject),
// fall back to the standalone options tab.
const OPTIONS_MENU_ID = 'open-options';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: OPTIONS_MENU_ID,
    title: 'Settings',
    contexts: ['action'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== OPTIONS_MENU_ID) return;
  const onYouTube = tab && tab.id && /^https:\/\/www\.youtube\.com\//.test(tab.url || '');
  if (onYouTube) {
    try {
      await ensureContentScript(tab.id);
      await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_OPTIONS_OVERLAY' });
      return;
    } catch (_) {
      // Fall through to the options tab.
    }
  }
  chrome.runtime.openOptionsPage();
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  const url = tab.url || '';
  if (!/^https:\/\/www\.youtube\.com\/watch/.test(url)) {
    setBadge(tab.id, '!', COLOR_ERR, 'Open a YouTube video first');
    scheduleClear(tab.id, BADGE_CLEAR_MS);
    return;
  }

  setBadge(tab.id, '…', COLOR_BUSY, 'Extracting transcript…');

  try {
    await ensureContentScript(tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_AND_COPY' });
    if (response && response.ok) {
      setBadge(tab.id, '✓', COLOR_OK, `Copied ${response.segments} segments to clipboard`);
    } else {
      const msg = (response && response.error) || 'Failed to extract';
      setBadge(tab.id, '!', COLOR_ERR, msg);
    }
  } catch (err) {
    setBadge(tab.id, '!', COLOR_ERR, (err && err.message) || String(err));
  } finally {
    scheduleClear(tab.id, BADGE_CLEAR_MS);
  }
});
