// src/components/NutritionTrafficLight.jsx
//
// Four coloured tiles -- fat, saturated fat, sugars, salt -- each Low /
// Medium / High by the UK front-of-pack levels (see trafficLight.js), so
// the nutrition panel reads at a glance before anyone looks at a number.
// The word is always shown next to the colour: colour alone would fail
// colour-blind users.
const LEVEL_LOOK = {
  low: { color: 'var(--v-good)', bg: 'var(--v-good-bg)', key: 'tlLow' },
  medium: { color: 'var(--v-moderate)', bg: 'var(--v-moderate-bg)', key: 'tlMedium' },
  high: { color: 'var(--v-very-poor)', bg: 'var(--v-very-poor-bg)', key: 'tlHigh' },
};
const LABEL_KEY = { fat: 'tlFat', satFat: 'tlSatFat', sugars: 'tlSugars', salt: 'tlSalt' };

// The levels are always per 100g/100ml (the scheme's own basis), while the
// numbers under them on the Result page can be per serving -- so this block
// says its basis ABOVE the tiles, and when a real serving is known each tile
// also shows what that serving holds ("8g in 20g"), tying the two together.
const inServing = (grams, servingGrams) => {
  const v = Math.round(((grams * servingGrams) / 100) * 10) / 10;
  return v === 0 && grams > 0 ? '<0.1' : String(v);
};

export default function NutritionTrafficLight({ light, t, servingGrams, servingUnit = 'g' }) {
  const showServing = typeof servingGrams === 'number' && servingGrams > 0 && servingGrams !== 100;
  return (
    <div className="mb-3.5">
      <p className="text-[12px] font-semibold mb-2" style={{ color: 'var(--label-2)' }}>
        {t(light.isDrink ? 'tlBasisDrink' : 'tlBasisFood')}
      </p>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${light.items.length}, minmax(0, 1fr))` }}>
        {light.items.map((item, i) => {
          const look = LEVEL_LOOK[item.level];
          return (
            <div
              key={item.key}
              className="item-in rounded-xl px-1.5 py-2 text-center"
              style={{ background: look.bg, animationDelay: `${i * 80}ms` }}
            >
              <p className="text-[11px] font-semibold truncate" style={{ color: 'var(--label-2)' }}>{t(LABEL_KEY[item.key])}</p>
              <p className="text-[16px] font-extrabold tabular-nums leading-tight mt-0.5" style={{ color: 'var(--label-1)' }}>{item.grams}g</p>
              {showServing && (
                <p className="text-[10px] tabular-nums leading-tight mt-0.5" style={{ color: 'var(--label-3)' }}>
                  {t('tlInServing', { amount: inServing(item.grams, servingGrams), serving: servingGrams, unit: servingUnit })}
                </p>
              )}
              <p className="text-[10.5px] font-bold uppercase tracking-wide mt-0.5" style={{ color: look.color }}>{t(look.key)}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
