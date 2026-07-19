/** @typedef {{ rank: number, suit: string, id: string }} Card */
(function () {
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const SUITS = ["c", "d", "h", "s"];
const RANK_LABELS = {
  2: "2",
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "10",
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
};
const SUIT_SYMBOLS = { c: "♣", d: "♦", h: "♥", s: "♠" };
const SUIT_NAMES = { c: "clubs", d: "diamonds", h: "hearts", s: "spades" };

/** @returns {Card[]} */
function createDeck() {
  /** @type {Card[]} */
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit, id: `${RANK_LABELS[rank]}${suit}` });
    }
  }
  return deck;
}

/** @param {Card[]} deck */
function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/** @param {Card} card */
function cardLabel(card) {
  return `${RANK_LABELS[card.rank]}${SUIT_SYMBOLS[card.suit]}`;
}

/** @param {Card} card */
function isRed(card) {
  return card.suit === "h" || card.suit === "d";
}

window.UTHCards = {
  RANKS,
  SUITS,
  RANK_LABELS,
  SUIT_SYMBOLS,
  SUIT_NAMES,
  createDeck,
  shuffle,
  cardLabel,
  isRed,
};
})();
