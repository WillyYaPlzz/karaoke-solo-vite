import React, { useEffect, useRef, useState } from "react";

// ---------- Demo Song Map (you can replace via UI) ----------
const DEMO_MAP = {
  id: "demo-twinkle",
  title: "Demo Song",
  bpm: 100,
  key: "C",
  lyrics: [
    { t: 0.00, text: "Twin-" },
    { t: 0.50, text: "kle" },
    { t: 1.00, text: "twin-" },
    { t: 1.50, text: "kle" },
    { t: 2.10, text: "lit-" },
    { t: 2.60, text: "tle" },
    { t: 3.10, text: "star" },
  ],
  notes: [
    { t0: 0.00, t1: 0.50, midi: 60, expectVibrato: false, lyricIndex0: 0, lyricIndex1: 0 },
    { t0: 0.50, t1: 1.00, midi: 60, expectVibrato: false, lyricIndex0: 1, lyricIndex1: 1 },
    { t0: 1.00, t1: 1.50, midi: 67, expectVibrato: false, lyricIndex0: 2, lyricIndex1: 2 },
    { t0: 1.50, t1: 2.10, midi: 67, expectVibrato: false, lyricIndex0: 3, lyricIndex1: 3 },
    { t0: 2.10, t1: 2.60, midi: 69, expectVibrato: false, lyricIndex0: 4, lyricIndex1: 4 },
    { t0: 2.60, t1: 3.10, midi: 69, expectVibrato: false, lyricIndex0: 5, lyricIndex1: 5 },
    { t0: 3.10, t1: 4.00, midi: 67, expectVibrato: true,  lyricIndex0: 6, lyricIndex1: 6 },
  ],
};

// ---------- DSP Utilities ----------
const hzToMidi = (hz) => 69 + 12 * Math.log2(hz / 440);
const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const centsBetween = (hz, refHz) => 1200 * Math.log2(hz / refHz);

function autoCorrelatePitch(buf, sampleRate) {
  let SIZE = buf.length;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.008) return { f0: 0, conf: 0 };

  let r = new Float32Array(SIZE);
  for (let lag = 0; lag < SIZE; lag++) {
    let sum = 0;
    for (let i = 0; i < SIZE - lag; i++) sum += buf[i] * buf[i + lag];
    r[lag] = sum;
  }
  let pos = 0;
  while (pos < SIZE - 1 && r[pos] > r[pos + 1]) pos++;
  let maxval = -1, maxpos = -1;
  for (let i = pos; i < SIZE; i++) {
    if (r[i] > maxval) { maxval = r[i]; maxpos = i; }
  }
  let T0 = maxpos;
  if (T0 <= 0) return { f0: 0, conf: 0 };
  let x1 = r[T0 - 1] || 0, x2 = r[T0] || 0, x3 = r[T0 + 1] || 0;
  let a = (x1 + x3 - 2 * x2) / 2;
  let b = (x3 - x1) / 2;
  let shift = a ? -b / (2 * a) : 0;
  let period = T0 + shift;
  let f0 = sampleRate / period;
  let conf = Math.max(0, Math.min(1, (x2 - (x1 + x3) / 2) / (x2 + 1e-6)));
  if (f0 < 50 || f0 > 1200) return { f0: 0, conf: 0 };
  return { f0, conf: conf || 0.5 };
}

function median(arr) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function dominantFreq(samples, sampleRate) {
  const N = samples.length;
  if (N < 8) return 0;
  const mean = samples.reduce((a, b) => a + b, 0) / N;
  const x = samples.map((v) => v - mean);
  for (let n = 0; n < N; n++) x[n] *= 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
  const fmin = 3, fmax = 10, steps = 60;
  let bestF = 0, bestP = 0;
  for (let k = 0; k <= steps; k++) {
    const f = fmin + (k * (fmax - fmin)) / steps;
    const w = 2 * Math.PI * f / sampleRate;
    let s0 = 0, s1 = 0, s2 = 0;
    const coeff = 2 * Math.cos(w);
    for (let n = 0; n < N; n++) {
      s0 = x[n] + coeff * s1 - s2;
      s2 = s1; s1 = s0;
    }
    const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
    if (power > bestP) { bestP = power; bestF = f; }
  }
  return bestF;
}

function movingAvg(arr, idx, radius) {
  if (radius <= 0) return arr[idx];
  const a = Math.max(0, idx - radius);
  const b = Math.min(arr.length, idx + radius + 1);
  let s = 0; for (let i = a; i < b; i++) s += arr[i];
  return s / (b - a);
}

function scoreNote(frames, note, transposition = 0) {
  const refHz = midiToHz(note.midi + transposition);
  const inside = frames.filter((f) => f.t >= note.t0 && f.t < note.t1 && f.conf >= 0.6 && f.f0 > 0);
  const onsetFrame = frames.find((f) => f.t >= note.t0 && f.t < note.t0 + 0.6 && f.conf >= 0.6 && f.f0 > 0);
  const onsetErr = onsetFrame ? Math.abs(onsetFrame.t - note.t0) : 0.5;
  if (inside.length === 0) {
    return { pitch: 0, timing: 0, sustain: 0, vibrato: 0, total: 0 };
  }
  const centsArr = inside.map((f) => centsBetween(f.f0, refHz));
  const medCents = median(centsArr);
  const absE = Math.abs(medCents);
  const pitchScore = Math.max(0, Math.min(100, 100 * (1 - absE / 100)));

  const timingScore = onsetFrame
    ? Math.max(0, Math.min(100, 100 * (1 - Math.min(onsetErr, 0.3) / 0.3)))
    : 0;

  const within = inside.filter((f) => Math.abs(centsBetween(f.f0, refHz)) <= 50);
  const coverage = (within.length / inside.length) * 100;
  const sustainScore = Math.max(0, Math.min(100, coverage));

  let vibratoScore = 0;
  if ((note.t1 - note.t0) >= 0.6 && inside.length >= 12) {
    const sr = inside.length / (note.t1 - note.t0);
    const detrended = centsArr.map((v, i, a) => v - movingAvg(a, i, Math.floor(sr * 0.2)));
    const f = dominantFreq(detrended, sr);
    const minC = Math.min(...detrended), maxC = Math.max(...detrended);
    const extent = (maxC - minC) / 2;
    const okRate = f >= 4.5 && f <= 7.5;
    const okExtent = extent >= 20 && extent <= 100;
    if (okRate) vibratoScore += 50;
    if (okExtent) vibratoScore += 50;
  }

  const total = 0.45 * pitchScore + 0.2 * timingScore + 0.25 * sustainScore + 0.1 * vibratoScore;
  return { pitch: pitchScore, timing: timingScore, sustain: sustainScore, vibrato: vibratoScore, total };
}

function normalizeFinalScore(raw) {
  const clamped = Math.max(0, Math.min(100, raw));
  return Math.round(0.7 * clamped + 30);
}

function saveHighscore(songId, name, score) {
  const key = `hs_${songId}`;
  const list = JSON.parse(localStorage.getItem(key) || "[]");
  list.push({ name, score, ts: Date.now() });
  list.sort((a, b) => b.score - a.score);
  localStorage.setItem(key, JSON.stringify(list.slice(0, 20)));
}
function loadHighscores(songId) {
  const key = `hs_${songId}`;
  return JSON.parse(localStorage.getItem(key) || "[]");
}

export default function App() {
  const [songMap, setSongMap] = useState(DEMO_MAP);
  const [mapEditor, setMapEditor] = useState(JSON.stringify(DEMO_MAP, null, 2));
  const [transpose, setTranspose] = useState(0);
  const [name, setName] = useState("Player");

  const [ac, setAc] = useState(null);
  const analyserRef = useRef(null);
  const micSourceRef = useRef(null);
  const bufRef = useRef(new Float32Array(2048));

  const [isMicOn, setIsMicOn] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [startTime, setStartTime] = useState(0);
  const [now, setNow] = useState(0);

  const [frames, setFrames] = useState([]);
  const [currentNoteIdx, setCurrentNoteIdx] = useState(-1);
  const [currentLyricIdx, setCurrentLyricIdx] = useState(-1);
  const [noteScores, setNoteScores] = useState([]);
  const [finalScore, setFinalScore] = useState(null);

  const highscores = loadHighscores(songMap.id);

  useEffect(() => {
    let raf;
    if (isRunning) {
      const loop = () => {
        if (!ac) return;
        const t = ac.currentTime - startTime;
        setNow(t);
        if (analyserRef.current) {
          const an = analyserRef.current;
          const buf = bufRef.current;
          an.getFloatTimeDomainData(buf);
          const { f0, conf } = autoCorrelatePitch(buf, an.context.sampleRate);
          let rms = 0; for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
          rms = Math.sqrt(rms / buf.length);
          const frame = { t, f0, conf, rms };
          setFrames((prev) => prev.length > 12000 ? [...prev.slice(-8000), frame] : [...prev, frame]);
        }
        const nIdx = songMap.notes.findIndex((n) => t >= n.t0 && t < n.t1);
        setCurrentNoteIdx(nIdx);
        const lIdx = lastIndexBefore(songMap.lyrics, t);
        setCurrentLyricIdx(lIdx);
        if (t > (songMap.notes(songMap.notes.length ? songMap.notes[songMap.notes.length-1].t1 : 0)) + 0.2) {
          stopRun();
        } else {
          raf = requestAnimationFrame(loop);
        }
      };
      raf = requestAnimationFrame(loop);
    }
    return () => cancelAnimationFrame(raf);
  }, [isRunning, ac, songMap, startTime]);

  function lastIndexBefore(arr, t) {
    let idx = -1;
    for (let i = 0; i < arr.length; i++) if (arr[i].t <= t) idx = i; else break;
    return idx;
  }

  async function initMic() {
    if (isMicOn) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const _ac = new AudioCtx();
    setAc(_ac);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
    const src = _ac.createMediaStreamSource(stream);
    micSourceRef.current = src;
    const analyser = _ac.createAnalyser();
    analyser.fftSize = 2048;
    analyserRef.current = analyser;
    src.connect(analyser);
    setIsMicOn(true);
  }

  function scheduleClicks(ctx, t0, map) {
    const click = (when) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 1000;
      g.gain.value = 0.0001;
      o.connect(g).connect(ctx.destination);
      o.start(when);
      o.stop(when + 0.05);
    };
    const end = (map.notes(songMap.notes.length ? songMap.notes[songMap.notes.length-1].t1 : 0)) + t0;
    for (let t = t0 - 0.6; t < end; t += 0.5) click(t);
  }

  function startRun() {
    if (!ac) return;
    setFrames([]);
    setNoteScores([]);
    setFinalScore(null);
    const t0 = ac.currentTime + 0.8;
    setStartTime(t0);
    setIsRunning(true);
    scheduleClicks(ac, t0, songMap);
  }

  function stopRun() {
    setIsRunning(false);
    const scores = songMap.notes.map((n) => scoreNote(frames, n, transpose));
    setNoteScores(scores);
    const raw = scores.reduce((a, b) => a + b.total, 0) / (scores.length || 1);
    const norm = normalizeFinalScore(raw);
    setFinalScore(norm);
    if (!isNaN(norm)) saveHighscore(songMap.id, name || "Player", norm);
  }

  const currentNote = currentNoteIdx >= 0 ? songMap.notes[currentNoteIdx] : null;
  const refHz = currentNote ? midiToHz(currentNote.midi + transpose) : null;
  const lastFrame = frames.length ? frames[frames.length-1] : null;
  const liveCents = refHz && lastFrame?.f0 ? Math.round(centsBetween(lastFrame.f0, refHz)) : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4">
      <div className="max-w-5xl mx-auto">
        <header className="flex items-center justify-between gap-4 mb-4">
          <h1 className="text-2xl font-bold">🎤 Karaoke Solo (MVP)</h1>
          <div className="flex items-center gap-2">
            <input className="px-2 py-1 rounded bg-slate-800" value={name} onChange={(e)=>setName(e.target.value)} placeholder="Your name" />
            <button className="px-3 py-2 rounded bg-indigo-600 hover:bg-indigo-500" onClick={initMic} disabled={isMicOn}>Enable Mic</button>
            <button className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-500" onClick={startRun} disabled={!isMicOn || isRunning}>Start</button>
            <button className="px-3 py-2 rounded bg-rose-600 hover:bg-rose-500" onClick={stopRun} disabled={!isRunning}>Stop</button>
          </div>
        </header>

        <section className="grid md:grid-cols-[2fr,1fr] gap-4">
          <div className="bg-slate-900/60 rounded-2xl p-4 shadow">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm opacity-80">Song: <b>{songMap.title || songMap.id}</b></div>
              <div className="text-sm opacity-80">Time: {now.toFixed(2)} s</div>
            </div>

            <div className="text-center my-6">
              <div className="text-xl md:text-2xl font-semibold">
                {songMap.lyrics.map((w, i) => (
                  <span key={i} className={i === currentLyricIdx ? "text-emerald-400" : i < currentLyricIdx ? "opacity-40" : "opacity-70"}>
                    {w.text + " "}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-800/60 rounded-xl p-3">
                <div className="text-sm mb-1 opacity-80">Live Pitch vs Ref</div>
                <div className="h-24 bg-slate-900 rounded-lg relative overflow-hidden">
                  <PitchMeter cents={liveCents} />
                </div>
                <div className="mt-2 text-sm">
                  {currentNote && (
                    <>
                      <div>Target: MIDI {currentNote.midi + transpose} ({midiToHz(currentNote.midi + transpose).toFixed(1)} Hz)</div>
                      <div>Live: {lastFrame?.f0 ? `${lastFrame.f0.toFixed(1)} Hz` : "-"} {lastFrame?.conf ? `(conf ${lastFrame.conf.toFixed(2)})` : ""}</div>
                      <div>Offset: {liveCents !== null ? `${liveCents} cents` : "-"}</div>
                    </>
                  )}
                </div>
              </div>
              <div className="bg-slate-800/60 rounded-xl p-3">
                <div className="text-sm mb-1 opacity-80">Transpose</div>
                <input type="range" min={-6} max={6} value={transpose} onChange={(e)=>setTranspose(parseInt(e.target.value))} className="w-full" />
                <div className="text-sm">{transpose} semitones</div>

                <div className="text-sm mt-4 opacity-80">Status</div>
                <ul className="text-sm list-disc ml-5">
                  <li>Mic: {isMicOn ? "on" : "off"}</li>
                  <li>Run: {isRunning ? "running" : "stopped"}</li>
                </ul>
              </div>
            </div>

            <div className="mt-4">
              <NoteTimeline notes={songMap.notes} now={now} transpose={transpose} />
            </div>
          </div>

          <div className="bg-slate-900/60 rounded-2xl p-4 shadow space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold">Song Map JSON</div>
                <button className="px-3 py-1 rounded bg-sky-700 hover:bg-sky-600" onClick={loadMapFromEditor}>Load Map</button>
              </div>
              <textarea className="w-full h-64 bg-slate-950 rounded-lg p-2 font-mono text-sm" value={mapEditor} onChange={(e)=>setMapEditor(e.target.value)} />
            </div>

            <div>
              <div className="font-semibold mb-2">Scores</div>
              {finalScore === null ? (
                <div className="text-sm opacity-70">Finish a run to see your score.</div>
              ) : (
                <div className="space-y-2">
                  <div className="text-3xl font-bold">Final Score: {finalScore}</div>
                  <div className="max-h-48 overflow-auto text-sm">
                    <table className="w-full text-left">
                      <thead className="opacity-60">
                        <tr><th>#</th><th>Pitch</th><th>Timing</th><th>Sustain</th><th>Vibrato</th><th>Total</th></tr>
                      </thead>
                      <tbody>
                        {noteScores.map((s, i) => (
                          <tr key={i} className="odd:bg-slate-800/40">
                            <td>{i+1}</td>
                            <td>{s.pitch.toFixed(0)}</td>
                            <td>{s.timing.toFixed(0)}</td>
                            <td>{s.sustain.toFixed(0)}</td>
                            <td>{s.vibrato.toFixed(0)}</td>
                            <td>{s.total.toFixed(0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div>
              <div className="font-semibold mb-1">Local Highscores</div>
              <div className="text-xs opacity-60 mb-2">(stored in this browser)</div>
              <div className="max-h-40 overflow-auto text-sm">
                <table className="w-full text-left">
                  <thead className="opacity-60"><tr><th>Score</th><th>Name</th><th>When</th></tr></thead>
                  <tbody>
                    {highscores.map((h, i) => (
                      <tr key={i} className="odd:bg-slate-800/40">
                        <td className="font-semibold">{h.score}</td>
                        <td>{h.name}</td>
                        <td>{new Date(h.ts).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        <footer className="mt-6 text-center text-xs opacity-60">
          No instrumentals or lyrics are bundled. Use public-domain or your own content.
        </footer>
      </div>
    </div>
  );
}

function PitchMeter({ cents }) {
  const clamped = cents === null ? null : Math.max(-100, Math.min(100, cents));
  return (
    <div className="absolute inset-0 flex items-center">
      <div className="w-full h-1 bg-slate-700"></div>
      <div className="absolute left-1/2 h-6 w-0.5 bg-slate-500" />
      {clamped !== null && (
        <div className="absolute -top-2" style={{ left: `${50 + clamped / 2}%` }}>
          <div className="w-1.5 h-8 bg-emerald-400 rounded"></div>
        </div>
      )}
      <div className="absolute -top-6 left-2 text-xs">-100c</div>
      <div className="absolute -top-6 right-2 text-xs">+100c</div>
    </div>
  );
}

function NoteTimeline({ notes, now, transpose }) {
  const end = notes(songMap.notes.length ? songMap.notes[songMap.notes.length-1].t1 : 0);
  return (
    <div className="h-24 bg-slate-800/60 rounded-xl p-2">
      <div className="relative h-full">
        <div className="absolute inset-x-2 top-1 text-[10px] opacity-50">
          {Array.from({ length: Math.ceil(end) + 1 }).map((_, i) => (
            <span key={i} className="inline-block" style={{ width: `${100 / Math.ceil(end)}%` }}>{i}s</span>
          ))}
        </div>
        {notes.map((n, idx) => (
          <div key={idx} className="absolute left-0 h-6 rounded-md bg-indigo-600/70 text-[10px] flex items-center justify-center"
            style={{ left: `${(n.t0 / end) * 100}%`, width: `${((n.t1 - n.t0) / end) * 100}%`, top: 24 + (idx % 3) * 22 }}>
            {Math.round(n.midi + transpose)}
          </div>
        ))}
        <div className="absolute top-0 bottom-0 w-0.5 bg-rose-400" style={{ left: `${(now / end) * 100}%` }} />
      </div>
    </div>
  );
}
