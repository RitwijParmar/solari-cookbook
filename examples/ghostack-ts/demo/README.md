# Demo assets

The video is generated from the public Cloud Run dashboard, its committed live
evidence, the public GitHub Actions result, and Ritwij Aryan Parmar's supplied
portrait. It does not stage a fake target or claim that deterministic fixtures
are live infrastructure.

```bash
say -v "Aman (English (India))" -r 178 -f narration.txt -o narration.aiff
FFMPEG=/path/to/ffmpeg python3 render_video.py
```

Outputs:

- `aegis-commit-demo.mp4` — narrated 1080p running-product walkthrough;
- `aegis-commit-cover.jpg` — 16:9 social preview image.
