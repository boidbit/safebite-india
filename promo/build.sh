#!/usr/bin/env bash
# Builds promo/out/foodguard-promo.mp4 (1080x1920, 30fps, 25s, H.264 + AAC).
#
# One-time setup:
#   cd promo && npm install            # fonts (Poppins, Inter)
#   pip install imageio-ffmpeg edge-tts numpy
#   npm i -g playwright                # + a Chromium (PLAYWRIGHT_BROWSERS_PATH)
#   put the app screenshots in promo/src/ as 01.png..14.png (see README)
set -euo pipefail
cd "$(dirname "$0")"

export PLAYWRIGHT_PATH="${PLAYWRIGHT_PATH:-$(npm root -g)/playwright}"
FFMPEG="${FFMPEG:-$(python3 -c 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())')}"
FPS=30
TOTAL=$((FPS * 25))
JOBS="${JOBS:-4}"

rm -rf out/frames && mkdir -p out/frames

# 1) voice-over + sound effects + music -> out/audio.wav
python3 audio.py

# 2) frames, rendered in parallel chunks
per=$(( (TOTAL + JOBS - 1) / JOBS ))
for ((i = 0; i < JOBS; i++)); do
  s=$((i * per)); e=$((s + per)); (( e > TOTAL )) && e=$TOTAL
  node render.cjs out/frames "$s" "$e" &
done
wait

# 3) encode + mux, normalised to a social-friendly loudness
"$FFMPEG" -y -v error -framerate $FPS -i out/frames/f_%04d.jpg -i out/audio.wav \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart \
  -af "loudnorm=I=-14:TP=-1.5:LRA=11" -c:a aac -b:a 192k -ar 44100 -shortest \
  out/foodguard-promo.mp4
echo "wrote out/foodguard-promo.mp4"
