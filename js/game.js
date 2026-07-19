/**
 * Ultimate Texas Hold'em game state machine.
 */
(function () {
const { createDeck, shuffle, cardLabel } = window.UTHCards;
const { bestHand, compareHands, dealerQualifies, settleUnits, blindPayout, HAND_NAMES } = window.UTHHand;
const { getAdvice } = window.UTHStrategy;
const { getWizardAdvice } = window.UTHWizard;
const { explainDecision, actionLabel } = window.UTHEv;

const ANTE = 10;
const BLIND = 10;
const STATS_KEY = "uth-trainer-stats";

/** @returns {{ bankroll: number, handNumber: number, decisions: number, correct: number }|null} */
function loadPersistedStats() {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    const bankroll = Number(data.bankroll);
    const handNumber = Number(data.handNumber);
    const decisions = Number(data.decisions);
    const correct = Number(data.correct);
    if (![bankroll, handNumber, decisions, correct].every(Number.isFinite)) return null;
    return {
      bankroll,
      handNumber: Math.max(0, Math.floor(handNumber)),
      decisions: Math.max(0, Math.floor(decisions)),
      correct: Math.max(0, Math.floor(correct)),
    };
  } catch (_) {
    return null;
  }
}

/** @param {ReturnType<typeof createGame>} game */
function savePersistedStats(game) {
  try {
    localStorage.setItem(
      STATS_KEY,
      JSON.stringify({
        bankroll: game.bankroll,
        handNumber: game.handNumber,
        decisions: game.stats.decisions,
        correct: game.stats.correct,
      })
    );
  } catch (_) {
    /* ignore quota / private mode */
  }
}

const DEFAULT_STATS = {
  bankroll: 1000,
  handNumber: 0,
  decisions: 0,
  correct: 0,
};

/** @param {ReturnType<typeof createGame>} game */
function resetPersistedStats(game) {
  game.bankroll = DEFAULT_STATS.bankroll;
  game.handNumber = DEFAULT_STATS.handNumber;
  game.stats.decisions = DEFAULT_STATS.decisions;
  game.stats.correct = DEFAULT_STATS.correct;
  savePersistedStats(game);
}

function createGame() {
  const saved = loadPersistedStats();
  return {
    bankroll: saved ? saved.bankroll : DEFAULT_STATS.bankroll,
    ante: ANTE,
    handNumber: saved ? saved.handNumber : DEFAULT_STATS.handNumber,
    stats: {
      decisions: saved ? saved.decisions : DEFAULT_STATS.decisions,
      correct: saved ? saved.correct : DEFAULT_STATS.correct,
    },
    /** @type {ReturnType<typeof newHand>|null} */
    hand: null,
    phase: "idle", // idle | preflop | flop | river | feedback | showdown
    /** @type {object|null} */
    lastFeedback: null,
    /** @type {object|null} */
    showdown: null,
  };
}

function newHand(game) {
  const deck = shuffle(createDeck());
  const playerHole = [deck.pop(), deck.pop()];
  const dealerHole = [deck.pop(), deck.pop()];
  const board = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];
  // remaining stub for EV (cards not seen by player yet — includes dealer + undealt board conceptually)
  // For strategy we rebuild remaining from known cards each street.

  game.handNumber += 1;
  game.bankroll -= ANTE + BLIND;
  savePersistedStats(game);

  return {
    deck,
    playerHole,
    dealerHole,
    fullBoard: board,
    board: /** @type {import('./cards.js').Card[]} */ ([]),
    playBet: 0,
    playMult: 0,
    folded: false,
    raised: false,
    street: "preflop",
  };
}

/** @param {ReturnType<typeof createGame>} game */
function startHand(game) {
  game.hand = newHand(game);
  game.phase = "preflop";
  game.lastFeedback = null;
  game.showdown = null;
  return game;
}

/**
 * Cards still unknown to the player (undealt board + dealer hole).
 * @param {NonNullable<ReturnType<typeof createGame>['hand']>} hand
 */
function remainingForPlayer(hand) {
  const known = new Set(hand.playerHole.map((c) => c.id));
  for (const c of hand.board) known.add(c.id);
  const all = createDeck();
  return all.filter((c) => !known.has(c.id));
}

/**
 * @param {ReturnType<typeof createGame>} game
 * @param {string} action
 */
function playerAct(game, action) {
  const hand = game.hand;
  if (!hand) return;

  const street = hand.street;
  const remaining = remainingForPlayer(hand);
  const advice = getAdvice(street, {
    playerHole: hand.playerHole,
    board: hand.board,
    remaining,
  });
  const wizard = getWizardAdvice(street, {
    playerHole: hand.playerHole,
    board: hand.board,
    remaining,
  });

  const feedback = explainDecision({
    street,
    playerAction: action,
    advice,
    wizard,
  });

  game.stats.decisions += 1;
  if (feedback.correct) game.stats.correct += 1;
  savePersistedStats(game);
  game.lastFeedback = {
    ...feedback,
    street,
    actionLabel: actionLabel(action),
    correctLabel: actionLabel(feedback.correctAction),
    wizardLabel: actionLabel(feedback.wizardAction),
  };
  hand._pendingAction = action;
  continueAfterFeedback(game);
}

/**
 * Continue after feedback acknowledged.
 * @param {ReturnType<typeof createGame>} game
 */
function continueAfterFeedback(game) {
  const hand = game.hand;
  if (!hand) return;
  const action = hand._pendingAction;
  delete hand._pendingAction;

  if (hand.street === "preflop") {
    if (action === "raise4") {
      placePlay(game, 4);
      revealAll(hand);
      finishShowdown(game);
      return;
    }
    // check
    hand.board = hand.fullBoard.slice(0, 3);
    hand.street = "flop";
    game.phase = "flop";
    return;
  }

  if (hand.street === "flop") {
    if (action === "raise2") {
      placePlay(game, 2);
      revealAll(hand);
      finishShowdown(game);
      return;
    }
    hand.board = hand.fullBoard.slice();
    hand.street = "river";
    game.phase = "river";
    return;
  }

  if (hand.street === "river") {
    if (action === "fold") {
      hand.folded = true;
      // ante+blind already deducted; fold loses them (already paid)
      finishShowdown(game);
      return;
    }
    if (action === "raise1") {
      placePlay(game, 1);
      finishShowdown(game);
      return;
    }
  }
}

/** @param {ReturnType<typeof createGame>} game @param {number} mult */
function placePlay(game, mult) {
  const hand = game.hand;
  if (!hand) return;
  hand.playMult = mult;
  hand.playBet = game.ante * mult;
  hand.raised = true;
  game.bankroll -= hand.playBet;
  savePersistedStats(game);
}

/** @param {NonNullable<ReturnType<typeof createGame>['hand']>} hand */
function revealAll(hand) {
  hand.board = hand.fullBoard.slice();
}

/**
 * @param {ReturnType<typeof createGame>} game
 */
function finishShowdown(game) {
  const hand = game.hand;
  if (!hand) return;

  hand.board = hand.fullBoard.slice();
  game.phase = "showdown";

  if (hand.folded) {
    game.showdown = {
      folded: true,
      net: -(ANTE + BLIND),
      message: "You folded. Ante and Blind are lost (−$20).",
    };
    savePersistedStats(game);
    return;
  }

  const playerHand = bestHand(hand.playerHole, hand.board);
  const dealerHand = bestHand(hand.dealerHole, hand.board);
  const cmp = compareHands(playerHand, dealerHand);
  const qualifies = dealerQualifies(dealerHand);
  const winner = cmp > 0 ? "player" : cmp < 0 ? "dealer" : "tie";
  const units = settleUnits({
    winner,
    dealerQualifies: qualifies,
    play: hand.playMult,
    playerHand,
  });

  // Convert units (ante=1) to dollars; ante already deducted, play already deducted
  // settleUnits returns net change relative to ante unit including all bets' P&L.
  // Bankroll currently: started hand paid ante+blind, then paid play.
  // We need to credit winnings.
  const dollarNet = units * game.ante;
  // Amount already taken this hand:
  const alreadyPaid = ANTE + BLIND + hand.playBet;
  // Final bankroll delta from start-of-hand = dollarNet
  // Current bankroll = prehand - alreadyPaid
  // Want posthand = prehand + dollarNet
  // So credit = alreadyPaid + dollarNet
  const credit = alreadyPaid + dollarNet;
  game.bankroll += credit;
  savePersistedStats(game);

  let resultText;
  if (winner === "tie") resultText = "Push — hands tie.";
  else if (winner === "player") {
    resultText = qualifies
      ? "You win! Dealer qualifies."
      : "You win! Dealer does not qualify (Ante pushes).";
  } else {
    resultText = qualifies
      ? "Dealer wins."
      : "Dealer wins but does not qualify (Ante pushes).";
  }

  const blindPay = winner === "player" ? blindPayout(playerHand) * BLIND : 0;

  game.showdown = {
    folded: false,
    winner,
    qualifies,
    playerHand,
    dealerHand,
    units,
    dollarNet,
    blindPay,
    resultText,
    playMult: hand.playMult,
  };
}

window.UTHGame = {
  createGame,
  startHand,
  playerAct,
  continueAfterFeedback,
  remainingForPlayer,
  resetPersistedStats,
  ANTE,
  BLIND,
  actionLabel,
  cardLabel,
};
})();
