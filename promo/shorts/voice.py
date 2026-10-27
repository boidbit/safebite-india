# promo/shorts/voice.py -- the voiceover lines of a short (shorts/clip.mjs),
# spoken by a free Microsoft neural voice through edge-tts: no key, no
# account, nothing stored. Runs on GitHub (make-clip-video.yml), not locally.
#
#   pip install "edge-tts>=7,<8"
#   python3 shorts/voice.py <lines.json> <outDir>
#
# lines.json: { "voice": "hi-IN-SwaraNeural", "rate": "+8%", "lines": ["...", ...] }
# writes <outDir>/v00.mp3, v01.mp3, ... one per line, in order.
import asyncio
import json
import os
import sys

import edge_tts


async def main(spec_path, out_dir):
    with open(spec_path, encoding='utf-8') as f:
        spec = json.load(f)
    os.makedirs(out_dir, exist_ok=True)
    for i, text in enumerate(spec['lines']):
        out = os.path.join(out_dir, f'v{i:02d}.mp3')
        # The service now and then drops a request; two more tries before giving up.
        for attempt in range(3):
            try:
                await edge_tts.Communicate(text, spec['voice'], rate=spec.get('rate', '+0%')).save(out)
                break
            except Exception:
                if attempt == 2:
                    raise
                await asyncio.sleep(2)
    print(f"voice: {len(spec['lines'])} lines ({spec['voice']})")


if __name__ == '__main__':
    asyncio.run(main(sys.argv[1], sys.argv[2]))
