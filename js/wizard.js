/**
 * Wizard of Odds "Wizard Strategy" for Ultimate Texas Hold'em.
 * Used alongside EV evaluation for comparison — not the sole grader.
 */
(function () {
const { HAND, bestHand } = window.UTHHand;
const { RANK_LABELS, SUIT_NAMES } = window.UTHCards;

/**
 * @typedef {'raise4'|'raise3'|'raise2'|'raise1'|'check'|'fold'} WizardAction
 * @typedef {{ action: WizardAction, reasons: string[] }} WizardAdvice
 */

/**
 * @param {import('./cards.js').Card} a
 * @param {import('./cards.js').Card} b
 */
function sortedHole(a, b) {
  return a.rank >= b.rank ? [a, b] : [b, a];
}

/**
 * @param {import('./cards.js').Card[]} hole
 * @param {import('./cards.js').Card[]} board
 */
function analyzeMade(hole, board) {
  const player = bestHand(hole, board);
  const pocketPair = hole[0].rank === hole[1].rank;
  const pocketRank = pocketPair ? hole[0].rank : null;
  const boardCounts = {};
  for (const c of board) boardCounts[c.rank] = (boardCounts[c.rank] || 0) + 1;

  let holePairsBoard = false;
  for (const h of hole) {
    if (boardCounts[h.rank]) holePairsBoard = true;
  }

  const hiddenPairOrBetter = Boolean(
    (pocketPair && player.category >= HAND.PAIR) ||
      (holePairsBoard && player.category >= HAND.PAIR) ||
      player.category >= HAND.TWO_PAIR
  );

  return { player, pocketPair, pocketRank, holePairsBoard, hiddenPairOrBetter };
}

/**
 * @param {import('./cards.js').Card[]} hole
 * @param {import('./cards.js').Card[]} board
 */
function flushDrawInfo(hole, board) {
  const all = [...hole, ...board];
  for (const suit of ["c", "d", "h", "s"]) {
    const suited = all.filter((c) => c.suit === suit);
    if (suited.length === 4) {
      const holeInFlush = hole.filter((c) => c.suit === suit);
      if (holeInFlush.length === 0) continue;
      const maxHole = Math.max(...holeInFlush.map((c) => c.rank));
      return { suit, maxHole, qualifies: maxHole >= 10 };
    }
  }
  return null;
}

/**
 * True if rank set contains any 5-card straight (incl. wheel).
 * @param {Set<number>} rankSet
 */
function ranksContainStraight(rankSet) {
  for (let high = 14; high >= 6; high--) {
    let ok = true;
    for (let d = 0; d < 5; d++) {
      if (!rankSet.has(high - d)) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return (
    rankSet.has(14) &&
    rankSet.has(5) &&
    rankSet.has(4) &&
    rankSet.has(3) &&
    rankSet.has(2)
  );
}

/**
 * Ranks that complete a straight when added to the board (4-to-a-straight).
 * @param {import('./cards.js').Card[]} board
 * @returns {number[]}
 */
function boardStraightCompletingRanks(board) {
  const unique = new Set(board.map((c) => c.rank));
  if (ranksContainStraight(unique)) return [];
  /** @type {number[]} */
  const completing = [];
  for (let r = 2; r <= 14; r++) {
    if (unique.has(r)) continue;
    const withRank = new Set(unique);
    withRank.add(r);
    if (ranksContainStraight(withRank)) completing.push(r);
  }
  return completing;
}

/**
 * Suit of a 4-flush on the board, or null.
 * @param {import('./cards.js').Card[]} board
 * @returns {string | null}
 */
function boardFourFlushSuit(board) {
  /** @type {Record<string, number>} */
  const bySuit = { c: 0, d: 0, h: 0, s: 0 };
  for (const c of board) bySuit[c.suit]++;
  for (const suit of ["c", "d", "h", "s"]) {
    if (bySuit[suit] === 4) return suit;
  }
  return null;
}

/**
 * Simplified Wizard outs: remaining cards that often produce a dealer win
 * (dealer outs that beat you — not player draw outs).
 * Counts pair/outkick threats plus board 4-flush and 4-straight completes,
 * deduplicated by card id.
 * @param {import('./cards.js').Card[]} hole
 * @param {import('./cards.js').Card[]} board
 * @param {import('./cards.js').Card[]} remaining
 * @param {ReturnType<typeof bestHand>} playerHand
 * @param {ReturnType<typeof analyzeMade>} made
 */
function countWizardOuts(hole, board, remaining, playerHand, made) {
  /** @type {string[]} */
  const breakdown = [];
  if (made.hiddenPairOrBetter || playerHand.category >= HAND.TWO_PAIR) {
    return { count: 0, breakdown: ["Hidden pair or better — outs rule not needed."] };
  }

  const playerHigh = Math.max(hole[0].rank, hole[1].rank);
  const boardRankCounts = {};
  for (const c of board) boardRankCounts[c.rank] = (boardRankCounts[c.rank] || 0) + 1;

  /** @type {Set<string>} */
  const outIds = new Set();
  /**
   * @param {import('./cards.js').Card[]} cards
   * @param {string} line
   */
  function addOutCards(cards, line) {
    let added = 0;
    for (const c of cards) {
      if (outIds.has(c.id)) continue;
      outIds.add(c.id);
      added++;
    }
    if (added > 0) breakdown.push(line.replace(/^(\d+)×/, `${added}×`));
  }

  if (playerHand.category === HAND.HIGH_CARD) {
    for (const [rankStr, cnt] of Object.entries(boardRankCounts)) {
      const rank = Number(rankStr);
      if (cnt >= 2) continue;
      const cards = remaining.filter((c) => c.rank === rank);
      if (cards.length > 0) {
        addOutCards(
          cards,
          `${cards.length}× ${RANK_LABELS[rank]} pair the board and beat your high card.`
        );
      }
    }
    for (let r = playerHigh + 1; r <= 14; r++) {
      if (boardRankCounts[r]) continue;
      const cards = remaining.filter((c) => c.rank === r);
      if (cards.length) {
        addOutCards(
          cards,
          `${cards.length}× ${RANK_LABELS[r]} outkick your ${RANK_LABELS[playerHigh]}.`
        );
      }
    }
  } else if (playerHand.category === HAND.PAIR) {
    const pairRank = playerHand.ranks[0];
    const sharedPair = !made.pocketPair && !made.holePairsBoard;

    if (sharedPair) {
      // Playing a single board pair: any hole card that pairs the board makes two pair
      // (or trips), which beats one pair. Also count outkickers vs your hole kicker.
      for (const [rankStr, cnt] of Object.entries(boardRankCounts)) {
        const rank = Number(rankStr);
        const cards = remaining.filter((c) => c.rank === rank);
        if (cards.length === 0) continue;
        let line;
        if (rank === pairRank) {
          line = `${cards.length}× ${RANK_LABELS[rank]} make trips.`;
        } else if (cnt >= 2) {
          line = `${cards.length}× ${RANK_LABELS[rank]} make a full house or better.`;
        } else {
          line = `${cards.length}× ${RANK_LABELS[rank]} make two pair (${RANK_LABELS[rank]}s and ${RANK_LABELS[pairRank]}s).`;
        }
        addOutCards(cards, line);
      }

      const holeKicker = playerHigh;
      for (let r = holeKicker + 1; r <= 14; r++) {
        if (boardRankCounts[r] || r === pairRank) continue;
        const cards = remaining.filter((c) => c.rank === r);
        if (cards.length > 0) {
          addOutCards(
            cards,
            `${cards.length}× ${RANK_LABELS[r]} outkick your ${RANK_LABELS[holeKicker]} (same board pair).`
          );
        }
      }
    } else {
      // Hidden pair: higher unpaired board ranks make a higher pair for the dealer
      for (const [rankStr, cnt] of Object.entries(boardRankCounts)) {
        const rank = Number(rankStr);
        if (cnt === 1 && rank > pairRank) {
          const cards = remaining.filter((c) => c.rank === rank);
          if (cards.length > 0) {
            addOutCards(cards, `${cards.length}× ${RANK_LABELS[rank]} make a higher pair.`);
          }
        }
      }
      const tripCards = remaining.filter((c) => c.rank === pairRank);
      if (tripCards.length > 0) {
        addOutCards(
          tripCards,
          `${tripCards.length}× ${RANK_LABELS[pairRank]} make trips (set over set / quads).`
        );
      }
      const kicker = playerHand.ranks[1] || playerHigh;
      for (let r = kicker + 1; r <= 14; r++) {
        if (boardRankCounts[r] || r === pairRank) continue;
        const cards = remaining.filter((c) => c.rank === r);
        if (cards.length > 0) {
          addOutCards(
            cards,
            `${cards.length}× ${RANK_LABELS[r]} outkick your ${RANK_LABELS[kicker]}.`
          );
        }
      }
    }
  } else {
    breakdown.push("Hand category uses EV comparison rather than the simple outs chart.");
  }

  // Board 4-flush: remaining suit cards complete a flush that beats high card / one pair.
  const flushSuit = boardFourFlushSuit(board);
  if (flushSuit) {
    const flushCards = remaining.filter((c) => c.suit === flushSuit);
    if (flushCards.length > 0) {
      addOutCards(
        flushCards,
        `${flushCards.length}× ${SUIT_NAMES[flushSuit]} complete the board 4-flush.`
      );
    }
  }

  // Board 4-straight (open-ended, gutshot, or double-inside): completing ranks.
  const straightRanks = boardStraightCompletingRanks(board);
  if (straightRanks.length > 0) {
    const straightCards = remaining.filter((c) => straightRanks.includes(c.rank));
    if (straightCards.length > 0) {
      const labels = straightRanks.map((r) => RANK_LABELS[r]).join("/");
      addOutCards(
        straightCards,
        `${straightCards.length}× ${labels} complete the board 4-straight.`
      );
    }
  }

  return { count: outIds.size, breakdown };
}

/**
 * @param {import('./cards.js').Card[]} hole
 * @returns {WizardAdvice}
 */
function wizardPreflop(hole) {
  const [hi, lo] = sortedHole(hole[0], hole[1]);
  const suited = hi.suit === lo.suit;
  const pair = hi.rank === lo.rank;
  const reasons = [];

  if (pair) {
    if (hi.rank >= 3) {
      reasons.push(`Pocket ${RANK_LABELS[hi.rank]}s — raise 4× (any pair of 3s or higher).`);
      return { action: "raise4", reasons };
    }
    reasons.push("Pocket deuces — check.");
    return { action: "check", reasons };
  }

  if (hi.rank === 14) {
    reasons.push(`Any ace — raise 4×.`);
    return { action: "raise4", reasons };
  }

  if (suited) {
    if (hi.rank === 13) {
      reasons.push("Any suited king — raise 4×.");
      return { action: "raise4", reasons };
    }
    if (hi.rank === 12 && lo.rank >= 6) {
      reasons.push("Suited queen with 6+ — raise 4×.");
      return { action: "raise4", reasons };
    }
    if (hi.rank === 11 && lo.rank >= 8) {
      reasons.push("Suited jack with 8+ — raise 4×.");
      return { action: "raise4", reasons };
    }
  } else {
    if (hi.rank === 13 && lo.rank >= 5) {
      reasons.push("Offsuit king with 5+ — raise 4×.");
      return { action: "raise4", reasons };
    }
    if (hi.rank === 12 && lo.rank >= 8) {
      reasons.push("Offsuit queen with 8+ — raise 4×.");
      return { action: "raise4", reasons };
    }
    if (hi.rank === 11 && lo.rank === 10) {
      reasons.push("Jack-Ten offsuit — raise 4×.");
      return { action: "raise4", reasons };
    }
  }

  const label = `${RANK_LABELS[hi.rank]}${RANK_LABELS[lo.rank]}${suited ? "s" : "o"}`;
  reasons.push(`${label} is outside the Wizard 4× chart — check.`);
  return { action: "check", reasons };
}

/**
 * @param {import('./cards.js').Card[]} hole
 * @param {import('./cards.js').Card[]} flop
 * @returns {WizardAdvice}
 */
function wizardFlop(hole, flop) {
  const made = analyzeMade(hole, flop);
  const flush = flushDrawInfo(hole, flop);
  const reasons = [];

  if (made.player.category >= HAND.TWO_PAIR) {
    reasons.push(`Two pair or better (${made.player.name}) — raise 2×.`);
    return { action: "raise2", reasons };
  }

  if (made.pocketPair && made.pocketRank === 2 && made.player.category === HAND.PAIR) {
    if (flush?.qualifies) {
      reasons.push(
        `Four to a flush with a hidden ${RANK_LABELS[flush.maxHole]}+ — raise 2× (overrides pocket deuces).`
      );
      return { action: "raise2", reasons };
    }
    reasons.push("Pocket deuces with only a pair of twos — check.");
    return { action: "check", reasons };
  }

  if (made.hiddenPairOrBetter || (made.pocketPair && made.pocketRank !== 2)) {
    reasons.push("Hidden pair — raise 2×.");
    return { action: "raise2", reasons };
  }

  if (flush?.qualifies) {
    reasons.push(
      `Four to a ${SUIT_NAMES[flush.suit]} flush with a hidden ${RANK_LABELS[flush.maxHole]}+ — raise 2×.`
    );
    return { action: "raise2", reasons };
  }

  if (flush) {
    reasons.push(
      `Four to a flush, but highest hole card in that suit is only ${RANK_LABELS[flush.maxHole]} (need 10+) — check.`
    );
  } else {
    reasons.push("No hidden pair / two pair+ / qualifying flush draw — check.");
  }
  return { action: "check", reasons };
}

/**
 * @param {import('./cards.js').Card[]} hole
 * @param {import('./cards.js').Card[]} board
 * @param {import('./cards.js').Card[]} remaining
 * @returns {WizardAdvice}
 */
function wizardRiver(hole, board, remaining) {
  const made = analyzeMade(hole, board);
  const reasons = [];

  if (made.player.category >= HAND.STRAIGHT || made.hiddenPairOrBetter) {
    reasons.push(`Hidden pair or better (${made.player.name}) — raise 1×.`);
    return { action: "raise1", reasons };
  }

  const outs = countWizardOuts(hole, board, remaining, made.player, made);
  if (outs.count < 21) {
    reasons.push(`Only ${outs.count} dealer outs beat you (< 21) — raise 1×.`);
    for (const line of outs.breakdown.slice(0, 4)) reasons.push(line);
    return { action: "raise1", reasons };
  }

  reasons.push(`${outs.count} dealer outs beat you (≥ 21) — fold.`);
  for (const line of outs.breakdown.slice(0, 4)) reasons.push(line);
  return { action: "fold", reasons };
}

/**
 * @param {'preflop'|'flop'|'river'} street
 * @param {{ playerHole: import('./cards.js').Card[], board: import('./cards.js').Card[], remaining: import('./cards.js').Card[] }} state
 * @returns {WizardAdvice}
 */
function getWizardAdvice(street, state) {
  if (street === "preflop") return wizardPreflop(state.playerHole);
  if (street === "flop") return wizardFlop(state.playerHole, state.board.slice(0, 3));
  return wizardRiver(state.playerHole, state.board, state.remaining);
}

window.UTHWizard = {
  getWizardAdvice,
  wizardPreflop,
  wizardFlop,
  wizardRiver,
  countWizardOuts,
  boardStraightCompletingRanks,
  boardFourFlushSuit,
};
})();
