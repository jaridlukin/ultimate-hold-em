/** Hand categories: higher is better */
(function () {
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

const HAND_NAMES = {
  [HAND.HIGH_CARD]: "High Card",
  [HAND.PAIR]: "Pair",
  [HAND.TWO_PAIR]: "Two Pair",
  [HAND.THREE_KIND]: "Three of a Kind",
  [HAND.STRAIGHT]: "Straight",
  [HAND.FLUSH]: "Flush",
  [HAND.FULL_HOUSE]: "Full House",
  [HAND.FOUR_KIND]: "Four of a Kind",
  [HAND.STRAIGHT_FLUSH]: "Straight Flush",
  [HAND.ROYAL_FLUSH]: "Royal Flush",
};

/**
 * @typedef {{ category: number, ranks: number[], name: string, cards: import('./cards.js').Card[] }} HandValue
 */

/**
 * Evaluate best 5-card hand from 5–7 cards.
 * @param {import('./cards.js').Card[]} cards
 * @returns {HandValue}
 */
function evaluateHand(cards) {
  const n = cards.length;
  if (n < 5) throw new Error("Need at least 5 cards");
  if (n === 5) return scoreFive(cards);

  // Choose which cards to discard (faster than building combination arrays)
  let best = null;
  if (n === 6) {
    for (let drop = 0; drop < 6; drop++) {
      const five = [];
      for (let i = 0; i < 6; i++) if (i !== drop) five.push(cards[i]);
      const scored = scoreFive(five);
      if (!best || compareHands(scored, best) > 0) best = scored;
    }
  } else {
    for (let a = 0; a < 6; a++) {
      for (let b = a + 1; b < 7; b++) {
        const five = [];
        for (let i = 0; i < 7; i++) if (i !== a && i !== b) five.push(cards[i]);
        const scored = scoreFive(five);
        if (!best || compareHands(scored, best) > 0) best = scored;
      }
    }
  }
  return /** @type {HandValue} */ (best);
}

/**
 * @param {import('./cards.js').Card[]} five
 * @returns {HandValue}
 */
function scoreFive(five) {
  // Manual sort of 5 cards by rank desc (avoid array alloc from map/sort where possible)
  const c = five.slice();
  c.sort((a, b) => b.rank - a.rank);
  const r0 = c[0].rank;
  const r1 = c[1].rank;
  const r2 = c[2].rank;
  const r3 = c[3].rank;
  const r4 = c[4].rank;
  const isFlush =
    c[0].suit === c[1].suit &&
    c[1].suit === c[2].suit &&
    c[2].suit === c[3].suit &&
    c[3].suit === c[4].suit;

  const ranks = [r0, r1, r2, r3, r4];
  const straightHigh = straightHighRank(ranks);
  const isStraight = straightHigh !== null;

  // Count ranks without Object.entries
  /** @type {number[]} */
  const countByRank = new Array(15).fill(0);
  countByRank[r0]++;
  countByRank[r1]++;
  countByRank[r2]++;
  countByRank[r3]++;
  countByRank[r4]++;

  /** @type {{ rank: number, count: number }[]} */
  const groups = [];
  for (let r = 14; r >= 2; r--) {
    if (countByRank[r]) groups.push({ rank: r, count: countByRank[r] });
  }
  groups.sort((a, b) => b.count - a.count || b.rank - a.rank);

  let category = HAND.HIGH_CARD;
  /** @type {number[]} */
  let tiebreak = [];

  if (isStraight && isFlush) {
    category = straightHigh === 14 ? HAND.ROYAL_FLUSH : HAND.STRAIGHT_FLUSH;
    tiebreak = [/** @type {number} */ (straightHigh)];
  } else if (groups[0].count === 4) {
    category = HAND.FOUR_KIND;
    tiebreak = [groups[0].rank, groups[1].rank];
  } else if (groups[0].count === 3 && groups[1].count === 2) {
    category = HAND.FULL_HOUSE;
    tiebreak = [groups[0].rank, groups[1].rank];
  } else if (isFlush) {
    category = HAND.FLUSH;
    tiebreak = ranks;
  } else if (isStraight) {
    category = HAND.STRAIGHT;
    tiebreak = [/** @type {number} */ (straightHigh)];
  } else if (groups[0].count === 3) {
    category = HAND.THREE_KIND;
    tiebreak = [groups[0].rank, ...groups.slice(1).map((g) => g.rank)];
  } else if (groups[0].count === 2 && groups[1].count === 2) {
    category = HAND.TWO_PAIR;
    const pairs = [groups[0].rank, groups[1].rank].sort((a, b) => b - a);
    tiebreak = [...pairs, groups[2].rank];
  } else if (groups[0].count === 2) {
    category = HAND.PAIR;
    tiebreak = [groups[0].rank, ...groups.slice(1).map((g) => g.rank)];
  } else {
    category = HAND.HIGH_CARD;
    tiebreak = ranks;
  }

  return {
    category,
    ranks: tiebreak,
    name: HAND_NAMES[category],
    cards: c,
  };
}

/** @param {number[]} ranks */
function straightHighRank(ranks) {
  const uniq = [...new Set(ranks)].sort((a, b) => b - a);
  if (uniq.length < 5) return null;
  for (let i = 0; i <= uniq.length - 5; i++) {
    if (uniq[i] - uniq[i + 4] === 4) return uniq[i];
  }
  // Wheel: A-5-4-3-2
  if (uniq.includes(14) && uniq.includes(5) && uniq.includes(4) && uniq.includes(3) && uniq.includes(2)) {
    return 5;
  }
  return null;
}

/** @param {number[]} ranks */
function countRanks(ranks) {
  /** @type {Record<number, number>} */
  const counts = {};
  for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
  return counts;
}

/**
 * @param {HandValue} a
 * @param {HandValue} b
 * @returns {number} positive if a > b
 */
function compareHands(a, b) {
  if (a.category !== b.category) return a.category - b.category;
  for (let i = 0; i < Math.max(a.ranks.length, b.ranks.length); i++) {
    const ar = a.ranks[i] || 0;
    const br = b.ranks[i] || 0;
    if (ar !== br) return ar - br;
  }
  return 0;
}

/**
 * Blind payout as multiple of blind bet (1:1 = 1, 3:2 = 1.5). Push = 0.
 * @param {HandValue} hand
 */
function blindPayout(hand) {
  switch (hand.category) {
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

/**
 * Net units won relative to ante=1, blind=1, play=P (fold: P=0, lose ante+blind).
 * @param {{ winner: 'player'|'dealer'|'tie', dealerQualifies: boolean, play: number, playerHand: HandValue }} result
 */
function settleUnits({ winner, dealerQualifies, play, playerHand }) {
  if (play === 0) {
    return -2; // fold
  }
  if (winner === "tie") return 0;

  if (winner === "player") {
    const ante = dealerQualifies ? 1 : 0;
    const blind = blindPayout(playerHand);
    return play + ante + blind;
  }

  // dealer wins
  const ante = dealerQualifies ? -1 : 0;
  return -play + ante - 1; // lose play, ante (if qualifies), blind
}

/**
 * @template T
 * @param {T[]} arr
 * @param {number} k
 * @returns {T[][]}
 */
function combinations(arr, k) {
  /** @type {T[][]} */
  const result = [];
  /** @param {number} start @param {T[]} path */
  function rec(start, path) {
    if (path.length === k) {
      result.push(path.slice());
      return;
    }
    for (let i = start; i < arr.length; i++) {
      path.push(arr[i]);
      rec(i + 1, path);
      path.pop();
    }
  }
  rec(0, []);
  return result;
}

/**
 * Does dealer qualify? Pair or better.
 * @param {HandValue} hand
 */
function dealerQualifies(hand) {
  return hand.category >= HAND.PAIR;
}

/**
 * @param {import('./cards.js').Card[]} hole
 * @param {import('./cards.js').Card[]} board
 */
function bestHand(hole, board) {
  return evaluateHand([...hole, ...board]);
}

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

function suitIndex(suit) {
  return suit === "c" ? 0 : suit === "d" ? 1 : suit === "h" ? 2 : 3;
}

/**
 * Fast 5–7 card hand strength as a comparable integer (higher is better).
 * Layout: category in high bits, then tie-break ranks.
 * @param {import('./cards.js').Card[]} cards
 * @returns {number}
 */
function handRankValue(cards) {
  const n = cards.length;
  RC.fill(0);
  SC.fill(0);
  SB[0] = SB[1] = SB[2] = SB[3] = 0;
  let rankBits = 0;

  for (let i = 0; i < n; i++) {
    const r = cards[i].rank;
    const s = suitIndex(cards[i].suit);
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
    let f0 = 0;
    let f1 = 0;
    let f2 = 0;
    let f3 = 0;
    let f4 = 0;
    let fn = 0;
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
  let quad = 0;
  let trip = 0;
  let trip2 = 0;
  let pn = 0;
  let sn = 0;
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
  if (straightHi) {
    return packRank(HAND.STRAIGHT, straightHi, 0, 0, 0, 0);
  }
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

/**
 * Blind payout from packed hand rank category.
 * @param {number} rankValue
 */
function blindPayoutFromRank(rankValue) {
  const category = rankValue >>> 20;
  switch (category) {
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

/**
 * Settle using packed ranks (ante units).
 * @param {number} playerRank
 * @param {number} dealerRank
 * @param {number} play
 */
function settleFromRanks(playerRank, dealerRank, play) {
  if (play === 0) return -2;
  if (playerRank === dealerRank) return 0;
  const dealerQualifies = dealerRank >= (HAND.PAIR << 20);
  if (playerRank > dealerRank) {
    const ante = dealerQualifies ? 1 : 0;
    return play + ante + blindPayoutFromRank(playerRank);
  }
  const ante = dealerQualifies ? -1 : 0;
  return -play + ante - 1;
}

window.UTHHand = {
  HAND,
  HAND_NAMES,
  evaluateHand,
  compareHands,
  blindPayout,
  settleUnits,
  combinations,
  dealerQualifies,
  bestHand,
  scoreFive,
  handRankValue,
  settleFromRanks,
  blindPayoutFromRank,
};
})();
