/**
 * Adaptive / boundary-focused preflop EV regeneration.
 *
 * 1) Screen: use existing js/preflop-ev.js (or run moderate flopSamples)
 * 2) Escalate hands with |raise4-check| < delta OR Wizard chart-boundary list
 * 3) Re-run escalate set at heavy flopSamples (default 2000)
 * 4) Merge preferring higher flops (preserves K4o @ 19600)
 * 5) Optionally bump index.html cache-bust
 *
 * Usage:
 *   node scripts/adaptive-preflop-ev.js
 *   node scripts/adaptive-preflop-ev.js --screen=160 --escalate=2000 --workers=8
 *   node scripts/adaptive-preflop-ev.js --skip-screen --escalate=2000
 *   node scripts/adaptive-preflop-ev.js --merge-only --bump
 *   node scripts/adaptive-preflop-ev.js --plan   (print escalate set, no compute)
 *
 * Resume after interrupt:
 *   node scripts/adaptive-preflop-ev.js --merge-only --bump
 *   # or re-run; already-heavy hands (flops >= escalate) are skipped
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const root = path.join(__dirname, "..");
const scriptsDir = __dirname;
const tablePath = path.join(root, "js", "preflop-ev.js");
const escalateListPath = path.join(scriptsDir, "adaptive-escalate-hands.json");

/** Chart edges + known sparse disagreements (Wizard vs EV). */
const WIZARD_BOUNDARY = [
  "K5o",
  "K4o",
  "K3o",
  "K2s",
  "K2o",
  "Q8o",
  "Q7o",
  "Q6s",
  "Q5s",
  "Q4s",
  "JTo",
  "J9o",
  "J8s",
  "J7s",
  "22",
  "33",
  // nearby neighbors
  "K6o",
  "K5s",
  "K4s",
  "K3s",
  "Q9o",
  "Q8s",
  "Q7s",
  "Q6o",
  "Q5o",
  "Q4o",
  "Q3s",
  "JTs",
  "J9s",
  "J8o",
  "J7o",
  "J6s",
  "T9s",
  "T8s",
];

function parseArgs(argv) {
  const opts = {
    screen: 160,
    escalate: 2000,
    delta: 0.08,
    workers: Math.max(1, os.cpus().length),
    skipScreen: false,
    mergeOnly: false,
    bump: true,
    plan: false,
    forceEscalate: false,
  };
  for (const a of argv) {
    if (a === "--skip-screen") opts.skipScreen = true;
    else if (a === "--merge-only") opts.mergeOnly = true;
    else if (a === "--plan") opts.plan = true;
    else if (a === "--bump") opts.bump = true;
    else if (a === "--no-bump") opts.bump = false;
    else if (a === "--force-escalate") opts.forceEscalate = true;
    else if (a.startsWith("--screen=")) opts.screen = Number(a.slice(9));
    else if (a.startsWith("--escalate=")) opts.escalate = Number(a.slice(11));
    else if (a.startsWith("--delta=")) opts.delta = Number(a.slice(8));
    else if (a.startsWith("--workers=")) opts.workers = Number(a.slice(10));
  }
  return opts;
}

function loadTableJs(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const marker = "UTHPreflopEv = ";
  const start = raw.indexOf(marker);
  if (start < 0) throw new Error(`no UTHPreflopEv in ${filePath}`);
  const jsonStart = raw.indexOf("{", start);
  const end = raw.indexOf("};", jsonStart);
  return JSON.parse(raw.slice(jsonStart, end + 1));
}

function writeTableJs(filePath, table) {
  const body =
    "/** Precomputed sequential combinatorial preflop EVs (ante units) for all 169 hands. */\n" +
    "(function () {\n" +
    "window.UTHPreflopEv = " +
    JSON.stringify(table) +
    ";\n" +
    "})();\n";
  fs.writeFileSync(filePath, body);
}

function mergePreferHigherFlops(base, incoming) {
  for (const [k, v] of Object.entries(incoming)) {
    const prev = base[k];
    const nextFlops = v.flops || 0;
    const prevFlops = prev ? prev.flops || 0 : -1;
    // Keep heavier samples (e.g. K4o @ 19600 over a 2000 re-run).
    if (!prev || nextFlops > prevFlops) base[k] = v;
    else if (nextFlops === prevFlops) base[k] = v;
  }
}

function selectEscalate(table, delta) {
  const set = new Set(WIZARD_BOUNDARY);
  for (const [key, row] of Object.entries(table)) {
    const d = Math.abs(row.raise4 - row.check);
    if (d < delta) set.add(key);
  }
  return [...set].sort();
}

function runNode(args, label) {
  return new Promise((resolve, reject) => {
    console.error(`[spawn] ${label}: node ${args.join(" ")}`);
    const child = spawn(process.execPath, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stderr = "";
    child.stdout.on("data", (buf) => {
      // generator prints JSON on stdout; keep quiet unless tiny
    });
    child.stderr.on("data", (buf) => {
      const s = buf.toString();
      stderr += s;
      process.stderr.write(s);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${label} exited ${code}\n${stderr.slice(-2000)}`));
      } else resolve();
    });
  });
}

async function runShardedGenerate(flopSamples, hands, workers, tag) {
  if (!hands.length) {
    console.error(`[${tag}] nothing to generate`);
    return;
  }
  const listFile = path.join(scriptsDir, `adaptive-hands-${tag}.json`);
  fs.writeFileSync(listFile, JSON.stringify({ hands }, null, 2));
  const n = Math.min(workers, hands.length);
  console.error(`[${tag}] ${hands.length} hands @ ${flopSamples} flops, ${n} workers`);
  const jobs = [];
  for (let i = 0; i < n; i++) {
    jobs.push(
      runNode(
        [
          path.join(scriptsDir, "generate-preflop-ev.js"),
          String(flopSamples),
          String(i),
          String(n),
          listFile,
        ],
        `${tag}-w${i}`
      )
    );
  }
  await Promise.all(jobs);
}

function collectPartFiles() {
  return fs
    .readdirSync(scriptsDir)
    .filter((f) => /^preflop-ev-part-\d+\.json$/.test(f) || /^preflop-ev-[A-Za-z0-9]+\.json$/.test(f))
    .sort();
}

function mergeAllIntoTable(base) {
  const merged = { ...base };
  for (const f of collectPartFiles()) {
    const data = JSON.parse(fs.readFileSync(path.join(scriptsDir, f), "utf8"));
    mergePreferHigherFlops(merged, data);
    console.error(`merged ${f} (${Object.keys(data).join(",")})`);
  }
  return merged;
}

function bumpIndexCache() {
  const indexPath = path.join(root, "index.html");
  let html = fs.readFileSync(indexPath, "utf8");
  const next = html.replace(/preflop-ev\.js\?v=\d+/, (m) => {
    const n = Number(m.match(/v=(\d+)/)[1]) + 1;
    return `preflop-ev.js?v=${n}`;
  });
  if (next === html) {
    console.warn("Could not bump preflop-ev.js?v= in index.html");
    return null;
  }
  fs.writeFileSync(indexPath, next);
  return next.match(/preflop-ev\.js\?v=(\d+)/)[1];
}

function flopDist(table) {
  const d = {};
  for (const v of Object.values(table)) {
    const f = v.flops || 0;
    d[f] = (d[f] || 0) + 1;
  }
  return d;
}

function wizardAct(key) {
  if (key.length === 2) {
    const r =
      key[0] === "A"
        ? 14
        : key[0] === "K"
          ? 13
          : key[0] === "Q"
            ? 12
            : key[0] === "J"
              ? 11
              : key[0] === "T"
                ? 10
                : +key[0];
    return r >= 3 ? "raise4" : "check";
  }
  const hi = key[0];
  const lo = key[1];
  const suited = key[2] === "s";
  const hr =
    hi === "A" ? 14 : hi === "K" ? 13 : hi === "Q" ? 12 : hi === "J" ? 11 : hi === "T" ? 10 : +hi;
  const lr =
    lo === "A" ? 14 : lo === "K" ? 13 : lo === "Q" ? 12 : lo === "J" ? 11 : lo === "T" ? 10 : +lo;
  if (hr === 14) return "raise4";
  if (suited) {
    if (hr === 13) return "raise4";
    if (hr === 12 && lr >= 6) return "raise4";
    if (hr === 11 && lr >= 8) return "raise4";
  } else {
    if (hr === 13 && lr >= 5) return "raise4";
    if (hr === 12 && lr >= 8) return "raise4";
    if (hr === 11 && lr === 10) return "raise4";
  }
  return "check";
}

function reportDisagreements(table) {
  const rows = [];
  for (const [key, row] of Object.entries(table)) {
    const evAct = row.raise4 >= row.check ? "raise4" : "check";
    const wiz = wizardAct(key);
    if (wiz !== evAct) {
      rows.push({
        key,
        wiz,
        ev: evAct,
        delta: Math.abs(row.raise4 - row.check),
        flops: row.flops,
      });
    }
  }
  rows.sort((a, b) => a.delta - b.delta);
  return rows;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.error("adaptive-preflop-ev options", opts);

  if (opts.mergeOnly) {
    if (!fs.existsSync(tablePath)) {
      console.error("Missing", tablePath);
      process.exit(1);
    }
    const base = loadTableJs(tablePath);
    const merged = mergeAllIntoTable(base);
    if (Object.keys(merged).length !== 169) {
      console.error(`Expected 169 hands, got ${Object.keys(merged).length}`);
      process.exit(1);
    }
    writeTableJs(tablePath, merged);
    console.error("Wrote", tablePath, "flops", flopDist(merged));
    if (opts.bump) {
      const v = bumpIndexCache();
      if (v) console.error("Bumped index.html to v=" + v);
    }
    const disagree = reportDisagreements(merged);
    console.error(`Wizard vs EV disagreements: ${disagree.length}`);
    for (const r of disagree) {
      console.error(
        `  ${r.key} wiz=${r.wiz} ev=${r.ev} |Δ|=${r.delta.toFixed(4)} flops=${r.flops}`
      );
    }
    return;
  }

  let table = fs.existsSync(tablePath) ? loadTableJs(tablePath) : {};

  if (Object.keys(table).length !== 169) {
    if (opts.skipScreen) {
      console.error("Table incomplete and --skip-screen set; aborting");
      process.exit(1);
    }
    console.error(`Screen: generating all 169 @ ${opts.screen}`);
    const n = opts.workers;
    const jobs = [];
    for (let i = 0; i < n; i++) {
      jobs.push(
        runNode(
          [
            path.join(scriptsDir, "generate-preflop-ev.js"),
            String(opts.screen),
            String(i),
            String(n),
          ],
          `screen-w${i}`
        )
      );
    }
    await Promise.all(jobs);
    table = mergeAllIntoTable({});
    writeTableJs(tablePath, table);
  } else if (opts.skipScreen || opts.plan) {
    console.error(
      `Screen: using existing table as-is (flops ${JSON.stringify(flopDist(table))})`
    );
  } else {
    const needScreen = Object.entries(table)
      .filter(([, row]) => (row.flops || 0) < opts.screen)
      .map(([k]) => k)
      .sort();
    if (needScreen.length) {
      console.error(
        `Screen: upgrading ${needScreen.length} hands <${opts.screen} → ${opts.screen}`
      );
      await runShardedGenerate(opts.screen, needScreen, opts.workers, "screen");
      table = mergeAllIntoTable(table);
      writeTableJs(tablePath, table);
    } else {
      console.error(`Screen: all hands already >= ${opts.screen}`);
    }
  }

  const escalateAll = selectEscalate(table, opts.delta);
  const escalateNeed = escalateAll.filter((k) => {
    const flops = table[k]?.flops || 0;
    if (opts.forceEscalate) return true;
    return flops < opts.escalate;
  });

  fs.writeFileSync(
    escalateListPath,
    JSON.stringify(
      {
        delta: opts.delta,
        escalateSamples: opts.escalate,
        boundary: WIZARD_BOUNDARY,
        all: escalateAll,
        need: escalateNeed,
        skippedAlreadyHeavy: escalateAll.filter((k) => !escalateNeed.includes(k)),
      },
      null,
      2
    )
  );
  console.error(`Escalate candidates: ${escalateAll.length}`);
  console.error(`  need @${opts.escalate}: ${escalateNeed.length} → ${escalateNeed.join(", ")}`);
  console.error(
    `  already heavy: ${escalateAll.filter((k) => !escalateNeed.includes(k)).join(", ") || "(none)"}`
  );

  if (opts.plan) {
    console.log(JSON.stringify({ escalateAll, escalateNeed }, null, 2));
    return;
  }

  if (escalateNeed.length) {
    // Clear stale part files so merge doesn't confuse, but keep K4o json
    for (const f of fs.readdirSync(scriptsDir)) {
      if (/^preflop-ev-part-\d+\.json$/.test(f)) {
        fs.unlinkSync(path.join(scriptsDir, f));
      }
    }
    await runShardedGenerate(opts.escalate, escalateNeed, opts.workers, "escalate");
  } else {
    console.error("Escalate: nothing to do");
  }

  table = mergeAllIntoTable(table);
  if (Object.keys(table).length !== 169) {
    console.error(`Expected 169 after merge, got ${Object.keys(table).length}`);
    process.exit(1);
  }
  writeTableJs(tablePath, table);
  console.error("Wrote", tablePath, "flops", flopDist(table));

  if (opts.bump) {
    const v = bumpIndexCache();
    if (v) console.error("Bumped index.html to v=" + v);
  }

  const disagree = reportDisagreements(table);
  console.error(`Wizard vs EV disagreements: ${disagree.length}`);
  for (const r of disagree) {
    console.error(`  ${r.key} wiz=${r.wiz} ev=${r.ev} |Δ|=${r.delta.toFixed(4)} flops=${r.flops}`);
  }
  console.error("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
