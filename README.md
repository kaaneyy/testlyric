# TestLyric MVP

A modern, local-first songwriting editor deployable to Vercel.

## Run locally

```bash
python3 -m http.server 3000
```

## Deploy to Vercel

- Framework: Other
- Build command: none
- Output directory: .

## New UX updates

- Modern UI refresh with pill buttons (dark mode, focus mode, learn mode)
- Better accessibility (ARIA labels, live regions, clearer tips)
- Line-aware editing: AI tools apply to selected line, not always last line
- Pre-request AI confirmation prompt: “do not change any words without asking”
- Visual review diff panel with choices:
  - Replace selected line
  - Insert new line below and keep old line
  - Keep original only
- API keys for OpenAI/Claude/DeepSeek remain in tab memory only and are not persisted
