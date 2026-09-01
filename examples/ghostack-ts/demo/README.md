# GhostAck running demo

The 62-second video uses frames captured while the real GhostAck control plane was executing a reviewer-triggered kill-after-commit run. It is not a slide deck or a mocked product animation.

- `ghostack-demo-v2.mp4` — current 1080p live-product cut with natural narration and pen annotations;
- `ghostack-demo.mp4` — original narrated product demonstration;
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

## Natural live-demo cut

`ghostack-demo-v2.mp4` is the second-generation demo. It uses a fresh recording of the deployed GCP product executing both a Solari live kill-after-commit run and a 20-agent collision. Hand-drawn pen marks call out the ambiguous window, the exactly-once result, and the concurrency boundary. Narration uses a conversational Indian-English voice and first-person product language instead of the macOS `say` voice.

Rebuild it with:

```bash
python3 render_video_v2.py
```
