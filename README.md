# TestLyric MVP

Minimal songwriting notebook designed for Vercel static hosting.

## Run locally

```bash
python3 -m http.server 3000
```

## Deploy to Vercel

1. Push this repository to GitHub.
2. In Vercel, import the repo.
3. Framework preset: **Other**.
4. Build command: *(leave empty)*.
5. Output directory: `.`
6. Deploy.

## Features in this MVP

- Quiet single-screen editor (title + lyrics + suggestion strip)
- Burger menu for structure tools, versions, export/import, AI mode settings
- Local section detection (verse/chorus/pre-chorus/bridge/hook/outro)
- Local rhymes / near-rhymes / cliche detection / repetition hints
- IndexedDB song memory + autosave + manual save
- Manual AI tool simulations with caching (line improve, chorus generation, wordplay, double meanings)
- Version history snapshots
