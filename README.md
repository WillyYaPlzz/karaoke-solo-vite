# Karaoke Solo (Vite + React + Tailwind)

**What it does**
- Mic capture and real-time pitch detection (autocorrelation).
- Lyrics highlighting from a song map JSON (no copyrighted content included).
- Per-note scoring (pitch, timing, sustain, vibrato) + final score.
- Local highscores, transpose ±6 semitones.
- JSON editor to paste your own song map.

**Run it**

```bash
npm install
npm run dev
# open the printed localhost URL
```

> iOS/Safari requires a user gesture before mic can be accessed. Click **Enable Mic** first.

**Song map format** (example included in the UI). You need `lyrics[]` and `notes[]` with seconds and MIDI numbers.


---

## One-time GitHub drag‑and‑drop deployment

1) Create a new **public** GitHub repo.
2) Drag and drop **all files from this folder** (including `.github/workflows/deploy.yml`) into the repo and commit to **main**.
3) Wait for the **Deploy to GitHub Pages** workflow to finish (Actions tab).
4) Open **Settings → Pages** and ensure the source is **GitHub Actions**. Your site will be live at:
   `https://<username>.github.io/<repo-name>/`

Notes:
- The workflow builds with the correct base path automatically (`/${repo-name}/`), so you don't need to edit any files.
- Microphone requires HTTPS and a user gesture: click **Enable Mic** first, then **Start**.
