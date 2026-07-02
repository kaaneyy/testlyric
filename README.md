# TestLyric Studio

A modern, local-first songwriting workbench that runs as a static site and deploys cleanly to Vercel.

## Deploy to Vercel

- Framework preset: **Other**
- Build command: *(empty)*
- Output directory: `.`

## What works now

- One-screen 16:9 studio shell with three fixed sections: 44% lyric input, 40% AI suggestion version, and 16% compact tool controls.
- On open, TestLyric asks for an AI key first: pick a provider, paste a session-only key, or continue with the local mock. The same **AI key setup** is reachable anytime from Settings.
- The middle **AI suggestions** panel can be popped out into a full-screen overlay (Pop out) and docked back into the grid (Dock panel) without losing the current proposal.
- The page itself stays fixed, while the lyric editor, action rail, suggestion boxes, settings, detail boxes, and popup readers can scroll internally when needed.
- A highlighted **Initial analysis** first-step button for full-song editing.
- Song information appears directly under Initial analysis with live line, section, warning, and analysis status counts.
- When lyrics are pasted, imported, or restored, TestLyric prompts the writer to click Initial analysis before editing.
- Initial analysis maps structure, hook strength, weak spots, rhyme palette, filler/cliche warnings, and editing priorities.
- Initial analysis now opens a card popup that separates what was found from what is suggested.
- The middle AI panel includes a **Large view** button for reading the current proposal or analysis cards with more screen area.
- Small pill-shaped controls across local tools, AI tools, song actions, settings, and review actions.
- Modern writing UI with dark mode, focus mode, session settings, and compact song metadata controls.
- Local song intelligence: section detection, line stats, syllable estimates, rhymes, wordplay ideas, cliche warnings, filler warnings, repeated image tracking, and structure summaries.
- Line-aware actions: click or highlight text and line-specific tools use that exact selection or line instead of blindly using the last line.
- Whole-song AI actions: structure review, full-song review, initial analysis, and chorus generation send the full song text plus compressed song memory to the AI.
- Safer AI workflow: every request includes a guardrail telling AI not to change words without asking, and to make the smallest possible adjustment that improves the song while preserving the raw, human-written voice. TestLyric then shows a visual review before any edit can be applied.
- Structured AI review: the original lyric and AI version appear in the middle panel, with detail notes available through the popup flow.
- Waiting indicator: the top status and centered modal clearly show when TestLyric is waiting for an AI response.
- Review choices: replace the selection, insert the suggestion below while keeping the original, copy the suggestion, or keep the original untouched.
- Provider support: Local fallback, OpenAI, Claude, and DeepSeek browser requests using session-only keys.
- Privacy: API keys are stored only in JavaScript memory for the current tab. They are not saved to IndexedDB, localStorage, exports, or version history.
- Version history: autosaves and applied AI edits are kept in local version snapshots with a restore action.

## DeepSeek notes

DeepSeek works through the OpenAI-compatible `https://api.deepseek.com` endpoint. The default model is `deepseek-v4-flash`; you can switch to `deepseek-v4-pro` in the model field.
