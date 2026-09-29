# FoodGuard India — promo videos

## v2: 50s "The Label Is Lying" (no voice-over)

Graphics-first story in `v2/`: shouting shelf → "*Conditions apply" → fine print → "Until now." →
scan + X-ray → sugar jar (637 teaspoons/year) → verdict gauge → family allergy alert → compare scale →
real app + CTA. Only one real screenshot is used (home screen, near the end). No voice: kinetic text,
synthesized score and sound design (`v2/audio.py`). Build with `v2/build.sh` →
`out/foodguard-promo-50s.mp4`. Edit copy/timing in `v2/index.html` (`HL` = headlines, `CAP` = captions).

## v1: 25s screenshot walkthrough

Vertical (1080x1920) promo built from real app screenshots. The whole video is one HTML page
(`index.html`) that draws every frame from a single time value `render(t)`, so it is deterministic
and easy to edit.

| File | What it does |
| --- | --- |
| `index.html` | All scenes, animation and on-screen text (edit copy / timing here) |
| `audio.py` | Female en-IN voice-over (edge-tts), synthesized sound effects + quiet music bed |
| `render.cjs` | Renders frames with headless Chromium (`--at 1.5,3` renders preview stills) |
| `build.sh` | Voice/audio -> frames -> MP4 |
| `out/foodguard-promo.mp4` | The finished video |

## Rebuild

```bash
cd promo
npm install                      # fonts
pip install imageio-ffmpeg edge-tts numpy
./build.sh
```

Screenshots are **not** committed (they show family names and, in one case, a contact name). Put your
own in `promo/src/` as `01.png`..`14.png` (1080px wide): 01 score explainer, 02 sugar teaspoons,
06 compare result, 07 product result, 08 label X-ray, 14 home. The rest are unused.

## Brand-safety choices

* The scanned pack is a dummy ("Fruit & Nut Cookies"); the product name on the result screen is
  replaced to match, and the compare screen's product names/photos are blurred to "Product A/B/C".
* All sound effects and the music bed are generated in `audio.py`, so there is nothing to license.
  Add a trending track in Instagram/YouTube if you want one on top (keep it low).
