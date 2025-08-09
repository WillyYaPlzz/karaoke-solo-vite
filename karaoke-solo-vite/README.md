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
