# TestLyric Studio

A modern, local-first songwriting workbench that runs as a static site and deploys cleanly to Vercel.

## Run locally

```bash
python3 -m http.server 3000
```

Then open `http://localhost:3000`.

## Deploy to Vercel

- Framework preset: **Other**
- Build command: *(empty)*
- Output directory: `.`

## What works now

- Modern two-column writing UI with a lyric editor, inspector, pill-mode controls, dark mode, focus mode, and learn mode.
- Local song intelligence: section detection, line stats, syllable estimates, rhymes, wordplay ideas, cliché warnings, filler warnings, repeated image tracking, and structure summaries.
- Line-aware actions: click or highlight text and every tool uses that exact selection or line instead of blindly using the last line.
- Safer AI workflow: every request includes a guardrail telling AI not to change words without asking, then TestLyric shows a visual review before any edit can be applied.
- Review choices: replace the selection, insert the suggestion below while keeping the original, copy the suggestion, or keep the original untouched.
- Provider support: Local fallback, OpenAI, Claude, and DeepSeek browser requests using session-only keys.
- Privacy: API keys are stored only in JavaScript memory for the current tab. They are not saved to IndexedDB, localStorage, exports, or version history.
- Version history: autosaves and applied AI edits are kept in local version snapshots with a restore action.

## DeepSeek notes

DeepSeek works through the OpenAI-compatible `https://api.deepseek.com` endpoint. The default model is `deepseek-v4-flash`; you can switch to `deepseek-v4-pro` in the model field.
