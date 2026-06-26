# YT OneClick Transcript

A small Chrome extension (Manifest V3) that copies a YouTube video's transcript to your clipboard with one click of the toolbar icon: just click and paste.

## How it works

The extension drives YouTube's own UI rather than scraping a private API:

1. Click the toolbar icon while on a `youtube.com/watch` page.
2. The content script expands the description, clicks **Show transcript**, and waits for the transcript panel to render and stabilize.
3. It reads the cue text, strips `[bracketed]` annotations (e.g. `[Music]`), joins it into a single block, and copies it to the clipboard.
4. The toolbar badge reports the result:
   - `…` (blue) — extracting
   - `✓` (green) — copied, with the segment count in the tooltip
   - `!` (red) — error, with the reason in the tooltip

The panel's visibility and your scroll position are restored when extraction finishes.

## Use cases

Having the transcript as plain text — rather than scrubbing the video — makes a range of tasks faster:

- **Summarize with an AI assistant.** Paste a long talk, lecture, or podcast into ChatGPT/Claude and ask for a summary, outline, or key takeaways instead of watching the whole thing.
- **Search and skim.** `Ctrl+F` the transcript to find exactly where a topic is discussed, then jump back to that moment in the video.
- **Take study notes.** Capture the spoken content of a recorded lecture, tutorial, or conference talk to annotate and keep.
- **Quote accurately.** Pull exact wording for articles, reviews, research, or reaction/commentary content without mishearing.
- **Translate.** Drop the text into a translation tool to read along in another language.
- **Accessibility.** Read at your own pace instead of relying on on-screen captions, or feed the text to a screen reader.
- **Repurpose content.** Creators can turn a video's spoken content into a blog post, show notes, social captions, or chapter markers.
- **Create Artifacts.** Feed the transcripts to an AI assistant to create study guides, summaries, or other useful tools based on the source video.

## Installation

This extension is unpacked (not on the Chrome Web Store):

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this project folder.
4. Pin the extension so the toolbar icon is visible.

After editing any source file, return to `chrome://extensions` and click the reload icon on the extension card to pick up the changes.

## Usage

1. Open a YouTube video that has a transcript available.
2. Click the toolbar icon.
3. Paste the transcript wherever you need it.

If a video has no transcript, the badge shows `!` with an explanatory tooltip.

## Timestamps

By default each cue is copied on its own line, prefixed with its timestamp:

```
[0:00] Welcome back to the channel
[0:12] Today we're talking about...
```

To copy clean prose instead (one continuous block, no times), turn timestamps off in the settings (see [Settings](#settings)). The preference is saved and synced across your Chrome profile.

## Header

Each copied transcript is prefixed with a short header — the video title, a clean watch URL, and (when it can be determined) the caption source — followed by a blank line:

```
Rick Astley - Never Gonna Give You Up
https://www.youtube.com/watch?v=dQw4w9WgXcQ
Source: auto-generated

[0:00] Welcome back to the channel
```

The URL is canonicalized to just the video id, dropping any playlist, timestamp, or tracking parameters. The caption source is read from the transcript panel's footer language label (auto-generated tracks show as e.g. "English (auto-generated)") — a text heuristic that only works reliably in an **English YouTube UI**; when the source can't be determined, that line is omitted.

The **title** and **URL** lines can each be turned off in the settings, alongside the timestamp toggle. With all of them off, only the bare transcript is copied.

## Settings

Four toggles control what's copied: **Include timestamps**, **Include video title**, and **Include video URL** (all on by default), plus **Include cleanup prompt** (off by default — see [Cleaning up transcripts](#cleaning-up-transcripts)). They're saved and synced across your Chrome profile.

Open them by **right-clicking the toolbar icon → Settings**, which shows the panel as an overlay right on the YouTube page so you never leave the video. (Off YouTube — or via Chrome's built-in **Options** entry — the same settings open in a standalone tab instead.)

## Cleaning up transcripts

Auto-generated transcripts are rough — no punctuation, filler words, and the occasional misheard word. The repo ships a ready-made prompt for tidying them up with an AI assistant: [`prompts/clean-transcript.md`](prompts/clean-transcript.md).

Copy the prompt, paste it into any AI chat tool (ChatGPT, Claude, Gemini, Claude Code, …), paste your copied transcript below it, and send. It punctuates, removes filler and false starts, fixes obvious speech-recognition errors, and paragraphs the text — without summarizing or changing meaning. It also preserves the title/URL/source header and any `[mm:ss]` timestamps.

To skip the copy-and-paste step, turn on **Include cleanup prompt** in the [settings](#settings): the extension then prepends this same prompt above every copied transcript, so you can paste the whole bundle straight into a chat tool and send. (It reads the prompt from `prompts/clean-transcript.md`, so edits there flow through automatically.)

## Files

| File                          | Purpose                                                                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `manifest.json`               | Extension manifest (MV3): permissions, icons, content-script registration.                                                         |
| `background.js`               | Service worker — handles toolbar clicks and the icon's right-click menu, messages the content script, and drives the status badge. |
| `content.js`                  | Runs on watch pages — opens the transcript panel, reads the segments, copies the text, and shows the in-page settings overlay.     |
| `options.html` / `options.js` | Settings UI — toggles for timestamps, title, and URL (shown as an in-page overlay or in a tab).                                    |
| `prompts/clean-transcript.md` | Portable AI prompt for cleaning up a copied transcript.                                                                            |
| `icon-16/48/128.png`          | Toolbar and extension icons.                                                                                                       |

## Permissions

| Permission                      | Why                                              |
| ------------------------------- | ------------------------------------------------ |
| `activeTab`                     | Act on the current tab when the icon is clicked. |
| `scripting`                     | Inject the content script on demand.             |
| `clipboardWrite`                | Write the transcript to the clipboard.           |
| `storage`                       | Remember the header/format preferences.          |
| `contextMenus`                  | Add the icon's right-click **Settings** entry.   |
| `host_permissions: youtube.com` | Read the transcript from YouTube watch pages.    |

## Limitations

- Works only on standard watch pages (`https://www.youtube.com/watch*`).
- Requires the video to have a transcript (auto-generated or uploaded).
- Relies on YouTube's DOM structure; layered selectors and timeouts make it resilient, but a major YouTube redesign may require selector updates.
