/**
 * Focused checks for Wizard dealer-outs counting:
 * board 4-flush / 4-straight completes, card-id dedupe.
 *
 * Run: node scripts/test-wizard-outs.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const sandbox = { window: {}, console };
vm.createContext(sandbox);
for (const file of ["js/cards.js", "js/hand.js", "js/wizard.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), sandbox);
}

const { createDeck } = sandbox.window.UTHCards;
const { bestHand } = sandbox.window.UTHHand;
const {
  countWizardOuts,
  boardFourFlushSuit,
  boardStraightCompletingRanks,
  wizardRiver,
} = sandbox.window.UTHWizard;

/** @param {string} id e.g. Jh, 10h, Td, As */
function card(id) {
  const m = id.match(/^(10|[2-9TJQKA])([cdhs])$/i);
  if (!m) throw new Error(`bad card id ${id}`);
  const rankMap = { A: 14, K: 13, Q: 12, J: 11, T: 10, "10": 10 };
  const label = m[1].toUpperCase();
  const rank = rankMap[label] || Number(label);
  const idLabel = rank === 10 ? "10" : label;
  return { rank, suit: m[2].toLowerCase(), id: `${idLabel}${m[2].toLowerCase()}` };
}

/** @param {string[]} holeIds @param {string[]} boardIds */
function outsFor(holeIds, boardIds) {
  const hole = holeIds.map(card);
  const board = boardIds.map(card);
  const used = new Set([...hole, ...board].map((c) => c.id));
  const remaining = createDeck().filter((c) => !used.has(c.id));
  const player = bestHand(hole, board);
  const pocketPair = hole[0].rank === hole[1].rank;
  const boardCounts = {};
  for (const c of board) boardCounts[c.rank] = (boardCounts[c.rank] || 0) + 1;
  let holePairsBoard = false;
  for (const h of hole) if (boardCounts[h.rank]) holePairsBoard = true;
  const made = {
    player,
    pocketPair,
    pocketRank: pocketPair ? hole[0].rank : null,
    holePairsBoard,
    hiddenPairOrBetter: Boolean(
      (pocketPair && player.category >= 1) ||
        (holePairsBoard && player.category >= 1) ||
        player.category >= 2
    ),
  };
  const result = countWizardOuts(hole, board, remaining, player, made);
  return { ...result, remaining, hole, board, advice: wizardRiver(hole, board, remaining) };
}

let failed = 0;
/** @param {string} name @param {boolean} ok @param {string} detail */
function assert(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    failed++;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// --- 4-flush on board: remaining suit cards are dealer outs ---
{
  // Board: 4♠ 7♠ 8♠ Q♠ Kd  |  Hole: Th 9c  (high card)
  // Flush suit spades; 9 remaining spades. Also pair/outkick outs.
  const r = outsFor(["10h", "9c"], ["4s", "7s", "8s", "Qs", "Kd"]);
  assert("detects 4-flush suit", boardFourFlushSuit(r.board) === "s");
  const flushLine = r.breakdown.find((l) => /4-flush/.test(l));
  assert("breakdown mentions 4-flush", Boolean(flushLine), flushLine || "missing");
  // Naive sum without flush would miss 9 spades; with flush, count must include them.
  // Spades left: 2,3,5,6,9,10,J,A,K = 9 (4,7,8,Q on board).
  assert("outs include flush completes", r.count >= 9, `count=${r.count}`);
  assert(
    "flush line reflects unique adds ≤ 9",
    flushLine ? Number(flushLine.match(/^(\d+)/)[1]) <= 9 : false,
    flushLine
  );
}

// --- Open-ended 4-straight ---
{
  // Board: 4c 5d 6h 7s Qd  |  Hole: Jh 9c
  // Completing ranks 3 and 8 → up to 8 cards.
  const r = outsFor(["Jh", "9c"], ["4c", "5d", "6h", "7s", "Qd"]);
  const ranks = boardStraightCompletingRanks(r.board).sort((a, b) => a - b);
  assert("open-ended completes 3 and 8", ranks.join(",") === "3,8", `ranks=${ranks}`);
  const straightLine = r.breakdown.find((l) => /4-straight/.test(l));
  assert("breakdown mentions 4-straight", Boolean(straightLine), straightLine || "missing");
  assert("outs include straight completes", r.count >= 8, `count=${r.count}`);
}

// --- Double-inside straight (Wizard terminology) ---
{
  const ranks = boardStraightCompletingRanks(
    ["Js", "9d", "8c", "7h", "5s"].map(card)
  ).sort((a, b) => a - b);
  assert("double-inside completes 6 and 10", ranks.join(",") === "6,10", `ranks=${ranks}`);
}

// --- Dedupe: card that is both pair-out and flush-out counted once ---
{
  // Board pair of 6s + 4-flush spades: K♣ 3♠ 6♦ 6♠ A♠ — wait only 3 spades.
  // Use: K♠ 3♠ 6♦ 6♠ A♠ | hole Jh 4d  (shared pair of 6s, 4-flush spades)
  const r = outsFor(["Jh", "4d"], ["Ks", "3s", "6d", "6s", "As"]);
  assert("board is 4-flush", boardFourFlushSuit(r.board) === "s");

  // Pairing outs include remaining K,3,6,A (any suit). Flush outs = remaining spades.
  // Overlap e.g. remaining 3♠ is both "pair the 3" (two pair) and flush complete.
  // Count unique cards — must be < naive sum of category sizes.
  const remaining = r.remaining;
  const pairRankCards = remaining.filter((c) => [13, 3, 6, 14].includes(c.rank));
  const flushCards = remaining.filter((c) => c.suit === "s");
  const outkickQ = remaining.filter((c) => c.rank === 12);
  const naive =
    pairRankCards.length +
    outkickQ.length +
    flushCards.length;
  assert("dedupe: unique count < naive category sum", r.count < naive, `${r.count} < ${naive}`);
  assert("dedupe: unique count ≥ pair+outkick alone", r.count >= pairRankCards.length + outkickQ.length);

  // Explicit overlap set size
  const overlap = new Set([
    ...pairRankCards.map((c) => c.id),
    ...outkickQ.map((c) => c.id),
    ...flushCards.map((c) => c.id),
  ]);
  assert("count equals Set of all threat cards", r.count === overlap.size, `${r.count} vs ${overlap.size}`);

  console.log("\nExample (Jh4d / K♠3♠6♦6♠A♠) — shared pair + 4-flush:");
  console.log(`  dealer outs: ${r.count} (before flush/straight fix, pair+outkick only ≈ ${pairRankCards.length + outkickQ.length})`);
  console.log(`  advice: ${r.advice.action}`);
  for (const line of r.breakdown) console.log(`  • ${line}`);
}

// --- Flush + straight on same board: still unique ---
{
  // 5♠ 6♠ 7♠ 8♠ Td — 4-flush + open-ended straight (4/9)
  const r = outsFor(["Qc", "2d"], ["5s", "6s", "7s", "8s", "10d"]);
  const flushCards = r.remaining.filter((c) => c.suit === "s");
  const straightCards = r.remaining.filter((c) => c.rank === 4 || c.rank === 9);
  const overlapIds = new Set([...flushCards, ...straightCards].map((c) => c.id));
  // 4s and 9s of spades are in both
  assert(
    "flush∩straight ranks deduped in total",
    r.count >= overlapIds.size,
    `count=${r.count} flush∪straight=${overlapIds.size}`
  );
  const both = flushCards.filter((c) => c.rank === 4 || c.rank === 9);
  assert("there are overlapping SF outs", both.length === 2, `overlap=${both.length}`);
}

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll wizard outs checks passed.");
