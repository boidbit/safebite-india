"""Soundtrack for the 50s FoodGuard promo (no voice-over).

Everything is synthesized here -- score and sound effects -- so there is nothing to license.
Timeline mirrors index.html:
   0-12  tension: low drone + filtered pulse, bubble pops, ticking clock, heartbeat
  12-13.4 silence -> reverse swell ("Until now.")
  13.4   impact + logo; riser into
  16-46  main groove at 120 BPM (Am-F-C-G), breakdown 31-34 for the verdict
  46-50  build, final hit on the CTA, ring-out
Writes out/audio_v2.wav (stereo, 44.1 kHz).
"""
import os, wave
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR = 44100
DUR = 50.0
N = int(SR * DUR)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'out')
os.makedirs(OUT, exist_ok=True)
RNG = np.random.default_rng(7)


# ---------------- dsp helpers ----------------
def T(d): return np.arange(int(SR * d)) / SR
def mf(m): return 440.0 * 2 ** ((m - 69) / 12)
def noise(d, seed=None):
    r = np.random.default_rng(seed) if seed is not None else RNG
    return r.standard_normal(int(SR * d))
def lp(x, fc, o=2): return sosfilt(butter(o, min(fc, SR / 2 - 100), 'low', fs=SR, output='sos'), x)
def hp(x, fc, o=2): return sosfilt(butter(o, fc, 'high', fs=SR, output='sos'), x)
def bp(x, lo, hi, o=2): return sosfilt(butter(o, [lo, min(hi, SR / 2 - 100)], 'band', fs=SR, output='sos'), x)
def saw(f, n, cents=0.0):
    ph = np.cumsum(np.full(n, f * 2 ** (cents / 1200) / SR))
    return 2 * (ph % 1) - 1
def sweep_sin(f0, f1, d, geo=True):
    t = T(d); f = np.geomspace(f0, f1, len(t)) if geo else np.linspace(f0, f1, len(t))
    return np.sin(2 * np.pi * np.cumsum(f) / SR)
def env_exp(n, a, tau):
    t = np.arange(n) / SR
    return np.minimum(t / max(a, 1e-4), 1) * np.exp(-t / tau)


class Bus:
    def __init__(self): self.L = np.zeros(N); self.R = np.zeros(N)
    def put(self, t, x, g=1.0, pan=0.0):
        i = int(t * SR)
        if i >= N or i + len(x) <= 0: return
        n = min(len(x), N - i)
        a = (pan + 1) * np.pi / 4
        self.L[i:i + n] += x[:n] * g * np.cos(a) * 1.414
        self.R[i:i + n] += x[:n] * g * np.sin(a) * 1.414
    def put2(self, t, l, r, g=1.0):
        i = int(t * SR); n = min(len(l), N - i)
        if n <= 0: return
        self.L[i:i + n] += l[:n] * g; self.R[i:i + n] += r[:n] * g


def reverb(x, secs=2.4, tau=0.55, seed=1):
    ir = noise(secs, seed) * np.exp(-T(secs) / tau)
    ir = lp(ir, 6000); ir /= np.sqrt(np.sum(ir ** 2))
    return fftconvolve(x, ir)[:len(x)]


# ---------------- instruments ----------------
def pad(notes, dur, cut=1800, att=0.35, rel=0.9, spread=(-9, 0, 8)):
    n = int(SR * (dur + rel)); t = np.arange(n) / SR
    y = np.zeros(n)
    for m in notes:
        for c in spread: y += saw(mf(m), n, c)
    y = lp(y, cut)
    env = np.minimum(t / att, 1) * np.where(t < dur, 1.0, np.exp(-(t - dur) / (rel / 3)))
    return y * env / (len(notes) * len(spread))

def pluck(m, d=0.22, cut=3200, g=1.0):
    n = int(SR * d); y = saw(mf(m), n) * 0.6 + np.sign(np.sin(2 * np.pi * mf(m) * T(d))) * 0.25
    return lp(y, cut) * env_exp(n, 0.002, 0.07) * g

def bass(m, d=0.24, cut=520, g=1.0):
    n = int(SR * d); y = saw(mf(m), n) * 0.55 + np.sin(2 * np.pi * mf(m) * T(d)) * 0.7
    return lp(y, cut) * env_exp(n, 0.004, 0.12) * g

def kick(g=1.0):
    d = 0.32; y = sweep_sin(160, 42, d) * env_exp(int(SR * d), 0.001, 0.09)
    click = hp(noise(d, 3), 3000) * env_exp(int(SR * d), 0.0005, 0.004) * 0.4
    return (y + click) * g

def clap(g=1.0):
    d = 0.3; n = int(SR * d); x = bp(noise(d, 5), 900, 5000)
    e = np.zeros(n)
    for o in (0, 0.012, 0.024): e += np.roll(env_exp(n, 0.0005, 0.012 if o < 0.02 else 0.09), int(o * SR))
    body = np.sin(2 * np.pi * 190 * T(d)) * env_exp(n, 0.001, 0.04) * 0.5
    return (x * e * 0.8 + body) * g

def hat(g=1.0, open_=False, seed=11):
    d = 0.2 if open_ else 0.05
    return hp(noise(d, seed), 7000) * env_exp(int(SR * d), 0.0005, 0.06 if open_ else 0.012) * g


# ---------------- sfx ----------------
def whoosh(d=0.6, lo=250, hi=3500):
    x = bp(noise(d), lo, hi); t = np.linspace(0, 1, len(x))
    return x * np.sin(np.pi * t) ** 1.6 / (np.max(np.abs(x)) + 1e-9)

def pop(f0=900, f1=260, d=0.13):
    return sweep_sin(f0, f1, d) * env_exp(int(SR * d), 0.002, d / 3)

def thump(g=1.0, f0=140, f1=40, d=0.4, tau=0.12):
    body = sweep_sin(f0, f1, d) * env_exp(int(SR * d), 0.001, tau)
    nz = lp(noise(d), 900) * env_exp(int(SR * d), 0.0005, 0.02) * 0.6
    return (body + nz) * g

def impact():
    d = 2.6; n = int(SR * d)
    sub = sweep_sin(75, 28, d) * env_exp(n, 0.002, 0.7)
    crash = hp(noise(d, 21), 2500) * env_exp(n, 0.002, 0.8) * 0.35
    body = lp(noise(d, 22), 400) * env_exp(n, 0.001, 0.08) * 0.8
    return sub * 1.2 + crash + body

def rev_swell(d=1.0):
    x = hp(noise(d, 31), 3000) * (T(d) / d) ** 3
    tone = sweep_sin(300, 900, d) * (T(d) / d) ** 3 * 0.25
    return x * 0.6 + tone

def riser(d=1.4):
    t = T(d); k = (t / d) ** 2
    return hp(noise(d, 41), 1200) * k * 0.45 + sweep_sin(180, 1400, d) * k * 0.22

def scratch():
    d = 0.4; t = T(d)
    f = 250 + 1100 * np.abs(np.sin(np.pi * t / d * 1.5))
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) + bp(noise(d), 800, 4000) * 0.35
    return np.tanh(3 * y) * np.sin(np.pi * t / d) * 0.6

def tick(hi=True):
    d = 0.05; n = int(SR * d)
    return bp(noise(d), 2500 if hi else 1100, 6500 if hi else 2600, 4) * env_exp(n, 0.0003, 0.008) * 3.0

def heartbeat():
    d = 0.5; out = np.zeros(int(SR * d))
    for o, a in ((0, 1.0), (0.19, 0.7)):
        b = np.sin(2 * np.pi * 52 * T(0.25)) * env_exp(int(SR * 0.25), 0.008, 0.07) * a
        i = int(o * SR); out[i:i + len(b)] += b
    return out

def bong(m=45, d=2.5):
    t = T(d); f = mf(m)
    y = sum(a * np.sin(2 * np.pi * f * k * t) * np.exp(-t / (d * dk)) for k, a, dk in ((1, 1, .4), (2, .4, .25), (3.01, .15, .15)))
    return y * np.minimum(t / 0.01, 1) * 0.6

def beep(f=1760, d=0.15):
    t = T(d)
    return (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t)) * np.minimum(t / 0.003, 1) * np.exp(-t / (d * .6)) * 0.5

def ding(f=1046, d=1.2):
    t = T(d)
    y = sum(a * np.sin(2 * np.pi * f * k * t) * np.exp(-t / (d * dk)) for k, a, dk in ((1, 1, .35), (2.01, .5, .25), (3.02, .28, .18), (4.2, .12, .12)))
    return y * np.minimum(t / 0.003, 1) / 1.9

def clink(seed):
    r = np.random.default_rng(seed); d = 0.5; t = T(d); v = 1 + r.uniform(-.06, .06)
    return sum(a * np.sin(2 * np.pi * f * v * t) * np.exp(-t / dk) for f, a, dk in ((2350, 1, .25), (3520, .6, .18), (4870, .4, .12), (6100, .25, .08))) * 0.35

def pour(d=1.0):
    x = bp(noise(d, 51), 2500, 9000)
    grain = np.abs(lp(noise(d, 52), 30)); grain /= grain.max()
    return x * grain * np.sin(np.pi * T(d) / d) * 0.7

def zap():
    d = 0.8; y = sweep_sin(150, 2400, 0.35)
    n = int(SR * d); y = np.concatenate([y, np.zeros(n - len(y))])
    tt = np.arange(n) / SR
    hum = sum(np.sin(2 * np.pi * 120 * k * tt) / k for k in (1, 2, 3, 5)) * np.exp(-tt / 0.35) * 0.4
    return y * env_exp(len(y), 0.005, 0.2) * 0.5 + hum

def err_blip(): return np.concatenate([beep(392, 0.12), beep(294, 0.2)]) * 1.1
def info_blip(): return beep(784, 0.18)
def ok_blip(): return np.concatenate([beep(1046, 0.1), beep(1568, 0.22)])

def alarm():
    out = []
    for _ in range(3):
        for f in (880, 660):
            t = T(0.16); out.append(lp(np.sign(np.sin(2 * np.pi * f * t)), 3000) * np.minimum(t / .005, 1) * 0.35)
    return np.concatenate(out)

def creak():
    d = 0.9; t = T(d); f = 95 - 25 * t / d
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * (0.6 + 0.4 * np.sign(np.sin(2 * np.pi * 22 * t)))
    return lp(y, 600) * np.sin(np.pi * t / d) * 0.5

def sparkle():
    out = np.zeros(int(SR * 1.2))
    for k, f in enumerate((1568, 2093, 2637, 3136, 4186)):
        s = ding(f, 0.6) * (0.8 ** k); i = int(SR * 0.055 * k); out[i:i + len(s)] += s[:len(out) - i]
    return out * 0.6


# ---------------- score ----------------
def score(M):
    # --- intro tension 0-11.95 ---
    n = int(SR * 11.95); t = np.arange(n) / SR
    drone = lp(saw(55, n) + saw(55, n, 9) + saw(82.4, n, -6) * .5, 160) * 0.22
    drone *= np.minimum(t / 1.5, 1) * np.minimum((11.95 - t) / 0.08, 1)
    M.put2(0, drone, drone * 0.98)
    lowpad = pad([45, 48, 52], 9.6, cut=700, att=2.0, rel=0.3)
    M.put(2.0, lowpad, 0.35)
    for k in range(int(11.9 / 0.25)):
        tt = k * 0.25
        cut = np.interp(tt, [0, 5.5, 11.5], [260, 1300, 300])
        m = 33 if k % 4 else 45
        M.put(tt, bass(m, 0.22, cut, 0.55), 1.0)
    # --- 13.4 hit chord (C major, wide) ---
    M.put2(13.4, pad([48, 55, 60, 64], 2.6, cut=2600, att=0.05, rel=1.2), pad([48, 55, 60, 64], 2.6, cut=2600, att=0.05, rel=1.2, spread=(-6, 0, 11)), 0.55)
    M.put(13.4, bass(36, 2.5, 300, 0.9))
    # --- groove 16-46 ---
    chords = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]]   # Am F C G
    roots = [33, 29, 36, 31]
    for bar in range(15):
        t0 = 16 + bar * 2.0; c = bar % 4
        brk = 31 <= t0 + 1 and t0 < 34      # bars touching the breakdown
        M.put2(t0, pad(chords[c], 2.0, cut=2200, rel=0.4), pad(chords[c], 2.0, cut=2200, rel=0.4, spread=(-6, 0, 11)), 0.42)
        for s in range(16):              # 8th = .125? no: 16th = .125 s at 120 BPM
            tt = t0 + s * 0.125
            in_brk = 31.0 <= tt < 34.0
            beat = s % 4 == 0
            if beat and (not in_brk or s % 8 == 0): M.put(tt, kick(1.0 if not in_brk else 0.6))
            if not in_brk:
                if s in (4, 12): M.put(tt, clap(0.55), pan=0.05)
                if s % 2 == 1: M.put(tt, hat(0.22, seed=11 + s), pan=0.3)
                if s % 2 == 0: M.put(tt, bass(roots[c] + (12 if s % 4 == 2 else 0), 0.2, 700, 0.8))
                arp = chords[c][[0, 1, 2, 1][s % 4]] + (12 if s // 4 % 2 else 0)
                M.put(tt, pluck(arp, g=0.22), pan=-0.35 if s % 2 else 0.35)
            elif s % 8 == 0:
                M.put(tt, bass(roots[c], 1.0, 300, 0.8))
    # --- 46-47.3 build, 47.3 final ---
    M.put2(46.0, pad([48, 52, 55, 60], 1.3, cut=1600), pad([48, 52, 55, 60], 1.3, cut=1600, spread=(-6, 0, 11)), 0.4)
    fin = [36, 48, 55, 60, 64, 67]
    M.put2(47.3, pad(fin, 2.2, cut=3000, att=0.02, rel=1.0), pad(fin, 2.2, cut=3000, att=0.02, rel=1.0, spread=(-6, 0, 11)), 0.6)
    M.put(47.3, kick(1.2)); M.put(47.3, bass(24, 2.2, 250, 1.0))
    for k, m in enumerate((72, 76, 79, 84)): M.put(47.55 + k * 0.125, pluck(m, 0.5, 5000, 0.3), pan=(-.4, .4)[k % 2])


def sfx(S):
    # S1 shelf
    S.put(0.05, thump(0.7, 90, 35, 0.9, 0.3))
    for tt, pn in ((0.6, -.5), (1.1, -.2), (1.6, .25), (2.1, .55)): S.put(tt, pop(), 0.55, pn)
    for i in range(7): S.put(2.8 + i * .17, pop(1300, 500, 0.08), 0.35, (-.6, .5, .1, -.3, .6, -.5, .4)[i])
    S.put(4.25, scratch(), 0.8)
    S.put(4.35, whoosh(0.6, 200, 5000), 0.5)
    S.put(4.95, thump(1.0, 120, 30, 0.8, 0.25)); S.put(4.95, bong(40, 2.0), 0.5)
    # S2 fine print
    S.put(5.95, whoosh(0.5, 150, 2000), 0.45)
    t = 6.5
    while t < 11.6:
        S.put(t, tick(int((t - 6.5) / (0.25 if t >= 8.9 else 0.5)) % 2 == 0), 0.5, 0.15)
        t += 0.25 if t >= 8.9 else 0.5
    t = 9.2
    while t < 11.7:
        S.put(t, heartbeat(), 1.0); t += max(0.52, 0.85 - (t - 9.2) * 0.12)
    S.put(7.2, whoosh(0.4, 400, 3000), 0.25, -0.3)
    S.put(8.85, whoosh(0.35, 300, 3000), 0.3)
    # S3 until now
    S.put(12.25, bong(45, 2.2), 0.55)
    S.put(12.4, rev_swell(1.0), 0.7)
    S.put(13.4, impact(), 1.0)
    S.put(14.0, sparkle(), 0.35)
    S.put(14.6, riser(1.4), 0.55)
    S.put(15.5, whoosh(0.5, 300, 4000), 0.35, -0.5)
    # S4 scan + x-ray
    S.put(16.0, whoosh(0.5, 250, 4000), 0.4)
    S.put(16.85, sweep_sin(500, 2200, 0.45) * 0.18); S.put(17.3, sweep_sin(2200, 500, 0.45) * 0.18)
    S.put(17.8, beep(1760, .15), 0.9); S.put(17.95, beep(2349, .2), 0.8)
    S.put(18.0, zap(), 0.8)
    for i in range(6):
        S.put(19.0 + i * .42, whoosh(0.3, 600, 5000), 0.25, (-.5, .5)[i % 2])
        S.put(19.25 + i * .42, (err_blip, err_blip, info_blip, info_blip, ok_blip, ok_blip)[i](), 0.7, (-.4, .4)[i % 2])
    for i in range(3): S.put(21.9 + i * .15, pop(800, 400, .1), 0.4)
    # S5 sugar
    S.put(24.0, whoosh(0.5, 200, 3000), 0.4)
    drops = [24.5, 24.95] + [25.4, 25.6, 25.8, 26.0, 26.2] + [26.45 + k * .1 for k in range(10)] + [27.5 + k * .05 for k in range(17)]
    lens = [.45] * 2 + [.42] * 5 + [.35] * 10 + [.28] * 17
    for k, (d0, ln) in enumerate(zip(drops, lens)):
        S.put(d0 + ln * 0.8, clink(k), 0.9 if k < 17 else 0.55, ((k * 37) % 9 - 4) / 6)
    S.put(27.5, pour(1.1), 0.8)
    for k in range(20): S.put(27.45 + k * 0.045, tick(True), 0.25)
    S.put(28.35, thump(0.8, 200, 60, .5, .15)); S.put(28.35, ding(784, 1.2), 0.35)
    for tt in (29.22, 29.57, 29.92): S.put(tt, thump(1.1, 110, 35, 0.5, 0.14))
    # S6 verdict
    S.put(31.0, whoosh(0.5, 200, 3000), 0.4)
    t = 31.3
    while t < 33.1:
        S.put(t, tick(True), 0.35); t += 0.045
    S.put(33.1, ding(1046, 1.4), 0.5)
    S.put(33.8, thump(1.3, 150, 38, 0.6, 0.16)); S.put(33.8, lp(noise(0.3), 1500) * env_exp(int(SR * .3), .0005, .05), 0.8)
    # S7 family
    S.put(36.0, whoosh(0.5, 200, 3000), 0.4)
    S.put(36.2, pop(), 0.4)
    for i in range(3): S.put(36.5 + i * .25, pop(700, 250, .14), 0.5, (-.5, 0, .5)[i])
    S.put(37.5, ok_blip(), 0.4, -0.5); S.put(37.95, info_blip(), 0.4, 0)
    S.put(38.7, alarm(), 0.75, 0.3); S.put(38.7, thump(0.9), 1.0)
    S.put(39.3, whoosh(0.6, 200, 2500), 0.35)
    S.put(40.0, pop(600, 200, .18), 0.5)
    # S8 compare
    S.put(42.0, whoosh(0.5, 200, 3000), 0.4)
    S.put(42.6, thump(0.7, 180, 60, .3, .08), 1.0, -0.4); S.put(42.8, thump(0.7, 180, 60, .3, .08), 1.0, 0.4)
    S.put(42.9, creak(), 0.6)
    S.put(44.6, thump(0.5, 300, 120, .2, .05), 1.0, 0.4); S.put(44.6, sparkle(), 0.5, 0.4)
    S.put(44.9, pop(), 0.35, 0.4)
    # S9 proof + CTA
    S.put(46.0, whoosh(0.6, 200, 4000), 0.5)
    S.put(46.2, riser(1.1), 0.5)
    S.put(47.3, impact() * 0.6, 1.0); S.put(47.45, sparkle(), 0.5)
    S.put(48.3, pop(700, 250, .15), 0.5); S.put(48.4, ding(1318, 1.4), 0.35)


def main():
    M, S = Bus(), Bus()
    score(M); sfx(S)
    # reverb sends
    for b, mixv in ((M, 0.22), (S, 0.12)):
        b.L += reverb(b.L, seed=1) * mixv; b.R += reverb(b.R, seed=2) * mixv
    # light pumping on the groove so kicks punch through
    t = np.arange(N) / SR
    pump = np.where((t >= 16) & (t < 46) & ~((t >= 31) & (t < 34)), 1 - 0.35 * np.exp(-((t - 16) % 0.5) / 0.09), 1.0)
    shape = np.interp(t, [0, 11.9, 12, 16, 16.01, 46, 50], [0.7, 0.7, 1.0, 1.0, 1.45, 1.45, 1.3])
    ml, mr = M.L * pump * shape, M.R * pump * shape
    L = ml * 0.55 + S.L * 0.9; R = mr * 0.55 + S.R * 0.9
    fade = np.minimum(t / 0.05, 1) * np.minimum((DUR - t) / 1.2, 1)
    L *= fade; R *= fade
    pk = max(np.max(np.abs(L)), np.max(np.abs(R))); L /= pk; R /= pk
    L = np.tanh(L * 1.4) / np.tanh(1.4) * 0.92; R = np.tanh(R * 1.4) / np.tanh(1.4) * 0.92
    pcm = (np.stack([L, R], axis=1) * 32767).astype('<i2')
    path = os.path.join(OUT, 'audio_v2.wav')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    print('wrote', path)


if __name__ == '__main__':
    main()
