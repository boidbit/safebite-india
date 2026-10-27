# promo/shorts/voice.py -- the voiceover lines of a short (shorts/clip.mjs),
# spoken by a free Microsoft neural voice through edge-tts: no key, no
# account, nothing stored. Runs on GitHub (make-clip-video.yml), not locally.
#
#   pip install "edge-tts>=7,<8"
#   python3 shorts/voice.py <lines.json> <outDir>
#
# lines.json: { "voice": "hi-IN-SwaraNeural", "rate": "+15%",
#               "lines": ["...", { "text": "...", "rate": "+8%", "pitch": "+6Hz" }, ...] }
# A line is its text, or the text with its own rate/pitch (a question lifts,
# a number lands a touch slower). Writes <outDir>/v00.mp3, v01.mp3, ... in order.
import asyncio
import json
import os
import sys

import edge_tts


async def main(spec_path, out_dir):
    with open(spec_path, encoding='utf-8') as f:
        spec = json.load(f)
    os.makedirs(out_dir, exist_ok=True)
    for i, line in enumerate(spec['lines']):
        if isinstance(line, str):
            line = {'text': line}
        out = os.path.join(out_dir, f'v{i:02d}.mp3')
        # The service now and then drops a request; two more tries before giving up.
        for attempt in range(3):
            try:
                await edge_tts.Communicate(line['text'], spec['voice'], rate=line.get('rate', spec.get('rate', '+0%')), pitch=line.get('pitch', '+0Hz')).save(out)
                break
            except Exception:
                if attempt == 2:
                    raise
                await asyncio.sleep(2)
    print(f"voice: {len(spec['lines'])} lines ({spec['voice']})")


if __name__ == '__main__':
    asyncio.run(main(sys.argv[1], sys.argv[2]))
