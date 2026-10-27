// promo/shorts/build-short.cjs -- renders one short (promo/shorts/<name>/index.html)
// to promo/out/<name>.mp4: 1080x1920, 30 fps, H.264. A short with a
// timeline.json gets its synthesized soundtrack (shorts/soundtrack.cjs) muxed
// in as AAC; one without stays silent (add music in the platform's editor).
// RENDER_FPS=60 renders twice the frames and blends each pair into one --
// motion blur on every fast move, still a 30 fps video (the clip shorts).
//
//   cd promo && npm install --no-save ffmpeg-static@5.2.0   (once)
//   node shorts/build-short.cjs label-decoded 25            (name, seconds)
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const [name, secondsArg] = process.argv.slice(2);
if (!name) { console.error('usage: node shorts/build-short.cjs <name> [seconds]'); process.exit(1); }
const FPS = Number(process.env.RENDER_FPS) || 30;
const TOTAL = FPS * Number(secondsArg || 25);
const JOBS = 4;
const promo = path.join(__dirname, '..');
const frames = path.join(promo, 'out', `${name}-frames`);
fs.rmSync(frames, { recursive: true, force: true });
fs.mkdirSync(frames, { recursive: true });

const run = (s, e) => new Promise((resolve, reject) => {
  const p = spawn(process.execPath, ['render.cjs', frames, String(s), String(e)], {
    cwd: promo, stdio: 'inherit', env: { ...process.env, PAGE: `promo/shorts/${name}/index.html` },
  });
  p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`render ${s}-${e} exited ${code}`))));
});

(async () => {
  const per = Math.ceil(TOTAL / JOBS);
  const t0 = Date.now();
  await Promise.all(Array.from({ length: JOBS }, (_, i) => run(i * per, Math.min(TOTAL, (i + 1) * per))));
  console.log(`${TOTAL} frames in ${Math.round((Date.now() - t0) / 1000)} s`);
  const ffmpeg = require('ffmpeg-static');
  const out = path.join(promo, 'out', `${name}.mp4`);
  const hasTimeline = fs.existsSync(path.join(__dirname, name, 'timeline.json'));
  const wav = path.join(promo, 'out', `${name}.wav`);
  if (hasTimeline) execFileSync(process.execPath, [path.join(__dirname, 'soundtrack.cjs'), name], { stdio: 'inherit' });
  const audio = hasTimeline ? ['-i', wav, '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-shortest'] : [];
  const blend = FPS > 30 ? ['-vf', `tmix=frames=${Math.round(FPS / 30)},fps=30`] : [];
  execFileSync(ffmpeg, ['-y', '-v', 'error', '-framerate', String(FPS), '-i', path.join(frames, 'f_%04d.jpg'), ...audio, ...blend,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
  fs.rmSync(frames, { recursive: true, force: true });
  console.log(`wrote ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB)`);
})().catch((e) => { console.error(e.message); process.exit(1); });
