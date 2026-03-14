/**
 * Strategy loader — dynamically discovers and validates strategy modules.
 */

const fs = require('fs');
const path = require('path');

const strategiesDir = __dirname;
const strategies = new Map();

// Load all .js files in this directory except index.js
const files = fs.readdirSync(strategiesDir).filter(f => f.endsWith('.js') && f !== 'index.js');

for (const file of files) {
  const mod = require(path.join(strategiesDir, file));

  // Validate interface
  if (!mod.name || !mod.label || typeof mod.evaluate !== 'function' || !Array.isArray(mod.indicators)) {
    console.warn(`  Strategy ${file} missing required exports (name, label, evaluate, indicators) — skipping`);
    continue;
  }

  strategies.set(mod.name, mod);
}

function getStrategy(name) {
  const s = strategies.get(name);
  if (!s) {
    const available = [...strategies.keys()].join(', ');
    console.error(`  Unknown strategy: "${name}"\n  Available: ${available}`);
    process.exit(1);
  }
  return s;
}

function getAllStrategies() {
  return [...strategies.values()];
}

function listStrategies() {
  console.log('\n  Available strategies:\n');
  for (const s of strategies.values()) {
    const regime = s.useRegimeFilter ? 'yes' : 'no';
    console.log(`    ${s.name.padEnd(26)} ${s.label}`);
    console.log(`    ${''.padEnd(26)} ${s.description}`);
    console.log(`    ${''.padEnd(26)} Indicators: ${s.indicators.join(', ')} | Regime: ${regime}`);
    if (s.tradeParams) {
      const tp = s.tradeParams;
      const parts = [];
      if (tp.threshold != null) parts.push(`threshold=${tp.threshold}`);
      if (tp.tp1RR != null) parts.push(`TP1=${tp.tp1RR}R`);
      if (tp.tp2RR != null) parts.push(`TP2=${tp.tp2RR > 0 ? tp.tp2RR + 'R' : 'off'}`);
      if (tp.maxBars != null) parts.push(`maxBars=${tp.maxBars}`);
      if (parts.length) console.log(`    ${''.padEnd(26)} Params: ${parts.join(', ')}`);
    }
    console.log('');
  }
}

module.exports = { getStrategy, getAllStrategies, listStrategies };
