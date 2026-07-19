(function () {
  "use strict";

  function bootError(msg) {
    const body = document.getElementById("instructions-body");
    if (body) {
      body.innerHTML =
        "<p class=\"phase-help\">" +
        msg +
        "</p><p class=\"phase-help\">Hard-refresh with Ctrl+F5, or open http://127.0.0.1:8765/</p>";
    }
    console.error(msg);
  }

  if (!window.UTHCards || !window.UTHHand || !window.UTHWizard || !window.UTHStrategy || !window.UTHGame || !window.UTHEv) {
    bootError(
      "Game scripts failed to load. Missing: " +
        [
          !window.UTHCards && "cards",
          !window.UTHHand && "hand",
          !window.UTHWizard && "wizard",
          !window.UTHStrategy && "strategy",
          !window.UTHGame && "game",
          !window.UTHEv && "ev",
        ]
          .filter(Boolean)
          .join(", ")
    );
    return;
  }

  const gameApi = window.UTHGame;
  const { RANK_LABELS, SUIT_SYMBOLS, isRed, cardLabel } = window.UTHCards;
  const { bestHand } = window.UTHHand;
  const { actionLabel } = window.UTHEv;

  const game = gameApi.createGame();

  const els = {
    bankroll: document.getElementById("bankroll"),
    accuracy: document.getElementById("accuracy"),
    hands: document.getElementById("hands"),
    dealerCards: document.getElementById("dealer-cards"),
    playerCards: document.getElementById("player-cards"),
    board: document.getElementById("board"),
    dealerHandName: document.getElementById("dealer-hand-name"),
    playerHandName: document.getElementById("player-hand-name"),
    chipAnte: document.getElementById("chip-ante"),
    chipBlind: document.getElementById("chip-blind"),
    chipPlay: document.getElementById("chip-play"),
    instructions: document.getElementById("instructions-body"),
    evaluation: document.getElementById("evaluation-body"),
    sectionEvaluation: document.getElementById("section-evaluation"),
    mobileVerdict: document.getElementById("mobile-verdict"),
    evModal: document.getElementById("ev-modal"),
    evModalList: document.getElementById("ev-modal-list"),
  };

  function money(n) {
    const sign = n < 0 ? "−" : "";
    return sign + "$" + Math.abs(n).toFixed(0);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderCard(card, opts) {
    opts = opts || {};
    if (opts.ghost) {
      return '<div class="card ghost" aria-hidden="true"></div>';
    }
    if (opts.back) {
      return '<div class="card back" title="Face down"></div>';
    }
    const red = isRed(card) ? "red" : "";
    const rank = RANK_LABELS[card.rank];
    const suit = SUIT_SYMBOLS[card.suit];
    return (
      '<div class="card ' +
      red +
      '" title="' +
      cardLabel(card) +
      '">' +
      '<div class="rank">' +
      rank +
      "</div>" +
      '<div class="suit">' +
      suit +
      "</div>" +
      '<div class="rank bottom">' +
      rank +
      "</div>" +
      "</div>"
    );
  }

  function updateStats() {
    els.bankroll.textContent = money(game.bankroll);
    els.hands.textContent = String(game.handNumber);
    const decisions = game.stats.decisions;
    const correct = game.stats.correct;
    els.accuracy.textContent =
      decisions === 0 ? "—" : Math.round((100 * correct) / decisions) + "% (" + correct + "/" + decisions + ")";
  }

  function setChip(label, amount, empty) {
    const map = { Ante: els.chipAnte, Blind: els.chipBlind, Play: els.chipPlay };
    const el = map[label];
    if (!el) return;
    el.classList.toggle("empty", empty);
    el.innerHTML = empty
      ? "<strong>—</strong>" + label
      : "<strong>$" + amount + "</strong>" + label;
  }

  function renderTable() {
    updateStats();
    const hand = game.hand;

    if (!hand) {
      els.dealerCards.innerHTML = renderCard(null, { ghost: true }) + renderCard(null, { ghost: true });
      els.playerCards.innerHTML = renderCard(null, { ghost: true }) + renderCard(null, { ghost: true });
      els.board.innerHTML =
        renderCard(null, { ghost: true }) +
        renderCard(null, { ghost: true }) +
        renderCard(null, { ghost: true }) +
        renderCard(null, { ghost: true }) +
        renderCard(null, { ghost: true });
      els.dealerHandName.textContent = "";
      els.playerHandName.textContent = "";
      setChip("Ante", 0, true);
      setChip("Blind", 0, true);
      setChip("Play", 0, true);
      return;
    }

    const showDealer = game.phase === "showdown";
    if (showDealer) {
      els.dealerCards.innerHTML = hand.dealerHole.map(function (c) {
        return renderCard(c);
      }).join("");
    } else {
      els.dealerCards.innerHTML = renderCard(null, { back: true }) + renderCard(null, { back: true });
    }

    els.playerCards.innerHTML = hand.playerHole.map(function (c) {
      return renderCard(c);
    }).join("");

    var boardSlots = [];
    for (var i = 0; i < 5; i++) {
      boardSlots.push(hand.board[i] ? renderCard(hand.board[i]) : renderCard(null, { ghost: true }));
    }
    els.board.innerHTML = boardSlots.join("");

    if (hand.board.length >= 5) {
      els.playerHandName.textContent = bestHand(hand.playerHole, hand.board).name;
      els.dealerHandName.textContent = showDealer ? bestHand(hand.dealerHole, hand.board).name : "";
    } else if (hand.board.length >= 3) {
      els.playerHandName.textContent = bestHand(hand.playerHole, hand.board).name;
      els.dealerHandName.textContent = "";
    } else {
      els.playerHandName.textContent = "";
      els.dealerHandName.textContent = "";
    }

    setChip("Ante", game.ante, false);
    setChip("Blind", game.ante, false);
    if (hand.playBet > 0) setChip("Play", hand.playBet, false);
    else setChip("Play", 0, true);
  }

  var dealing = false;

  function dealNewHand() {
    if (dealing) return;
    dealing = true;
    try {
      closeEvDetails();
      gameApi.startHand(game);
      render();
    } catch (err) {
      console.error(err);
      alert("Deal failed: " + (err && err.message ? err.message : err));
    } finally {
      dealing = false;
    }
  }

  window.startUTHHand = dealNewHand;

  function streetNeedsCompute(phase) {
    return phase === "preflop" || phase === "flop" || phase === "river";
  }

  function renderEvaluation() {
    const fb = game.lastFeedback;
    els.sectionEvaluation.classList.remove("has-correct", "has-wrong");

    if (!fb) {
      closeEvDetails();
      els.evaluation.innerHTML =
        '<p class="panel-placeholder">Decision feedback will appear here after you bet.</p>';
      return;
    }

    els.sectionEvaluation.classList.add(fb.correct ? "has-correct" : "has-wrong");

    const verdict = fb.correct ? "Correct" : "Wrong";
    const choiceLine = fb.correct
      ? "You played <strong>" + escapeHtml(fb.actionLabel) + "</strong>."
      : "You played <strong>" +
        escapeHtml(fb.actionLabel) +
        "</strong> — best is <strong>" +
        escapeHtml(fb.correctLabel) +
        "</strong>.";

    els.evaluation.innerHTML =
      '<div class="feedback-verdict">' +
      verdict +
      "</div>" +
      '<p class="feedback-choice">' +
      choiceLine +
      "</p>" +
      '<p class="feedback-line"><span class="feedback-tag">EV</span> ' +
      escapeHtml(fb.briefEv) +
      "</p>" +
      '<p class="feedback-line"><span class="feedback-tag">Wizard</span> ' +
      escapeHtml(fb.briefWizard) +
      "</p>" +
      '<button type="button" class="ev-details-btn" id="btn-ev-details">More details</button>';
  }

  function openEvDetails() {
    const fb = game.lastFeedback;
    if (!fb || !els.evModal || !els.evModalList) return;
    els.evModalList.innerHTML = (fb.detailLines || [])
      .map(function (line) {
        return "<li>" + escapeHtml(line) + "</li>";
      })
      .join("");
    els.evModal.hidden = false;
    document.body.classList.add("ev-modal-open");
    const closeBtn = els.evModal.querySelector(".ev-modal-close");
    if (closeBtn) closeBtn.focus();
  }

  function closeEvDetails() {
    if (!els.evModal || els.evModal.hidden) return;
    els.evModal.hidden = true;
    document.body.classList.remove("ev-modal-open");
  }

  function resultBanner(sd) {
    if (sd.folded) {
      return { label: "Fold", cls: "result-banner--fold" };
    }
    if (sd.winner === "player") {
      return { label: "Win", cls: "result-banner--win" };
    }
    if (sd.winner === "dealer") {
      return { label: "Loss", cls: "result-banner--loss" };
    }
    return { label: "Push", cls: "result-banner--push" };
  }

  function syncVerdict() {
    if (!els.mobileVerdict) return;
    const sd = game.showdown;
    if (!sd) {
      els.mobileVerdict.hidden = true;
      els.mobileVerdict.textContent = "";
      els.mobileVerdict.className = "mobile-verdict";
      return;
    }
    const banner = resultBanner(sd);
    els.mobileVerdict.hidden = false;
    els.mobileVerdict.textContent = banner.label;
    els.mobileVerdict.className = "mobile-verdict " + banner.cls;
  }

  function bindActionButtons() {
    const buttons = els.instructions.querySelectorAll("[data-act]");
    for (var i = 0; i < buttons.length; i++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          const act = btn.getAttribute("data-act");
          btn.disabled = true;
          if (streetNeedsCompute(game.phase)) btn.textContent = "Computing odds…";
          setTimeout(function () {
            try {
              gameApi.playerAct(game, act);
              render();
            } catch (err) {
              console.error(err);
              alert("Action failed: " + (err && err.message ? err.message : err));
              render();
            }
          }, 20);
        });
      })(buttons[i]);
    }
  }

  function renderInstructions() {
    const phase = game.phase;

    if (phase === "idle") {
      els.instructions.innerHTML =
        '<div class="actions">' +
        '<button class="btn-primary" id="btn-deal" type="button">Deal new hand</button>' +
        "</div>";
      return;
    }

    if (phase === "showdown") {
      els.instructions.innerHTML =
        '<div class="actions">' +
        '<button class="btn-primary" id="btn-deal" type="button">Deal next hand</button>' +
        "</div>";
      return;
    }

    if (phase === "preflop") {
      els.instructions.innerHTML =
        '<div class="actions">' +
        '<button class="btn-raise" type="button" data-act="raise4">Raise $40 (4×)</button>' +
        '<button class="btn-check" type="button" data-act="check">Check</button>' +
        "</div>";
    } else if (phase === "flop") {
      els.instructions.innerHTML =
        '<div class="actions">' +
        '<button class="btn-raise" type="button" data-act="raise2">Raise $20 (2×)</button>' +
        '<button class="btn-check" type="button" data-act="check">Check</button>' +
        "</div>";
    } else if (phase === "river") {
      els.instructions.innerHTML =
        '<div class="actions">' +
        '<button class="btn-raise" type="button" data-act="raise1">Raise $10 (1×)</button>' +
        '<button class="btn-fold" type="button" data-act="fold">Fold</button>' +
        "</div>";
    }

    bindActionButtons();
  }

  function render() {
    try {
      renderTable();
      renderInstructions();
      renderEvaluation();
      syncVerdict();
    } catch (err) {
      console.error(err);
      els.instructions.innerHTML =
        '<p class="phase-help">' +
        escapeHtml(err && err.message ? err.message : err) +
        "</p>" +
        '<div class="actions">' +
        '<button class="btn-primary" id="btn-deal" type="button">Deal new hand</button>' +
        "</div>";
    }
  }

  // Single click path for deal / details (delegation). Avoids lost handlers after innerHTML swaps.
  document.addEventListener("click", function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var dealBtn = t.id === "btn-deal" ? t : t.closest("#btn-deal");
    if (dealBtn) {
      ev.preventDefault();
      dealNewHand();
      return;
    }
    if (t.closest("#btn-ev-details")) {
      ev.preventDefault();
      openEvDetails();
      return;
    }
    if (t.closest("[data-ev-close]")) {
      ev.preventDefault();
      closeEvDetails();
    }
  });

  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") closeEvDetails();
  });

  render();
})();
