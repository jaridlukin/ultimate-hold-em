const fs = require("fs");
const path = require("path");

let raw = fs.readFileSync(path.join(__dirname, "..", "js", "preflop-ev.js"), "utf8");
const marker = '{"22":';
const start = raw.indexOf(marker);
if (start < 0) throw new Error("could not find table JSON");
const end = raw.indexOf("};", start);
const table = JSON.parse(raw.slice(start, end + 1));

function mergePreferHigherFlops(base, incoming) {
  for (const [k, v] of Object.entries(incoming)) {
    const prev = base[k];
    const nextFlops = v.flops || 0;
    const prevFlops = prev ? prev.flops || 0 : -1;
    if (!prev || nextFlops >= prevFlops) base[k] = v;
  }
}

const scriptsDir = __dirname;
for (const f of fs.readdirSync(scriptsDir)) {
  if (!/^preflop-ev-[A-Za-z0-9]+\.json$/.test(f)) continue;
  const part = JSON.parse(fs.readFileSync(path.join(scriptsDir, f), "utf8"));
  mergePreferHigherFlops(table, part);
  console.log("merged", Object.keys(part).join(","));
}

if (Object.keys(table).length !== 169) {
  console.error("expected 169 hands, got", Object.keys(table).length);
}

const outPath = path.join(__dirname, "..", "js", "preflop-ev.js");
const out = [
  "/** Precomputed sequential combinatorial preflop EVs (ante units) for all 169 hands. */",
  "(function () {",
  "window.UTHPreflopEv = " + JSON.stringify(table) + ";",
  "})();",
  "",
].join("\n");
fs.writeFileSync(outPath, out);
console.log("Wrote", outPath);

global.window = {};
require(outPath);
const j = window.UTHPreflopEv.JTo;
console.log(
  "JTo",
  j.raise4 >= j.check ? "raise4" : "check",
  "r4",
  j.raise4.toFixed(4),
  "ch",
  j.check.toFixed(4),
  "flops",
  j.flops
);
