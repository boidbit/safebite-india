// src/components/body/SugarScenes.jsx
//
// The pictures for the sugar body story (see sugarStory.js for the scene
// list, captions and sources). Each one draws ONLY what its caption says --
// sugar into glucose into the blood, blood glucose up, insulin from the
// pancreas, glucose into cells for energy, plaque turning sugar into acid on
// a tooth, WHO's 25 g line -- never a body shape, a disease or an outcome no
// source states. Animations (index.css .bs-*) run once per mount.
const SUGAR = '#ec4899';
const BLOOD = '#ef4444';
const GLUCOSE = '#f59e0b';
const CELL = '#22c55e';
const INSULIN = '#6366f1';
const LINE = 'var(--label-3)';

function Stage({ children, label }) {
  return (
    <svg viewBox="0 0 320 200" className="w-full h-auto" role="img" aria-label={label}>
      {children}
    </svg>
  );
}

// A teaspoon heaped with sugar: handle, bowl, the pink heap on top.
function Spoon({ x, y, delay }) {
  return (
    <g className="bs-drop" style={{ animationDelay: `${delay}ms` }}>
      <rect x={x + 14} y={y - 2.5} width="34" height="5" rx="2.5" fill={LINE} />
      <ellipse cx={x} cy={y} rx="17" ry="11" fill="var(--bg-card)" stroke={LINE} strokeWidth="2" />
      <path d={`M${x - 13} ${y - 1} q13 -16 26 0 z`} fill={SUGAR} />
      {[-6, 0, 6].map((dx) => <circle key={dx} cx={x + dx} cy={y - 5} r="1.4" fill="#fff" fillOpacity="0.7" />)}
    </g>
  );
}

/** 1. This serving's sugar, as the teaspoons it adds up to. */
export function ServingScene({ teaspoons, label, t }) {
  const n = Math.max(1, Math.min(8, Math.round(teaspoons)));
  const perRow = Math.min(4, n);
  const rows = Math.ceil(n / perRow);
  return (
    <Stage label={label}>
      {Array.from({ length: n }, (_, i) => {
        const row = Math.floor(i / perRow);
        const inRow = Math.min(perRow, n - row * perRow);
        const col = i % perRow;
        const x = 160 - ((inRow - 1) * 70) / 2 + col * 70 - 14;
        const y = 95 - ((rows - 1) * 46) / 2 + row * 46;
        return <Spoon key={i} x={x} y={y} delay={i * 260} />;
      })}
      <text x="160" y="190" textAnchor="middle" fontSize="15" fontWeight="800" fill={SUGAR}>{t('bsLblTsp', { tsp: Math.round(teaspoons * 10) / 10 })}</text>
    </Stage>
  );
}

/** 2. Sugar crystals break down into glucose, which goes into the blood. */
export function DigestScene({ label, t }) {
  const crystals = [[70, 70], [95, 95], [60, 110], [100, 60]];
  return (
    <Stage label={label}>
      {/* the blood vessel */}
      <rect x="150" y="90" width="160" height="34" rx="17" fill={BLOOD} fillOpacity="0.12" stroke={BLOOD} strokeOpacity="0.5" />
      <text x="230" y="146" textAnchor="middle" fontSize="11" fill={BLOOD}>{t('bsLblBlood')}</text>
      {crystals.map(([x, y], i) => (
        <rect key={i} className="bs-split" x={x} y={y} width="18" height="18" rx="3" fill={SUGAR} transform={`rotate(20 ${x + 9} ${y + 9})`} style={{ animationDelay: `${1100 + i * 120}ms` }} />
      ))}
      {Array.from({ length: 7 }, (_, i) => (
        <g key={i} className="bs-pop" style={{ animationDelay: `${1500 + i * 120}ms` }}>
          <circle className="bs-flow" cx={150 + (i % 2) * 6} cy={100 + (i % 3) * 7} r="5" fill={GLUCOSE} style={{ '--bs-dx': '150px', animationDelay: `${1800 + i * 330}ms` }} />
        </g>
      ))}
      <text x="85" y="150" textAnchor="middle" fontSize="11" fill={SUGAR}>{t('bsLblSugar')}</text>
      <text x="85" y="166" textAnchor="middle" fontSize="11" fill={GLUCOSE}>→ {t('bsLblGlucose')}</text>
    </Stage>
  );
}

function Key({ x, y, delay, fx, fy }) {
  return (
    <g className="bs-float" style={{ animationDelay: `${delay}ms`, '--bs-fx': `${fx}px`, '--bs-fy': `${fy}px` }}>
      <circle cx={x} cy={y} r="5" fill="none" stroke={INSULIN} strokeWidth="2.5" />
      <path d={`M${x + 5} ${y} h11 m-4 0 v4 m-4 -4 v3`} stroke={INSULIN} strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </g>
  );
}

/** 3. After eating, blood glucose goes up; the pancreas makes insulin. */
export function RiseScene({ label, t }) {
  return (
    <Stage label={label}>
      {/* blood glucose meter */}
      <rect x="45" y="30" width="34" height="130" rx="17" fill="var(--fill)" />
      <rect className="bs-rise" x="45" y="50" width="34" height="110" rx="17" fill={GLUCOSE} />
      <text x="62" y="182" textAnchor="middle" fontSize="11" fill={GLUCOSE}>{t('bsLblBloodGlucose')} ↑</text>
      {/* pancreas */}
      <path className="bs-glow" d="M150 105 q35 -38 95 -14 q30 12 32 30 q-40 22 -86 4 q-30 -10 -41 -20z" fill={INSULIN} fillOpacity="0.35" style={{ animationDelay: '1.2s' }} />
      <path d="M150 105 q35 -38 95 -14 q30 12 32 30 q-40 22 -86 4 q-30 -10 -41 -20z" fill="none" stroke={INSULIN} strokeWidth="2" />
      <text x="215" y="152" textAnchor="middle" fontSize="11" fill={INSULIN}>{t('bsLblPancreas')}</text>
      {[0, 1, 2].map((i) => <Key key={i} x={200 + i * 14} y={96} delay={1500 + i * 350} fx={-40 - i * 20} fy={-50 + i * 6} />)}
    </Stage>
  );
}

/** 4. Insulin helps glucose move from the blood into cells, for energy. */
export function CellsScene({ label, t }) {
  const cells = [70, 160, 250];
  return (
    <Stage label={label}>
      <rect x="10" y="30" width="300" height="34" rx="17" fill={BLOOD} fillOpacity="0.12" stroke={BLOOD} strokeOpacity="0.5" />
      {cells.map((cx, i) => (
        <g key={cx}>
          <circle cx={cx} cy="140" r="34" fill={CELL} fillOpacity="0.15" stroke={CELL} strokeWidth="2" />
          <circle className="bs-light" cx={cx} cy="140" r="34" fill={GLUCOSE} fillOpacity="0" style={{ animationDelay: `${1600 + i * 300}ms` }} />
          <circle className="bs-enter" cx={cx} cy="47" r="5" fill={GLUCOSE} style={{ '--bs-ey': '93px', animationDelay: `${600 + i * 300}ms` }} />
          <text x={cx} y="146" textAnchor="middle" fontSize="18" className="bs-pop" style={{ animationDelay: `${2000 + i * 300}ms` }}>⚡</text>
        </g>
      ))}
      <text x="160" y="196" textAnchor="middle" fontSize="11" fill={CELL}>{t('bsLblCells')}</text>
    </Stage>
  );
}

/** 5. Plaque on a tooth turns free sugars into acids. */
export function TeethScene({ label, t }) {
  return (
    <Stage label={label}>
      <path d="M115 40 q45 -24 90 0 q14 30 -4 70 q-8 50 -20 60 q-8 6 -12 -12 q-6 -30 -14 -30 q-8 0 -14 30 q-4 18 -12 12 q-12 -10 -20 -60 q-18 -40 6 -70z" fill="#fff" stroke={LINE} strokeWidth="2.5" />
      <path className="bs-darken" d="M130 52 q30 -12 60 0 q6 18 -2 34 q-28 8 -56 0 q-8 -16 -2 -34z" fill="#d4a95f" fillOpacity="0" />
      {[[138, 60], [168, 54], [185, 72]].map(([x, y], i) => (
        <g key={i} className="bs-wobble" style={{ animationDelay: `${i * 150}ms` }}>
          <circle cx={x} cy={y} r="8" fill={CELL} fillOpacity="0.85" />
          <circle cx={x - 2} cy={y - 2} r="1.5" fill="#064e3b" /><circle cx={x + 3} cy={y - 2} r="1.5" fill="#064e3b" />
        </g>
      ))}
      {[[90, 40], [240, 50], [230, 90]].map(([x, y], i) => (
        <rect key={i} className="bs-enter" x={x} y={y} width="9" height="9" rx="2" fill={SUGAR} style={{ '--bs-ex': `${165 - x}px`, '--bs-ey': `${62 - y}px`, animationDelay: `${300 + i * 400}ms` }} />
      ))}
      {[150, 172].map((x, i) => (
        <path key={x} className="bs-drip" d={`M${x} 92 q4 7 0 11 q-4 -4 0 -11z`} fill="#84cc16" style={{ animationDelay: `${1200 + i * 500}ms` }} />
      ))}
      <text x="160" y="196" textAnchor="middle" fontSize="11" fill="#65a30d">{t('bsLblPlaque')}</text>
    </Stage>
  );
}

/** 6. WHO's 25 g (6 teaspoons) a day, and this serving's share of it. */
export function LimitScene({ grams, label, t }) {
  const share = Math.min(1, grams / 25);
  return (
    <Stage label={label}>
      <text x="160" y="40" textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--label-2)">{t('bsLblWhoLimit')}</text>
      <rect x="30" y="62" width="260" height="38" rx="19" fill="var(--fill)" />
      <rect className="bs-fill" x="30" y="62" width={Math.max(38, 260 * share)} height="38" rx="19" fill={SUGAR} />
      {Array.from({ length: 5 }, (_, i) => <line key={i} x1={30 + (260 / 6) * (i + 1)} y1="62" x2={30 + (260 / 6) * (i + 1)} y2="100" stroke="var(--bg-card)" strokeWidth="2" />)}
      <text x="160" y="140" textAnchor="middle" fontSize="28" fontWeight="800" fill={SUGAR}>{Math.round(share * 100)}%</text>
      <text x="160" y="164" textAnchor="middle" fontSize="12" fill="var(--label-2)">{t('bsLblShare', { grams: Math.round(grams * 10) / 10 })}</text>
    </Stage>
  );
}
