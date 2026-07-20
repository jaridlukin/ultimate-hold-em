/**
 * Merge worker JSON parts (and optional hand JSON shards) into js/preflop-ev.js.
 * Prefer higher `flops` per hand so full/heavy results are not overwritten by lighter runs.
 *
 * Usage:
 *   node scripts/merge-preflop-ev.js
 *   node scripts/merge-preflop-ev.js --parts-only
 *   node scripts/merge-preflop-ev.js --bump
 */
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const root = path.join(dir, "..");
const args = new Set(process.argv.slice(2));
const partsOnly = args.has("--parts-only");
const bump = args.has("--bump");

function loadTableJs(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const marker = "UTHPreflopEv = ";
  const start = raw.indexOf(marker);
  if (start < 0) throw new Error(`no UTHPreflopEv in ${filePath}`);
  const jsonStart = raw.indexOf("{", start);
  const end = raw.indexOf("};", jsonStart);
  return JSON.parse(raw.slice(jsonStart, end + 1));
}

function mergePreferHigherFlops(base, incoming, label) {
  let kept = 0;
  let replaced = 0;
  let skipped = 0;
  for (const [k, v] of Object.entries(incoming)) {
    const prev = base[k];
    const nextFlops = v.flops || 0;
    const prevFlops = prev ? prev.flops || 0 : -1;
    if (!prev || nextFlops > prevFlops) {
      base[k] = v;
      if (prev) replaced++;
      else kept++;
    } else if (nextFlops === prevFlops) {
      base[k] = v;
      replaced++;
    } else {
      skipped++;
    }
  }
  if (label) {
    console.log(
      `${label}: +${kept} new, ${replaced} replaced, ${skipped} kept-heavier (incoming flops lower)`
    );
  }
}

const outPath = path.join(root, "js", "preflop-ev.js");
const merged = partsOnly || !fs.existsSync(outPath) ? {} : loadTableJs(outPath);

const partRe = /^preflop-ev-part-\d+\.json$/;
const handRe = /^preflop-ev-[A-Za-z0-9]+\.json$/;
const files = fs
  .readdirSync(dir)
  .filter((f) => partRe.test(f) || (!partsOnly && handRe.test(f)))
  .sort();

if (!files.length && partsOnly) {
  console.error("No preflop-ev-part-*.json files found");
  process.exit(1);
}

for (const f of files) {
  const data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  mergePreferHigherFlops(merged, data, f);
}

const keys = Object.keys(merged);
if (keys.length !== 169) {
  console.error(`Expected 169 hands, got ${keys.length}`);
  process.exit(1);
}

const body =
  "/** Precomputed sequential combinatorial preflop EVs (ante units) for all 169 hands. */\n" +
  "(function () {\n" +
  "window.UTHPreflopEv = " +
  JSON.stringify(merged) +
  ";\n" +
  "})();\n";
fs.writeFileSync(outPath, body);
console.log("Wrote", outPath, "with", keys.length, "hands");

const flopCounts = {};
for (const v of Object.values(merged)) {
  const f = v.flops || 0;
  flopCounts[f] = (flopCounts[f] || 0) + 1;
}
console.log("flop distribution", flopCounts);

if (bump) {
  const indexPath = path.join(root, "index.html");
  let html = fs.readFileSync(indexPath, "utf8");
  const next = html.replace(/preflop-ev\.js\?v=\d+/, (m) => {
    const n = Number(m.match(/v=(\d+)/)[1]) + 1;
    return `preflop-ev.js?v=${n}`;
  });
  if (next === html) {
    console.warn("Could not bump preflop-ev.js?v= in index.html");
  } else {
    fs.writeFileSync(indexPath, next);
    const ver = next.match(/preflop-ev\.js\?v=(\d+)/)[1];
    console.log("Bumped index.html cache-bust to v=" + ver);
  }
}
