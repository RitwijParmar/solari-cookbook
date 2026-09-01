# GhostAck running demo

The 62-second video uses frames captured while the real GhostAck control plane was executing a reviewer-triggered kill-after-commit run. It is not a slide deck or a mocked product animation.

- `ghostack-demo.mp4` — narrated 1080p product demonstration;
- `ghostack-cover.jpg` — social and repository preview;
- `capture/frame-*.jpg` — the actual browser-frame sequence used for the running segment;
- `narration.txt` — reproducible natural-English script;
- `render_video.py` — reproducible renderer.

Re-render on macOS:

```bash
say -v 'Aman (English (India))' -r 185 -f narration.txt -o narration.aiff
FFMPEG_BIN=/path/to/ffmpeg python3 render_video.py
```

The committed video includes no API key, signed Solari capability URL, browser cookie, or private credential.
