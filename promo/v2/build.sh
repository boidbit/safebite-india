#!/usr/bin/env bash
# Builds promo/out/foodguard-promo-50s.mp4 (1080x1920, 30fps, 50s, no voice-over).
# Setup is the same as ../build.sh, plus: pip install scipy
set -euo pipefail
cd "$(dirname "$0")/.."

export PLAYWRIGHT_PATH="${PLAYWRIGHT_PATH:-$(npm root -g)/playwright}"
export PAGE=promo/v2/index.html
FFMPEG="${FFMPEG:-$(python3 -c 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())')}"
FPS=30
TOTAL=$((FPS * 50))
JOBS="${JOBS:-4}"

rm -rf out/frames2 && mkdir -p out/frames2

python3 v2/audio.py                                   # -> out/audio_v2.wav

per=$(( (TOTAL + JOBS - 1) / JOBS ))
for ((i = 0; i < JOBS; i++)); do
  s=$((i * per)); e=$((s + per)); (( e > TOTAL )) && e=$TOTAL
  node render.cjs out/frames2 "$s" "$e" &
done
wait

"$FFMPEG" -y -v error -framerate $FPS -i out/frames2/f_%04d.jpg -i out/audio_v2.wav \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart \
  -af "loudnorm=I=-14:TP=-1.5:LRA=11" -c:a aac -b:a 192k -ar 44100 -shortest \
  out/foodguard-promo-50s.mp4
echo "wrote out/foodguard-promo-50s.mp4"
