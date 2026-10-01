"""Builds the promo soundtrack: neural female voice-over (edge-tts, en-IN), synthesized
sound effects and a quiet synthesized music bed (no copyrighted audio). Writes out/audio.wav.

    python3 audio.py            # generate voice + mix
    python3 audio.py --no-tts   # reuse cached voice clips
"""
import asyncio, os, ssl, subprocess, sys, wave
import numpy as np

SR = 44100
DUR = 25.0
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
os.makedirs(OUT, exist_ok=True)
FFMPEG = os.environ.get('FFMPEG') or __import__('imageio_ffmpeg').get_ffmpeg_exe()
VOICE = 'en-IN-NeerjaNeural'

# (start time in seconds, text, speaking-rate adjustment)
VO = [
    (0.25, "Is your snack really healthy?", '+8%'),
    (3.45, "Just scan the barcode.", '+8%'),
    (6.75, "Get a score out of one hundred, and a straight answer.", '+8%'),
    (10.15, "Every ingredient, decoded in plain English.", '+8%'),
    (13.2, "See how much sugar it really adds up to.", '+8%'),
    (16.15, "Personal scores and allergen alerts for your whole family.", '+14%'),
    (19.3, "Compare, and pick the better one.", '+12%'),
    (21.65, "FoodGuard India, know what's in your food, free on Android.", '+20%'),
]

# ---------- voice ----------
async def _tts(text, path, rate):
    import edge_tts
    from edge_tts import communicate, voices
    ctx = ssl.create_default_context(cafile=os.environ.get('SSL_CERT_FILE', '/root/.ccr/ca-bundle.crt'))
    communicate._SSL_CTX = ctx
    voices._SSL_CTX = ctx
    await edge_tts.Communicate(text, VOICE, rate=rate).save(path)

def decode(path):
    raw = subprocess.run([FFMPEG, '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()

def voice_tracks(use_tts=True):
    clips = []
    for i, (t, text, rate) in enumerate(VO):
        p = os.path.join(OUT, f'vo_{i}.mp3')
        if use_tts or not os.path.exists(p):
            asyncio.run(_tts(text, p, rate))
        x = decode(p)
        # trim leading/trailing silence
        idx = np.where(np.abs(x) > 0.01)[0]
        if len(idx):
            x = x[max(0, idx[0] - 200): idx[-1] + 400]
        clips.append((t, x))
        print(f'VO {i}: start {t:.2f}s  len {len(x)/SR:.2f}s  ends {t+len(x)/SR:.2f}s')
    return clips

# ---------- synth helpers ----------
def tvec(d): return np.arange(int(SR * d)) / SR

def env_ad(n, a=0.005, d=0.2):
    t = np.arange(n) / SR
    e = np.minimum(t / max(a, 1e-4), 1.0) * np.exp(-t / d)
    return e

def whoosh(d=0.6, f0=250, f1=4200, lvl=0.5):
    n = int(SR * d)
    rng = np.random.default_rng(3)
    x = rng.standard_normal(n).astype(np.float32)
    fc = np.geomspace(f0, f1, n)
    a = 1 - np.exp(-2 * np.pi * fc / SR)
    y = np.zeros(n, np.float32); s = 0.0; s2 = 0.0
    for i in range(n):
        s += a[i] * (x[i] - s); s2 += a[i] * (s - s2); y[i] = s2
    y -= np.concatenate([[0], y[:-1]]) * 0.0
    t = np.linspace(0, 1, n)
    e = np.sin(np.pi * np.clip(t, 0, 1)) ** 1.5
    y = y / (np.max(np.abs(y)) + 1e-9) * e
    return (y * lvl).astype(np.float32)

def pop(f0=820, f1=240, d=0.14, lvl=0.5):
    t = tvec(d); f = np.geomspace(f0, f1, len(t))
    ph = 2 * np.pi * np.cumsum(f) / SR
    return (np.sin(ph) * env_ad(len(t), 0.002, d / 3) * lvl).astype(np.float32)

def tick(lvl=0.35, f=2600):
    t = tvec(0.035)
    return (np.sin(2 * np.pi * f * t) * np.exp(-t / 0.006) * lvl).astype(np.float32)

def thump(lvl=0.9):
    t = tvec(0.35); f = np.geomspace(140, 42, len(t))
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / 0.11)
    rng = np.random.default_rng(5)
    nz = rng.standard_normal(len(t)) * np.exp(-t / 0.012) * 0.4
    return ((body + nz) * lvl).astype(np.float32)

def beep(f=1760, d=0.16, lvl=0.4):
    t = tvec(d)
    y = (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * f * 2 * t)) * np.minimum(t / 0.004, 1) * np.exp(-t / (d * 0.7))
    return (y * lvl).astype(np.float32)

def ding(f=880, d=1.3, lvl=0.35):
    t = tvec(d)
    y = sum(a * np.sin(2 * np.pi * f * k * t) * np.exp(-t / (d * dk))
            for k, a, dk in [(1, 1, .35), (2.01, .5, .25), (3.02, .28, .18), (4.2, .12, .12)])
    y *= np.minimum(t / 0.003, 1)
    return (y / 1.9 * lvl).astype(np.float32)

def sweep(f0=500, f1=2400, d=0.45, lvl=0.22):
    t = tvec(d); f = np.geomspace(f0, f1, len(t))
    ph = 2 * np.pi * np.cumsum(f) / SR
    e = np.sin(np.pi * np.linspace(0, 1, len(t))) ** 1.2
    return (np.sin(ph) * e * lvl).astype(np.float32)

def alert(lvl=0.28):
    a = beep(560, 0.14, lvl); b = beep(420, 0.2, lvl)
    return np.concatenate([a, np.zeros(int(SR * 0.04), np.float32), b])

def boing(lvl=0.4):
    t = tvec(0.5)
    f = 300 + 500 * np.exp(-t / 0.08) + 25 * np.sin(2 * np.pi * 18 * t)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return (np.sin(ph) * env_ad(len(t), 0.004, 0.22) * lvl).astype(np.float32)

def riser(d=0.9, lvl=0.3):
    n = int(SR * d)
    rng = np.random.default_rng(9)
    x = rng.standard_normal(n).astype(np.float32)
    fc = np.geomspace(300, 6000, n); a = 1 - np.exp(-2 * np.pi * fc / SR)
    y = np.zeros(n, np.float32); s = 0.0
    for i in range(n):
        s += a[i] * (x[i] - s); y[i] = s
    y = y / (np.max(np.abs(y)) + 1e-9) * np.linspace(0, 1, n) ** 2
    return (y * lvl).astype(np.float32)

def sparkle(lvl=0.22):
    out = np.zeros(int(SR * 0.9), np.float32)
    for k, f in enumerate([1568, 2093, 2637, 3136]):
        s = ding(f, 0.5, lvl * (0.9 ** k)); o = int(SR * 0.06 * k); out[o:o + len(s)] += s[:len(out) - o]
    return out

# ---------- SFX timeline ----------
def sfx_events():
    ev = []
    def add(t, x): ev.append((t, x))
    add(0.12, whoosh(0.5, 300, 3500, .35))
    for t in (0.35, 0.70, 1.05): add(t, pop(900, 300, .12, .3))   # headline words
    add(0.2, boing(.3))
    for t in (1.0, 1.4, 1.8): add(t, thump(.85))                  # claim stamps
    add(2.15, sweep(300, 2600, .7, .2))                           # beam over pack
    add(2.35, alert(.25))                                         # suspicious "?"
    add(2.5, riser(0.55, .25))
    add(2.95, whoosh(0.7, 200, 4500, .45))                        # phone rises
    add(4.5, sweep(400, 2200, .35, .2)); add(4.85, sweep(2200, 400, .35, .2))
    add(5.25, beep(1760, .18, .45)); add(5.43, beep(2349, .22, .4))
    add(5.30, whoosh(0.45, 400, 5000, .35))
    # score count-up ticks (6.7 -> 8.0)
    for k in range(18): add(6.7 + k * 0.075, tick(.28, 2200 + k * 40))
    add(8.0, ding(1046, 1.4, .4))
    add(6.4, whoosh(0.55, 250, 4200, .4))
    add(7.0, pop(900, 300, .12, .3)); add(8.5, pop(900, 300, .12, .3))
    add(10.0, whoosh(0.55, 250, 4200, .4))
    add(10.4, sweep(300, 2000, .9, .2))
    add(10.95, pop(900, 300, .12, .3)); add(11.95, pop(900, 300, .12, .3))
    add(13.0, whoosh(0.55, 250, 4200, .4))
    for k in range(20): add(14.95 + k * 0.045, tick(.25, 2000 + k * 55))
    add(15.05, pop(500, 180, .2, .35)); add(15.85, ding(784, 1.0, .35))
    add(16.0, whoosh(0.55, 250, 4200, .4))
    add(16.15, alert(.26)); add(16.2, pop(900, 300, .12, .3)); add(17.75, pop(900, 300, .12, .3))
    add(19.0, whoosh(0.55, 250, 4200, .4))
    add(19.65, pop(900, 300, .12, .3))
    add(21.6, whoosh(0.7, 200, 5000, .5))
    add(21.85, boing(.45)); add(22.3, pop(900, 300, .12, .3))
    add(23.15, pop(600, 200, .15, .35)); add(23.3, sparkle(.25))
    add(23.9, ding(1318, 1.1, .3))
    return ev

# ---------- music ----------
def music():
    bpm = 112; beat = 60 / bpm
    n = int(SR * DUR); out = np.zeros(n, np.float32)
    chords = [('A', [57, 60, 64]), ('F', [53, 57, 60]), ('C', [48, 52, 55]), ('G', [55, 59, 62])]
    mf = lambda m: 440 * 2 ** ((m - 69) / 12)
    def pluck(f, d=0.28, lvl=0.16):
        t = tvec(d)
        y = (2 * ((t * f) % 1) - 1) * 0.5 + np.sin(2 * np.pi * f * t) * 0.5
        return (y * np.exp(-t / 0.09) * np.minimum(t / 0.004, 1) * lvl).astype(np.float32)
    def bass(f, d=0.4, lvl=0.35):
        t = tvec(d)
        return (np.sin(2 * np.pi * f * t) * np.exp(-t / 0.22) * np.minimum(t / 0.006, 1) * lvl).astype(np.float32)
    def kick(lvl=0.5):
        t = tvec(0.22); f = np.geomspace(150, 45, len(t)); ph = 2 * np.pi * np.cumsum(f) / SR
        return (np.sin(ph) * np.exp(-t / 0.07) * lvl).astype(np.float32)
    def hat(lvl=0.09):
        rng = np.random.default_rng(int(1e6 * lvl)); t = tvec(0.05)
        x = rng.standard_normal(len(t)); x = x - np.concatenate([[0], x[:-1]])
        return (x * np.exp(-t / 0.012) * lvl).astype(np.float32)
    def put(t0, x):
        i = int(SR * t0)
        if i < n: out[i:i + len(x)] += x[:n - i]
    steps = int(DUR / (beat / 2))
    for s in range(steps):
        t0 = s * beat / 2; bar = int(s / 8) % 4; name, notes = chords[bar]
        if s % 2 == 0: put(t0, kick(.42)) if (s % 4 == 0) else None
        if s % 2 == 1: put(t0, hat())
        if s % 4 == 0: put(t0, bass(mf(notes[0] - 12)))
        put(t0, pluck(mf(notes[(s % 3)] + 12)))
    return out

# ---------- mix ----------
def main():
    use_tts = '--no-tts' not in sys.argv
    clips = voice_tracks(use_tts)
    n = int(SR * DUR)
    vo = np.zeros(n, np.float32)
    for t, x in clips:
        x = x / (np.max(np.abs(x)) + 1e-9) * 0.9
        i = int(SR * t); vo[i:i + len(x)] += x[:n - i]
    sfx = np.zeros(n, np.float32)
    for t, x in sfx_events():
        i = int(SR * t)
        if i < n: sfx[i:i + len(x)] += x[:n - i]
    mus = music()
    # duck music (and a little sfx) under the voice
    e = np.abs(vo); k = int(SR * 0.12)
    e = np.convolve(e, np.ones(k) / k, mode='same'); e = np.clip(e * 6, 0, 1)
    fade = np.minimum(np.linspace(0, DUR, n) / 0.8, 1) * np.minimum((DUR - np.linspace(0, DUR, n)) / 0.9, 1)
    mus = mus * (1 - 0.55 * e) * fade * (0.75 + 0.25 * (np.linspace(0, DUR, n) > 3.0))
    mix = vo * 1.0 + sfx * (1 - 0.3 * e) * 0.9 + mus * 0.55
    peak = np.max(np.abs(mix)); mix = mix / peak * 0.89
    mix = np.tanh(mix * 1.1) / np.tanh(1.1)
    st = np.stack([mix, mix], axis=1)
    pcm = (st * 32767).astype('<i2')
    with wave.open(os.path.join(OUT, 'audio.wav'), 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    print('wrote', os.path.join(OUT, 'audio.wav'), f'{n/SR:.1f}s')

if __name__ == '__main__':
    main()
