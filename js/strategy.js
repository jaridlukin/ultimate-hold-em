/**
 * EV-optimal Ultimate Texas Hold'em strategy.
 * All streets use combinatorial probabilities (exact dealer/board averages).
 * No Monte Carlo sampling.
 */
(function () {
const { bestHand } = window.UTHHand;
const { cardLabel, RANK_LABELS } = window.UTHCards;

function handRankValue(cards) {
  const fn = window.UTHHand.handRankValue;
  if (typeof fn !== "function") {
    throw new Error("handRankValue missing — hard-refresh (Ctrl+F5) to reload scripts");
  }
  return fn(cards);
}

function settleFromRanks(playerRank, dealerRank, play) {
  const fn = window.UTHHand.settleFromRanks;
  if (typeof fn !== "function") {
    throw new Error("settleFromRanks missing — hard-refresh (Ctrl+F5) to reload scripts");
  }
  return fn(playerRank, dealerRank, play);
}

/**
 * @typedef {'raise4'|'raise3'|'raise2'|'raise1'|'check'|'fold'} Action
 * @typedef {{ action: Action, reasons: string[], details: Record<string, unknown>, evs: Record<string, number> }} Advice
 */

/**
 * Canonical 169-hand key, e.g. "AA", "AKs", "AKo", "T9o".
 * @param {import('./cards.js').Card} a
 * @param {import('./cards.js').Card} b
 */
function holeKey(a, b) {
  const hi = a.rank >= b.rank ? a : b;
  const lo = a.rank >= b.rank ? b : a;
  const hr = RANK_LABELS[hi.rank] === "10" ? "T" : RANK_LABELS[hi.rank];
  const lr = RANK_LABELS[lo.rank] === "10" ? "T" : RANK_LABELS[lo.rank];
  if (hi.rank === lo.rank) return hr + lr;
  return hr + lr + (hi.suit === lo.suit ? "s" : "o");
}

/** @param {number} n @param {number} k */
function choose(n, k) {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return Math.round(r);
}

/** Combinadic unrank: combination index → ascending indices of length k. */
function unrankCombo(index, n, k) {
  /** @type {number[]} */
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

/**
 * Exact river raise analysis (all dealer combinations).
 * @param {import('./cards.js').Card[]} hole
 * @param {import('./cards.js').Card[]} board
 * @param {import('./cards.js').Card[]} remaining
 */
function exactRiverRaise(hole, board, remaining) {
  const sevenP = [hole[0], hole[1], board[0], board[1], board[2], board[3], board[4]];
  const playerRank = handRankValue(sevenP);
  const playerHand = bestHand(hole, board);
  const n = remaining.length;
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let totalPay = 0;
  let combos = 0;

  const sevenD = [null, null, board[0], board[1], board[2], board[3], board[4]];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      combos++;
      sevenD[0] = remaining[i];
      sevenD[1] = remaining[j];
      const dealerRank = handRankValue(sevenD);
      if (playerRank > dealerRank) {
        wins++;
        totalPay += settleFromRanks(playerRank, dealerRank, 1);
      } else if (playerRank < dealerRank) {
        losses++;
        totalPay += settleFromRanks(playerRank, dealerRank, 1);
      } else {
        ties++;
      }
    }
  }

  return {
    combos,
    wins,
    losses,
    ties,
    raiseEv: totalPay / combos,
    foldEv: -2,
    winPct: wins / combos,
    lossPct: losses / combos,
    tiePct: ties / combos,
    playerHand,
    method: "exact",
  };
}

/**
 * Exact EVs conditional on a known flop (all turn/river × dealers).
 * @param {import('./cards.js').Card[]} hole
 * @param {import('./cards.js').Card[]} flop
 * @param {import('./cards.js').Card[]} remaining
 */
function exactEvsFromFlop(hole, flop, remaining) {
  const n = remaining.length;
  let raise4Sum = 0;
  let raise2Sum = 0;
  let checkRiverSum = 0;
  let boards = 0;

  const sevenP = [hole[0], hole[1], flop[0], flop[1], flop[2], null, null];
  const sevenD = [null, null, flop[0], flop[1], flop[2], null, null];

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      sevenP[5] = remaining[i];
      sevenP[6] = remaining[j];
      sevenD[5] = remaining[i];
      sevenD[6] = remaining[j];
      const playerRank = handRankValue(sevenP);

      let pay4 = 0;
      let pay2 = 0;
      let pay1 = 0;
      let dealers = 0;
      for (let a = 0; a < n; a++) {
        if (a === i || a === j) continue;
        for (let b = a + 1; b < n; b++) {
          if (b === i || b === j) continue;
          sevenD[0] = remaining[a];
          sevenD[1] = remaining[b];
          const dealerRank = handRankValue(sevenD);
          pay4 += settleFromRanks(playerRank, dealerRank, 4);
          pay2 += settleFromRanks(playerRank, dealerRank, 2);
          pay1 += settleFromRanks(playerRank, dealerRank, 1);
          dealers++;
        }
      }
      raise4Sum += pay4 / dealers;
      raise2Sum += pay2 / dealers;
      checkRiverSum += Math.max(-2, pay1 / dealers);
      boards++;
    }
  }

  return {
    raise4: raise4Sum / boards,
    raise2: raise2Sum / boards,
    checkRiver: checkRiverSum / boards,
    boards,
  };
}

/**
 * Exact flop: all turn/river × all dealer holes.
 * EV(raise 2×) vs EV(check → optimal river).
 * @param {import('./cards.js').Card[]} hole
 * @param {import('./cards.js').Card[]} flop
 * @param {import('./cards.js').Card[]} remaining
 */
function analyzeFlopEv(hole, flop, remaining) {
  const ev = exactEvsFromFlop(hole, flop, remaining);
  const n = remaining.length;
  return {
    action: ev.raise2 >= ev.checkRiver ? "raise2" : "check",
    raiseEv: ev.raise2,
    checkEv: ev.checkRiver,
    boards: ev.boards,
    dealersPerBoard: ((n - 2) * (n - 3)) / 2,
    edge: Math.abs(ev.raise2 - ev.checkRiver),
    method: "exact",
  };
}

/**
 * Preflop sequential EV:
 *   raise4 = E[payoff | play 4]
 *   check  = E[ max(EV(raise2|flop), EV(check→river|flop)) ]
 * Uses precomputed table when present; otherwise evaluates uniformly spaced flops.
 * @param {import('./cards.js').Card[]} hole
 * @param {import('./cards.js').Card[]} remaining
 * @param {number} [flopSamples]
 */
function analyzePreflopEv(hole, remaining, flopSamples = 48) {
  const key = holeKey(hole[0], hole[1]);
  const table = window.UTHPreflopEv && window.UTHPreflopEv[key];
  if (table && typeof table.raise4 === "number" && typeof table.check === "number") {
    const raise4Ev = table.raise4;
    const checkEv = table.check;
    const action = raise4Ev >= checkEv ? "raise4" : "check";
    return {
      action,
      raise4Ev,
      checkEv,
      edge: Math.abs(raise4Ev - checkEv),
      ranking: [
        { action: "raise4", ev: raise4Ev },
        { action: "check", ev: checkEv },
      ].sort((a, b) => b.ev - a.ev),
      method: "sequential-table",
      flops: table.flops,
      key,
    };
  }

  const n = remaining.length;
  const totalFlops = choose(n, 3);
  const samples = Math.min(flopSamples, totalFlops);
  let raise4Sum = 0;
  let checkSum = 0;

  for (let s = 0; s < samples; s++) {
    const idx = Math.min(totalFlops - 1, Math.floor(((s + 0.5) * totalFlops) / samples));
    const comb = unrankCombo(idx, n, 3);
    const flop = [remaining[comb[0]], remaining[comb[1]], remaining[comb[2]]];
    const after = [];
    for (let i = 0; i < n; i++) {
      if (i === comb[0] || i === comb[1] || i === comb[2]) continue;
      after.push(remaining[i]);
    }
    const ev = exactEvsFromFlop(hole, flop, after);
    raise4Sum += ev.raise4;
    // Flop decision only — no turn/river clairvoyance
    checkSum += Math.max(ev.raise2, ev.checkRiver);
  }

  const raise4Ev = raise4Sum / samples;
  const checkEv = checkSum / samples;
  const action = raise4Ev >= checkEv ? "raise4" : "check";

  return {
    action,
    raise4Ev,
    checkEv,
    edge: Math.abs(raise4Ev - checkEv),
    ranking: [
      { action: "raise4", ev: raise4Ev },
      { action: "check", ev: checkEv },
    ].sort((a, b) => b.ev - a.ev),
    method: "sequential",
    flops: samples,
    totalFlops,
    key,
  };
}

/**
 * @param {import('./cards.js').Card[]} hole
 * @param {import('./cards.js').Card[]} board
 * @param {import('./cards.js').Card[]} remaining
 * @returns {Advice}
 */
function adviseRiver(hole, board, remaining) {
  const analysis = exactRiverRaise(hole, board, remaining);
  const raiseEv = analysis.raiseEv;
  const foldEv = -2;
  const action = raiseEv > foldEv ? "raise1" : "fold";
  const delta = raiseEv - foldEv;

  /** @type {string[]} */
  const reasons = [];
  if (action === "raise1") {
    reasons.push(
      `EV(raise 1×) = ${fmt(raiseEv)} exceeds EV(fold) = −2.000 by ${fmt(delta)} units — raise.`
    );
  } else {
    reasons.push(
      `EV(raise 1×) = ${fmt(raiseEv)} is worse than EV(fold) = −2.000 by ${fmt(-delta)} units — fold.`
    );
  }
  reasons.push(
    `Exact probabilities over all ${analysis.combos.toLocaleString()} dealer hole-card combinations ` +
      `(win ${(100 * analysis.winPct).toFixed(1)}% / lose ${(100 * analysis.lossPct).toFixed(1)}% / tie ${(100 * analysis.tiePct).toFixed(1)}%).`
  );
  reasons.push(`Your hand: ${analysis.playerHand.name}.`);

  return {
    action,
    reasons,
    details: { analysis },
    evs: { raise1: raiseEv, fold: foldEv },
  };
}

/**
 * @param {import('./cards.js').Card[]} hole
 * @param {import('./cards.js').Card[]} flop
 * @param {import('./cards.js').Card[]} remaining
 * @returns {Advice}
 */
function adviseFlop(hole, flop, remaining) {
  const ev = analyzeFlopEv(hole, flop, remaining);
  const action = /** @type {Action} */ (ev.action);
  const reasons = [
    `EV(raise 2×) = ${fmt(ev.raiseEv)} · EV(check → optimal river) = ${fmt(ev.checkEv)}.`,
    action === "raise2"
      ? `Raising is higher by ${fmt(ev.raiseEv - ev.checkEv)} units — raise 2×.`
      : `Checking is higher by ${fmt(ev.checkEv - ev.raiseEv)} units — check.`,
    `Exact probabilities over all ${ev.boards.toLocaleString()} turn/river boards × ${ev.dealersPerBoard.toLocaleString()} dealer holes each.`,
    `Hand on flop: ${bestHand(hole, flop).name}.`,
  ];
  return {
    action,
    reasons,
    details: { ev },
    evs: { raise2: ev.raiseEv, check: ev.checkEv },
  };
}

/**
 * @param {import('./cards.js').Card[]} hole
 * @param {import('./cards.js').Card[]} remaining
 * @returns {Advice}
 */
function advisePreflop(hole, remaining) {
  const ev = analyzePreflopEv(hole, remaining);
  const action = /** @type {Action} */ (ev.action);
  const labels = { raise4: "raise 4×", check: "check" };
  const methodNote =
    ev.method === "sequential-table"
      ? `Sequential combinatorial EVs for ${ev.key} (precomputed over ${ev.flops.toLocaleString()} flops).`
      : `Sequential combinatorial average over ${ev.flops.toLocaleString()} flops (of ${ev.totalFlops.toLocaleString()}).`;
  const reasons = [
    `EV(raise 4×) = ${fmt(ev.raise4Ev)} · EV(check → optimal later streets) = ${fmt(ev.checkEv)}.`,
    `Best action: ${labels[action]} (edge ${fmt(ev.edge)} units over the alternative).`,
    methodNote,
    `Your hole cards: ${cardLabel(hole[0])} ${cardLabel(hole[1])}.`,
  ];
  return {
    action,
    reasons,
    details: { ev },
    evs: { raise4: ev.raise4Ev, check: ev.checkEv },
  };
}

/**
 * @param {'preflop'|'flop'|'river'} street
 * @param {{ playerHole: import('./cards.js').Card[], board: import('./cards.js').Card[], remaining: import('./cards.js').Card[] }} state
 * @returns {Advice}
 */
function getAdvice(street, state) {
  if (street === "preflop") return advisePreflop(state.playerHole, state.remaining);
  if (street === "flop") return adviseFlop(state.playerHole, state.board.slice(0, 3), state.remaining);
  return adviseRiver(state.playerHole, state.board, state.remaining);
}

/**
 * @param {{ street: string, playerAction: string, advice: Advice, wizard: { action: string, reasons: string[] } }} ctx
 */
function explainDecision(ctx) {
  const { street, playerAction, advice, wizard } = ctx;
  const correctAction = advice.action;
  const correct = playerAction === correctAction;
  const wizardMatch = playerAction === wizard.action;
  const evMatchesWizard = advice.action === wizard.action;

  let briefEv = "";
  /** @type {string[]} */
  const detailLines = [];

  if (street === "river" && advice.details.analysis) {
    const a = advice.details.analysis;
    briefEv =
      `EV(raise) ${fmt(a.raiseEv)} vs fold −2.000 → ${actionLabel(correctAction)}.`;
    detailLines.push(...advice.reasons);
    detailLines.push(
      `Fold always costs −2 ante units (Ante + Blind). Raise 1× settles Play, Ante, and Blind by winner and whether the dealer qualifies (pair or better).`
    );
    detailLines.push(
      `Decision rule: raise when EV(raise 1×) > EV(fold), i.e. ${fmt(a.raiseEv)} > −2.`
    );
    detailLines.push(
      `Win ${(100 * a.winPct).toFixed(2)}% · lose ${(100 * a.lossPct).toFixed(2)}% · tie ${(100 * a.tiePct).toFixed(2)}% across ${a.combos.toLocaleString()} dealer hole combinations.`
    );
  } else if (street === "flop" && advice.details.ev) {
    const e = advice.details.ev;
    briefEv =
      `EV(raise 2×) ${fmt(e.raiseEv)} vs EV(check) ${fmt(e.checkEv)} → ${actionLabel(correctAction)}.`;
    detailLines.push(...advice.reasons);
    detailLines.push(
      `Check EV is the average over all turn/river completions of max(−2, EV(raise 1× on that board)) — river played optimally.`
    );
    detailLines.push(
      `Raise 2× EV is the average showdown payoff with Play = 2× after the board is completed.`
    );
    detailLines.push(
      `Edge: ${fmt(Math.abs(e.raiseEv - e.checkEv))} units in favor of ${actionLabel(correctAction)} (${e.boards.toLocaleString()} boards, exact).`
    );
  } else if (street === "preflop" && advice.details.ev) {
    const e = advice.details.ev;
    briefEv =
      `EV(raise 4×) ${fmt(e.raise4Ev)} vs EV(check) ${fmt(e.checkEv)} → ${actionLabel(correctAction)}.`;
    detailLines.push(...advice.reasons);
    detailLines.push(
      `Raise 4× EV: average showdown payoff with Play = 4× after the flop, turn, and river are dealt.`
    );
    detailLines.push(
      `Check EV: for each flop, take max(EV(raise 2× | flop), EV(check → optimal river | flop)), then average — the flop decision does not see the turn/river.`
    );
    detailLines.push(`Edge: ${fmt(e.edge)} units · hand ${e.key} · ${e.flops.toLocaleString()} flops.`);
  }

  if (wizard.reasons.length) {
    detailLines.push("Wizard of Odds:");
    for (const line of wizard.reasons) detailLines.push(`• ${line}`);
  }

  const briefWizard =
    `${actionLabel(wizard.action)}` +
    (wizard.reasons[0] ? ` — ${wizard.reasons[0]}` : "");

  return {
    correct,
    correctAction,
    playerAction,
    briefEv,
    briefWizard,
    detailLines,
    ev: advice.evs,
    wizardAction: wizard.action,
    wizardMatch,
    evMatchesWizard,
  };
}

/** @param {number} n */
function fmt(n) {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(3)}`;
}

/** @param {string} action */
function actionLabel(action) {
  switch (action) {
    case "raise4":
      return "Raise 4×";
    case "raise3":
      return "Raise 3×";
    case "raise2":
      return "Raise 2×";
    case "raise1":
      return "Raise 1× (call)";
    case "check":
      return "Check";
    case "fold":
      return "Fold";
    default:
      return action;
  }
}

window.UTHStrategy = {
  getAdvice,
  advisePreflop,
  adviseFlop,
  adviseRiver,
  exactRiverRaise,
  analyzeFlopEv,
  analyzePreflopEv,
  holeKey,
};

window.UTHEv = {
  explainDecision,
  actionLabel,
  fmt,
  exactRiverRaise,
};
})();
