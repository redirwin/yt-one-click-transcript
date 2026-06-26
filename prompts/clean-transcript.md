# Clean up a YouTube transcript

Copy everything in the box below into any AI chat tool (ChatGPT, Claude, Gemini, Claude Code, …), then paste the transcript you copied with **YT OneClick Transcript** where indicated and send.

---

You are cleaning up a raw transcript copied from a YouTube video. The text was machine-read from YouTube's transcript panel, so it may be auto-generated (speech recognition) and rough. Turn it into clean, readable prose **without changing the meaning**.

**The input may start with a header** of one to three lines — the video title, a `https://www.youtube.com/watch?v=…` URL, and a `Source: …` line. If present, keep it verbatim at the top of your output, then a blank line, then the cleaned transcript.

Do this:

- Remove filler words and verbal tics (um, uh, like, you know, sort of, I mean) where they add nothing.
- Remove false starts, self-corrections, and stutters ("the- the thing", "we we need"); keep the intended wording.
- Collapse accidental repetition that comes from caption timing, but keep repetition that is clearly intentional for emphasis.
- Drop teaser/cold-open intros that only preview content from the body: if the video opens with a hook or montage that repeats lines also spoken later in the transcript, remove the duplicated preview and keep the version that appears in context in the body. If the entire intro is just such a preview of later material, omit the whole intro. Keep any intro content that is genuinely unique (not repeated later).
- Remove advertising and promotional content entirely — sponsor reads and ad segments, and the creator's own plugs (like/subscribe/comment/notification reminders, merch, Patreon or channel memberships, giveaways, discount or affiliate codes, "link in the description," plugs for their other videos). Drop the whole segment, then make the surrounding text read smoothly across the gap.
- Fix obvious speech-recognition errors, including misheard homophones and wrong word boundaries, using the surrounding context. If a fix is uncertain, keep the original.
- Add natural punctuation, capitalization, and sentence breaks.
- Group sentences into readable paragraphs by topic.
- Handle multiple speakers like this:
  - If the transcript already has speaker labels, keep them and normalize to a consistent `Name:` format at the start of each turn.
  - If it has none but the speakers are clearly distinguishable, add neutral labels — `Speaker 1:`, `Speaker 2:`, etc. (or role labels like `Host:` / `Guest:` when the roles are obvious) — at each turn.
  - When a particular turn boundary or attribution is uncertain, append `(inferred)` to that label, e.g. `Speaker 2 (inferred):`.
  - Never invent a real person's name; only use a real name if it already appears as a label in the transcript.
  - If you cannot reliably tell the speakers apart, do not add labels — leave the text as continuous prose.
- If the transcript has `[mm:ss]` timestamps, keep one at the start of each paragraph (drop the rest); if it has none, don't invent any.

Do NOT do this:

- Do not summarize, shorten, paraphrase for style, or add information that isn't in the transcript. (Removing advertising and promotional content, removing teaser intros that only duplicate later content, and adding speaker labels, as described above are the only intended exceptions.)
- Do not translate; keep the original language.
- Do not add commentary, headings, or notes of your own beyond the kept header.

Output only the cleaned transcript (with the header if one was present), as plain Markdown.

--- paste the copied transcript below this line ---
