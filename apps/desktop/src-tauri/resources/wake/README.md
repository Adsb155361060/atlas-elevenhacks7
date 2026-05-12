# `resources/wake/` — livekit-wakeword ONNX classifier

Place a single file here: `hey_atlas.onnx` (livekit-wakeword classifier).

The file is **platform-agnostic** — one `.onnx` works on Linux, macOS, and Windows. The mel-spectrogram and embedding models are embedded at compile time in the `livekit-wakeword` crate, so this is the only artifact needed at runtime.

## How to train "Hey Atlas"

LiveKit ships a Python training toolkit. One-time setup; produces a small (~150 KB) `.onnx` classifier.

```bash
# 1. Clone the toolkit.
git clone https://github.com/livekit/livekit-wakeword.git
cd livekit-wakeword

# 2. Follow the README to set up the Python environment.
#    Typical: python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt

# 3. Train. The toolkit will guide through recording positive samples ("Hey Atlas"),
#    negative samples (anything else), and training the classifier.
python train.py --wake-word "hey atlas" --output hey_atlas.onnx

# 4. Drop hey_atlas.onnx into this directory.
cp hey_atlas.onnx apps/desktop/src-tauri/resources/wake/

# 5. Restart `pnpm --filter @atlas/desktop tauri:dev`.
#    The wake module auto-detects the file at startup.
```

Tuning targets (Phase 0.D Day-3):
- TPR ≥ 95% on 50 in-room utterances of "Hey Atlas".
- FPR ≤ 3 over 8h ambient (music + conversation + TV).
- Detection latency under 500ms from end-of-phrase.

If reality misses these:
- Increase training corpus (more positive recordings, more diverse negatives).
- Adjust `DEFAULT_THRESHOLD` in `src-tauri/src/wake/detector.rs` (range 0–1; default 0.5; raise to reduce FPR at the cost of TPR).
- Shorten `PREDICT_INTERVAL` in `src-tauri/src/wake/worker.rs` (default 200ms) to cut detection latency.

## Behavior when missing

If `hey_atlas.onnx` isn't present here, the wake module logs a warning at startup and disables itself. The app still runs; use one of:
- the debug `fire_wake_test` Tauri command (built-in for dev builds),
- the global hotkey (Phase 0.G, when it lands).

## Privacy

The classifier file captures acoustic structure trained from your recordings. Treat it like a voice signature.
- Gitignored by default (see repo `.gitignore` — `*.onnx` is on the exclude list for `resources/wake/`).
- Backup is your responsibility; retraining is cheap (rerun the Python toolkit on the same recordings).

## ADR

See `docs/decisions/0019-wake-word-rustpotter.md` for the full decision history (the filename preserves the original number; contents are about livekit-wakeword).
