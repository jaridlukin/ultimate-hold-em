/**
 * Generate correct sequential preflop EVs for all 169 hands.
 * EV(check) = avg over flops of max(EV(raise2|flop), EV(check→river|flop))
 * EV(raise4) = avg over same flop runouts with play=4
 *
 * Usage:
 *   node scripts/generate-preflop-ev.js [flopSamples] [workerIndex] [workerCount] [hands]
 *
 * hands: optional comma-separated keys (e.g. K5o,Q8o) or path to a JSON array /
 *        {"hands":[...]} file. Workers shard across the filtered list.
 * Env: UTH_HANDS or UTH_HANDS_FILE as alternatives to argv[5].
 */
const fs = require("fs");
const path = require("path");

const HAND = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  THREE_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_KIND: 7,
  STRAIGHT_FLUSH: 8,
  ROYAL_FLUSH: 9,
};

const RC = new Int8Array(15);
const SC = new Int8Array(4);
const SB = new Int32Array(4);
const PAIRS = new Int8Array(4);
const SINGLES = new Int8Array(7);

function topStraight(bits) {
  for (let hi = 14; hi >= 5; hi--) {
    if (
      (bits & (1 << hi)) !== 0 &&
      (bits & (1 << (hi - 1))) !== 0 &&
      (bits & (1 << (hi - 2))) !== 0 &&
      (bits & (1 << (hi - 3))) !== 0 &&
      (bits & (1 << (hi - 4))) !== 0
    ) {
      return hi;
    }
  }
  if (
    (bits & (1 << 14)) !== 0 &&
    (bits & (1 << 5)) !== 0 &&
    (bits & (1 << 4)) !== 0 &&
    (bits & (1 << 3)) !== 0 &&
    (bits & (1 << 2)) !== 0
  ) {
    return 5;
  }
  return 0;
}

function packRank(category, a, b, c, d, e) {
  return (category << 20) | (a << 16) | (b << 12) | (c << 8) | (d << 4) | e;
}

function handRankValue(ranks, suits, n) {
  RC.fill(0);
  SC.fill(0);
  SB[0] = SB[1] = SB[2] = SB[3] = 0;
  let rankBits = 0;
  for (let i = 0; i < n; i++) {
    const r = ranks[i];
    const s = suits[i];
    RC[r]++;
    SC[s]++;
    SB[s] |= 1 << r;
    rankBits |= 1 << r;
  }

  let flushBits = 0;
  for (let s = 0; s < 4; s++) {
    if (SC[s] >= 5) {
      flushBits = SB[s];
      break;
    }
  }
  if (flushBits) {
    const sf = topStraight(flushBits);
    if (sf) {
      return packRank(sf === 14 ? HAND.ROYAL_FLUSH : HAND.STRAIGHT_FLUSH, sf, 0, 0, 0, 0);
    }
    let f0 = 0,
      f1 = 0,
      f2 = 0,
      f3 = 0,
      f4 = 0,
      fn = 0;
    for (let r = 14; r >= 2 && fn < 5; r--) {
      if (flushBits & (1 << r)) {
        if (fn === 0) f0 = r;
        else if (fn === 1) f1 = r;
        else if (fn === 2) f2 = r;
        else if (fn === 3) f3 = r;
        else f4 = r;
        fn++;
      }
    }
    return packRank(HAND.FLUSH, f0, f1, f2, f3, f4);
  }

  const straightHi = topStraight(rankBits);
  let quad = 0,
    trip = 0,
    trip2 = 0,
    pn = 0,
    sn = 0;
  for (let r = 14; r >= 2; r--) {
    const c = RC[r];
    if (c === 4) quad = r;
    else if (c === 3) {
      if (!trip) trip = r;
      else trip2 = r;
    } else if (c === 2) PAIRS[pn++] = r;
    else if (c === 1) SINGLES[sn++] = r;
  }

  if (quad) {
    const kicker = trip || (pn ? PAIRS[0] : 0) || (sn ? SINGLES[0] : 0);
    return packRank(HAND.FOUR_KIND, quad, kicker, 0, 0, 0);
  }
  if (trip && (pn || trip2)) {
    return packRank(HAND.FULL_HOUSE, trip, pn ? PAIRS[0] : trip2, 0, 0, 0);
  }
  if (straightHi) return packRank(HAND.STRAIGHT, straightHi, 0, 0, 0, 0);
  if (trip) {
    return packRank(HAND.THREE_KIND, trip, sn > 0 ? SINGLES[0] : 0, sn > 1 ? SINGLES[1] : 0, 0, 0);
  }
  if (pn >= 2) {
    return packRank(HAND.TWO_PAIR, PAIRS[0], PAIRS[1], sn ? SINGLES[0] : pn > 2 ? PAIRS[2] : 0, 0, 0);
  }
  if (pn === 1) {
    return packRank(
      HAND.PAIR,
      PAIRS[0],
      sn > 0 ? SINGLES[0] : 0,
      sn > 1 ? SINGLES[1] : 0,
      sn > 2 ? SINGLES[2] : 0,
      0
    );
  }
  return packRank(
    HAND.HIGH_CARD,
    sn > 0 ? SINGLES[0] : 0,
    sn > 1 ? SINGLES[1] : 0,
    sn > 2 ? SINGLES[2] : 0,
    sn > 3 ? SINGLES[3] : 0,
    sn > 4 ? SINGLES[4] : 0
  );
}

function blindPayoutFromRank(rankValue) {
  switch (rankValue >>> 20) {
    case HAND.ROYAL_FLUSH:
      return 500;
    case HAND.STRAIGHT_FLUSH:
      return 50;
    case HAND.FOUR_KIND:
      return 10;
    case HAND.FULL_HOUSE:
      return 3;
    case HAND.FLUSH:
      return 1.5;
    case HAND.STRAIGHT:
      return 1;
    default:
      return 0;
  }
}

function settleFromRanks(playerRank, dealerRank, play) {
  if (playerRank === dealerRank) return 0;
  const dealerQualifies = dealerRank >= (HAND.PAIR << 20);
  if (playerRank > dealerRank) {
    return play + (dealerQualifies ? 1 : 0) + blindPayoutFromRank(playerRank);
  }
  return -play + (dealerQualifies ? -1 : 0) - 1;
}

function choose(n, k) {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return Math.round(r);
}

function unrankCombo(index, n, k) {
  const out = [];
  let x = index;
  for (let r = k; r >= 1; r--) {
    let c = r - 1;
    while (choose(c + 1, r) <= x) c++;
    out.push(c);
    x -= choose(c, r);
  }
  out.reverse();
  return out;
}

const LABELS = {
  2: "2",
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "T",
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
};

function makeDeck() {
  const ranks = [];
  const suits = [];
  for (let s = 0; s < 4; s++) {
    for (let r = 2; r <= 14; r++) {
      ranks.push(r);
      suits.push(s);
    }
  }
  return { ranks, suits };
}

function holeKey(r0, s0, r1, s1) {
  const hiR = r0 >= r1 ? r0 : r1;
  const loR = r0 >= r1 ? r1 : r0;
  const hiS = r0 >= r1 ? s0 : s1;
  const loS = r0 >= r1 ? s1 : s0;
  if (hiR === loR) return LABELS[hiR] + LABELS[loR];
  return LABELS[hiR] + LABELS[loR] + (hiS === loS ? "s" : "o");
}

function all169(deckRanks, deckSuits) {
  const hands = [];
  const seen = new Set();
  for (let i = 0; i < 52; i++) {
    for (let j = i + 1; j < 52; j++) {
      const key = holeKey(deckRanks[i], deckSuits[i], deckRanks[j], deckSuits[j]);
      if (seen.has(key)) continue;
      seen.add(key);
      hands.push({ key, i0: i, i1: j });
    }
  }
  return hands;
}

/** Exact EVs from one flop: raise4 / raise2 / check→river. */
function evFromFlop(h0r, h0s, h1r, h1s, remR, remS, fi, fj, fk) {
  const n = remR.length;
  const pR = new Int8Array(7);
  const pS = new Int8Array(7);
  const dR = new Int8Array(7);
  const dS = new Int8Array(7);
  pR[0] = h0r;
  pS[0] = h0s;
  pR[1] = h1r;
  pS[1] = h1s;
  pR[2] = remR[fi];
  pS[2] = remS[fi];
  pR[3] = remR[fj];
  pS[3] = remS[fj];
  pR[4] = remR[fk];
  pS[4] = remS[fk];
  dR[2] = remR[fi];
  dS[2] = remS[fi];
  dR[3] = remR[fj];
  dS[3] = remS[fj];
  dR[4] = remR[fk];
  dS[4] = remS[fk];

  let s4 = 0;
  let s2 = 0;
  let cSum = 0;
  let boards = 0;

  for (let t = 0; t < n; t++) {
    if (t === fi || t === fj || t === fk) continue;
    for (let r = t + 1; r < n; r++) {
      if (r === fi || r === fj || r === fk) continue;
      pR[5] = remR[t];
      pS[5] = remS[t];
      pR[6] = remR[r];
      pS[6] = remS[r];
      dR[5] = remR[t];
      dS[5] = remS[t];
      dR[6] = remR[r];
      dS[6] = remS[r];
      const playerRank = handRankValue(pR, pS, 7);

      let pay4 = 0;
      let pay2 = 0;
      let pay1 = 0;
      let dealers = 0;
      for (let a = 0; a < n; a++) {
        if (a === fi || a === fj || a === fk || a === t || a === r) continue;
        for (let b = a + 1; b < n; b++) {
          if (b === fi || b === fj || b === fk || b === t || b === r) continue;
          dR[0] = remR[a];
          dS[0] = remS[a];
          dR[1] = remR[b];
          dS[1] = remS[b];
          const dealerRank = handRankValue(dR, dS, 7);
          pay4 += settleFromRanks(playerRank, dealerRank, 4);
          pay2 += settleFromRanks(playerRank, dealerRank, 2);
          pay1 += settleFromRanks(playerRank, dealerRank, 1);
          dealers++;
        }
      }
      s4 += pay4 / dealers;
      s2 += pay2 / dealers;
      cSum += Math.max(-2, pay1 / dealers);
      boards++;
    }
  }

  return {
    raise4: s4 / boards,
    raise2: s2 / boards,
    checkRiver: cSum / boards,
  };
}

function analyzeHand(deckRanks, deckSuits, i0, i1, flopSamples) {
  const remR = [];
  const remS = [];
  for (let i = 0; i < 52; i++) {
    if (i === i0 || i === i1) continue;
    remR.push(deckRanks[i]);
    remS.push(deckSuits[i]);
  }
  const n = remR.length;
  const totalFlops = choose(n, 3);
  const samples = Math.min(flopSamples, totalFlops);
  let raise4Sum = 0;
  let checkSum = 0;

  for (let s = 0; s < samples; s++) {
    const idx = Math.min(totalFlops - 1, Math.floor(((s + 0.5) * totalFlops) / samples));
    const [a, b, c] = unrankCombo(idx, n, 3);
    const ev = evFromFlop(
      deckRanks[i0],
      deckSuits[i0],
      deckRanks[i1],
      deckSuits[i1],
      remR,
      remS,
      a,
      b,
      c
    );
    raise4Sum += ev.raise4;
    // True sequential: flop decision uses only flop information
    checkSum += Math.max(ev.raise2, ev.checkRiver);
  }

  return {
    raise4: raise4Sum / samples,
    check: checkSum / samples,
    flops: samples,
  };
}

function parseHandsArg(arg) {
  if (!arg) return null;
  const trimmed = String(arg).trim();
  if (!trimmed) return null;
  const asPath = path.isAbsolute(trimmed) ? trimmed : path.join(__dirname, trimmed);
  if (fs.existsSync(asPath) && /\.(json|txt)$/i.test(asPath)) {
    const raw = fs.readFileSync(asPath, "utf8").trim();
    if (asPath.toLowerCase().endsWith(".txt")) {
      return new Set(
        raw
          .split(/[\s,]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      );
    }
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed.hands;
    if (!Array.isArray(list)) throw new Error(`Hands file must be array or {hands:[]}: ${asPath}`);
    return new Set(list);
  }
  return new Set(
    trimmed
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function logErr(...parts) {
  fs.writeSync(2, parts.join(" ") + "\n");
}

const flopSamples = Number(process.argv[2] || 48);
const workerIndex = Number(process.argv[3] || 0);
const workerCount = Number(process.argv[4] || 1);
const handsArg = process.argv[5] || process.env.UTH_HANDS || process.env.UTH_HANDS_FILE || null;
const onlyKeys = parseHandsArg(handsArg);
const singleKey = onlyKeys && onlyKeys.size === 1 ? [...onlyKeys][0] : null;

const deck = makeDeck();
let hands = all169(deck.ranks, deck.suits);
if (onlyKeys) hands = hands.filter((h) => onlyKeys.has(h.key));
hands = hands.filter((_, idx) => idx % workerCount === workerIndex);

logErr(
  `Worker ${workerIndex}/${workerCount}: ${hands.length} hands, flopSamples=${flopSamples}` +
    (onlyKeys ? ` filter=${onlyKeys.size}keys` : "")
);

const out = {};
const t0 = Date.now();
for (let h = 0; h < hands.length; h++) {
  const hand = hands[h];
  const t1 = Date.now();
  out[hand.key] = analyzeHand(deck.ranks, deck.suits, hand.i0, hand.i1, flopSamples);
  const ms = Date.now() - t1;
  const row = out[hand.key];
  const act = row.raise4 >= row.check ? "raise4" : "check";
  logErr(
    `[${h + 1}/${hands.length}] ${hand.key} ${act} r4=${row.raise4.toFixed(4)} ch=${row.check.toFixed(4)} (${ms}ms)`
  );
}

const outName =
  singleKey && workerCount === 1
    ? `preflop-ev-${singleKey}.json`
    : `preflop-ev-part-${workerIndex}.json`;
const outPath = path.join(__dirname, outName);
fs.writeFileSync(outPath, JSON.stringify(out));
logErr(`Wrote ${outPath} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(JSON.stringify(out));
