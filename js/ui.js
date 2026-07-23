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

  const EMAIL_RE =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  const USERNAME_KEY = "uth-trainer-username";
  const USERNAME_RE = /^[\w .'-]{1,24}$/u;
  const LB_CACHE_KEY = "uth-trainer-leaderboard-cache";

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
    shareModal: document.getElementById("share-modal"),
    shareEmail: document.getElementById("share-email"),
    shareError: document.getElementById("share-error"),
    shareStatus: document.getElementById("share-status"),
    usernameModal: document.getElementById("username-modal"),
    usernameInput: document.getElementById("username-input"),
    usernameError: document.getElementById("username-error"),
    leaderboardModal: document.getElementById("leaderboard-modal"),
    leaderboardStatus: document.getElementById("leaderboard-status"),
    leaderboardBody: document.getElementById("leaderboard-body"),
  };

  var pendingDealAfterUsername = false;
  var leaderboardSort = "bankroll";
  var leaderboardEntries = [];
  var leaderboardUnavailable = false;
  var scoreSyncTimer = null;

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
    scheduleScoreSync();
  }

  function accuracyPercent() {
    const decisions = game.stats.decisions;
    if (!decisions) return 0;
    return Math.round((100 * game.stats.correct) / decisions);
  }

  function loadUsername() {
    try {
      const raw = localStorage.getItem(USERNAME_KEY);
      if (!raw) return "";
      return sanitizeUsername(raw) || "";
    } catch (_) {
      return "";
    }
  }

  function saveUsername(name) {
    try {
      localStorage.setItem(USERNAME_KEY, name);
    } catch (_) {
      /* ignore */
    }
  }

  function sanitizeUsername(raw) {
    const name = String(raw || "")
      .trim()
      .replace(/\s+/g, " ");
    if (!name || name.length > 24) return null;
    if (!USERNAME_RE.test(name)) return null;
    return name;
  }

  function anyModalOpen() {
    return (
      (els.evModal && !els.evModal.hidden) ||
      (els.shareModal && !els.shareModal.hidden) ||
      (els.usernameModal && !els.usernameModal.hidden) ||
      (els.leaderboardModal && !els.leaderboardModal.hidden)
    );
  }

  function syncModalBodyClass() {
    document.body.classList.toggle("ev-modal-open", anyModalOpen());
  }

  function setUsernameError(msg) {
    if (!els.usernameError) return;
    if (msg) {
      els.usernameError.hidden = false;
      els.usernameError.textContent = msg;
    } else {
      els.usernameError.hidden = true;
      els.usernameError.textContent = "";
    }
  }

  function openUsernameModal() {
    if (!els.usernameModal) return;
    closeEvDetails();
    closeShareModal();
    closeLeaderboardModal();
    setUsernameError("");
    if (els.usernameInput) els.usernameInput.value = loadUsername();
    els.usernameModal.hidden = false;
    syncModalBodyClass();
    if (els.usernameInput) els.usernameInput.focus();
  }

  function closeUsernameModal() {
    if (!els.usernameModal || els.usernameModal.hidden) return;
    els.usernameModal.hidden = true;
    syncModalBodyClass();
  }

  function commitUsernameAndMaybeDeal() {
    const cleaned = sanitizeUsername(els.usernameInput ? els.usernameInput.value : "");
    if (!cleaned) {
      setUsernameError("Enter a name (1–24 letters, numbers, spaces, _ - . ').");
      if (els.usernameInput) els.usernameInput.focus();
      return;
    }
    saveUsername(cleaned);
    closeUsernameModal();
    if (pendingDealAfterUsername) {
      pendingDealAfterUsername = false;
      dealNewHandNow();
    }
  }

  function ensureUsernameThenDeal() {
    if (loadUsername()) {
      dealNewHandNow();
      return;
    }
    pendingDealAfterUsername = true;
    openUsernameModal();
  }

  function apiBase() {
    return shareApiBase();
  }

  function currentScorePayload() {
    const username = loadUsername();
    if (!username) return null;
    return {
      username: username,
      bankroll: game.bankroll,
      accuracy: accuracyPercent(),
      hands: game.handNumber,
    };
  }

  function scheduleScoreSync() {
    if (!loadUsername()) return;
    if (scoreSyncTimer) clearTimeout(scoreSyncTimer);
    scoreSyncTimer = setTimeout(function () {
      scoreSyncTimer = null;
      syncScoreToServer();
    }, 1200);
  }

  function syncScoreToServer() {
    const payload = currentScorePayload();
    const base = apiBase();
    if (!payload || !base) return;
    fetch(base + "/api/leaderboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(function () {
      /* play continues offline */
    });
  }

  function loadCachedLeaderboard() {
    try {
      const raw = sessionStorage.getItem(LB_CACHE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.entries)) return null;
      return data;
    } catch (_) {
      return null;
    }
  }

  function saveCachedLeaderboard(entries, sort) {
    try {
      sessionStorage.setItem(
        LB_CACHE_KEY,
        JSON.stringify({ entries: entries, sort: sort, at: Date.now() })
      );
    } catch (_) {
      /* ignore */
    }
  }

  function sortLeaderboardLocal(entries, sortKey) {
    const key = sortKey || "bankroll";
    return entries.slice().sort(function (a, b) {
      const av = Number(a[key]) || 0;
      const bv = Number(b[key]) || 0;
      if (bv !== av) return bv - av;
      const ab = Number(a.bankroll) || 0;
      const bb = Number(b.bankroll) || 0;
      if (bb !== ab) return bb - ab;
      return (Number(b.hands) || 0) - (Number(a.hands) || 0);
    });
  }

  function setLeaderboardStatus(msg, isError) {
    if (!els.leaderboardStatus) return;
    els.leaderboardStatus.textContent = msg || "";
    els.leaderboardStatus.classList.toggle("is-error", !!isError);
  }

  function updateSortButtons() {
    document.querySelectorAll(".lb-sort").forEach(function (btn) {
      const active = btn.getAttribute("data-lb-sort") === leaderboardSort;
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function renderLeaderboardTable() {
    if (!els.leaderboardBody) return;
    updateSortButtons();
    const ranked = sortLeaderboardLocal(leaderboardEntries, leaderboardSort).slice(0, 10);
    if (!ranked.length) {
      els.leaderboardBody.innerHTML =
        '<tr><td colspan="5" class="lb-empty">No scores yet — deal a hand and claim the board.</td></tr>';
      return;
    }
    els.leaderboardBody.innerHTML = ranked
      .map(function (row, i) {
        const name = escapeHtml(String(row.username || "—"));
        const bank = money(Number(row.bankroll) || 0);
        const acc = Math.round(Number(row.accuracy) || 0) + "%";
        const hands = String(Math.max(0, Math.floor(Number(row.hands) || 0)));
        return (
          "<tr>" +
          '<td class="lb-rank">' +
          (i + 1) +
          "</td>" +
          '<td class="lb-player" title="' +
          name +
          '">' +
          name +
          "</td>" +
          '<td class="lb-num">' +
          bank +
          "</td>" +
          '<td class="lb-num">' +
          acc +
          "</td>" +
          '<td class="lb-num">' +
          hands +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function fetchLeaderboard() {
    const base = apiBase();
    if (!base) {
      leaderboardUnavailable = true;
      const cached = loadCachedLeaderboard();
      if (cached) {
        leaderboardEntries = cached.entries;
        setLeaderboardStatus("Leaderboard unavailable — showing last cached scores.", true);
        renderLeaderboardTable();
        return;
      }
      leaderboardEntries = [];
      setLeaderboardStatus(
        "Leaderboard unavailable. Set apiUrl in js/email-config.js (see SHARE_EMAIL.md), or open via python serve.py.",
        true
      );
      renderLeaderboardTable();
      return;
    }

    setLeaderboardStatus("Loading…");
    fetch(base + "/api/leaderboard?sort=" + encodeURIComponent(leaderboardSort) + "&limit=50")
      .then(function (res) {
        return res.json().then(
          function (data) {
            return { res: res, data: data };
          },
          function () {
            return { res: res, data: null };
          }
        );
      })
      .then(function (result) {
        if (!result.res.ok || !result.data || !result.data.ok || !Array.isArray(result.data.entries)) {
          throw new Error("bad response");
        }
        leaderboardUnavailable = false;
        leaderboardEntries = result.data.entries;
        saveCachedLeaderboard(leaderboardEntries, leaderboardSort);
        const you = loadUsername();
        setLeaderboardStatus(you ? "Playing as " + you : "Top 10 — click a column to sort");
        renderLeaderboardTable();
      })
      .catch(function () {
        leaderboardUnavailable = true;
        const cached = loadCachedLeaderboard();
        if (cached) {
          leaderboardEntries = cached.entries;
          setLeaderboardStatus("Leaderboard unavailable — showing last cached scores.", true);
        } else {
          leaderboardEntries = [];
          setLeaderboardStatus("Leaderboard unavailable — play continues offline.", true);
        }
        renderLeaderboardTable();
      });
  }

  function openLeaderboardModal() {
    if (!els.leaderboardModal) return;
    closeEvDetails();
    closeShareModal();
    closeUsernameModal();
    els.leaderboardModal.hidden = false;
    syncModalBodyClass();
    fetchLeaderboard();
    const closeBtn = els.leaderboardModal.querySelector(".ev-modal-close");
    if (closeBtn) closeBtn.focus();
  }

  function closeLeaderboardModal() {
    if (!els.leaderboardModal || els.leaderboardModal.hidden) return;
    els.leaderboardModal.hidden = true;
    syncModalBodyClass();
  }

  function setLeaderboardSort(sortKey) {
    if (sortKey !== "bankroll" && sortKey !== "accuracy" && sortKey !== "hands") return;
    leaderboardSort = sortKey;
    if (leaderboardEntries.length) {
      renderLeaderboardTable();
      if (!leaderboardUnavailable) {
        const you = loadUsername();
        setLeaderboardStatus(you ? "Playing as " + you : "Top 10 — click a column to sort");
      }
      return;
    }
    fetchLeaderboard();
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

  function dealNewHandNow() {
    if (dealing) return;
    dealing = true;
    try {
      closeEvDetails();
      closeShareModal();
      closeLeaderboardModal();
      gameApi.startHand(game);
      render();
      scheduleScoreSync();
    } catch (err) {
      console.error(err);
      alert("Deal failed: " + (err && err.message ? err.message : err));
    } finally {
      dealing = false;
    }
  }

  function dealNewHand() {
    ensureUsernameThenDeal();
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
      (fb.pedagogyNote
        ? '<p class="feedback-pedagogy">' + escapeHtml(fb.pedagogyNote) + "</p>"
        : "") +
      '<button type="button" class="ev-details-btn" id="btn-ev-details">More details</button>';
  }

  function openEvDetails() {
    const fb = game.lastFeedback;
    if (!fb || !els.evModal || !els.evModalList) return;
    closeShareModal();
    closeLeaderboardModal();
    els.evModalList.innerHTML = (fb.detailLines || [])
      .map(function (line) {
        return "<li>" + escapeHtml(line) + "</li>";
      })
      .join("");
    els.evModal.hidden = false;
    syncModalBodyClass();
    const body = els.evModal.querySelector(".ev-modal-body");
    if (body) body.scrollTop = 0;
    const closeBtn = els.evModal.querySelector(".ev-modal-close");
    if (closeBtn) closeBtn.focus();
  }

  function closeEvDetails() {
    if (!els.evModal || els.evModal.hidden) return;
    els.evModal.hidden = true;
    syncModalBodyClass();
  }

  function setShareError(msg) {
    if (!els.shareError) return;
    if (msg) {
      els.shareError.hidden = false;
      els.shareError.textContent = msg;
    } else {
      els.shareError.hidden = true;
      els.shareError.textContent = "";
    }
  }

  function setShareStatus(msg, isError) {
    if (!els.shareStatus) return;
    if (msg) {
      els.shareStatus.hidden = false;
      els.shareStatus.textContent = msg;
      els.shareStatus.classList.toggle("is-error", !!isError);
    } else {
      els.shareStatus.hidden = true;
      els.shareStatus.textContent = "";
      els.shareStatus.classList.remove("is-error");
    }
  }

  function isStaticShareHost() {
    const host = location.hostname || "";
    return /\.github\.io$/i.test(host) || /\.pages\.dev$/i.test(host);
  }

  function isLocalDevHost() {
    const host = location.hostname || "";
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  }

  function shareApiBase() {
    const cfg = window.UTHEmailConfig || {};
    // Local serve.py: always same-origin so a Pages tunnel apiUrl can't break local testing.
    if (isLocalDevHost() && (location.protocol === "http:" || location.protocol === "https:")) {
      return location.origin;
    }
    if (cfg.apiUrl && String(cfg.apiUrl).trim()) {
      return String(cfg.apiUrl).trim().replace(/\/$/, "");
    }
    // GitHub Pages / static hosts have no /api/send-email unless apiUrl is set.
    if (isStaticShareHost()) {
      return "";
    }
    if (location.protocol === "http:" || location.protocol === "https:") {
      return location.origin;
    }
    return "";
  }

  function formatShareSendError(res, data) {
    const serverErr = data && data.error ? String(data.error) : "";
    if (serverErr) return serverErr;
    if (!res) {
      return "Could not reach share API. Run python serve.py and open http://127.0.0.1:8765/";
    }
    if (res.status === 501 || res.status === 404 || res.status === 405) {
      return (
        "Share API not available (HTTP " +
        res.status +
        "). Stop python -m http.server if running, then: python serve.py — open http://127.0.0.1:8765/ (SMTP does not work on GitHub Pages)."
      );
    }
    return (
      "Failed to send (HTTP " +
      res.status +
      "). Try Copy text, or check config.txt / serve.py (see SHARE_EMAIL.md)."
    );
  }

  function openShareModal() {
    if (!els.shareModal || game.phase !== "showdown") return;
    closeEvDetails();
    closeLeaderboardModal();
    setShareError("");
    setShareStatus("");
    if (els.shareEmail) els.shareEmail.value = "";
    els.shareModal.hidden = false;
    syncModalBodyClass();
    if (els.shareEmail) els.shareEmail.focus();
  }

  function closeShareModal() {
    if (!els.shareModal || els.shareModal.hidden) return;
    els.shareModal.hidden = true;
    syncModalBodyClass();
  }

  function currentShareSummary() {
    return gameApi.buildHandShareSummary(game);
  }

  function copyShareSummary() {
    const text = currentShareSummary();
    if (!text) {
      setShareError("No hand summary available.");
      return;
    }
    setShareError("");
    function done() {
      setShareStatus("Copied to clipboard.");
    }
    function fail() {
      setShareStatus("Could not copy — select and copy manually.", true);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fail);
      return;
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) done();
      else fail();
    } catch (_) {
      fail();
    }
  }

  function sendShareEmail() {
    const raw = els.shareEmail ? els.shareEmail.value.trim() : "";
    setShareError("");
    setShareStatus("");

    if (!raw) {
      setShareError("Enter a recipient email.");
      if (els.shareEmail) els.shareEmail.focus();
      return;
    }
    if (!EMAIL_RE.test(raw)) {
      setShareError("That email doesn’t look valid.");
      if (els.shareEmail) els.shareEmail.focus();
      return;
    }

    const message = currentShareSummary();
    if (!message) {
      setShareError("No hand summary available.");
      return;
    }

    const subject = "Ultimate Texas Hold'em — Hand #" + game.handNumber;
    const cfg = window.UTHEmailConfig || {};
    const configuredApi = !!(cfg.apiUrl && String(cfg.apiUrl).trim());
    const base = shareApiBase();

    if (!base) {
      setShareStatus(
        "Share API not configured for this host. Set apiUrl in js/email-config.js to your HTTPS serve.py URL (see SHARE_EMAIL.md), or open http://127.0.0.1:8765/",
        true
      );
      return;
    }

    const sendBtn = document.getElementById("btn-share-send");
    if (sendBtn) sendBtn.disabled = true;
    setShareStatus("Sending…");

    fetch(base + "/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: raw, subject: subject, message: message }),
    })
      .then(function (res) {
        return res.json().then(
          function (data) {
            return { res: res, data: data };
          },
          function () {
            return { res: res, data: null };
          }
        );
      })
      .then(function (result) {
        const res = result.res;
        const data = result.data;
        if (res.ok && data && data.ok) {
          setShareStatus("Sent.");
          return;
        }
        setShareStatus(formatShareSendError(res, data), true);
      })
      .catch(function (err) {
        console.error(err);
        const detail = err && err.message ? err.message : "network error";
        if (configuredApi) {
          setShareStatus(
            "Could not reach share API (" +
              detail +
              "). Is serve.py + the HTTPS tunnel/host in email-config.js still running?",
            true
          );
          return;
        }
        setShareStatus(
          "Could not reach share API (" +
            detail +
            "). Run python serve.py and open http://127.0.0.1:8765/",
          true
        );
      })
      .finally(function () {
        if (sendBtn) sendBtn.disabled = false;
      });
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
        '<button class="btn-share" id="btn-share" type="button">Share</button>' +
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

  // Single click path for deal / details / share (delegation). Avoids lost handlers after innerHTML swaps.
  document.addEventListener("click", function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var dealBtn = t.id === "btn-deal" ? t : t.closest("#btn-deal");
    if (dealBtn) {
      ev.preventDefault();
      dealNewHand();
      return;
    }
    if (t.closest("#btn-share")) {
      ev.preventDefault();
      openShareModal();
      return;
    }
    if (t.closest("#btn-share-send")) {
      ev.preventDefault();
      sendShareEmail();
      return;
    }
    if (t.closest("#btn-share-copy")) {
      ev.preventDefault();
      copyShareSummary();
      return;
    }
    if (t.closest("#btn-leaderboard")) {
      ev.preventDefault();
      openLeaderboardModal();
      return;
    }
    if (t.closest("#btn-username-save")) {
      ev.preventDefault();
      commitUsernameAndMaybeDeal();
      return;
    }
    var sortBtn = t.closest("[data-lb-sort]");
    if (sortBtn) {
      ev.preventDefault();
      setLeaderboardSort(sortBtn.getAttribute("data-lb-sort"));
      return;
    }
    if (t.closest("#btn-reset-stats")) {
      ev.preventDefault();
      if (!confirm("Reset bankroll, accuracy, and hands?")) return;
      gameApi.resetPersistedStats(game);
      updateStats();
      return;
    }
    if (t.closest("#btn-ev-details")) {
      ev.preventDefault();
      openEvDetails();
      return;
    }
    if (t.closest("[data-lb-close]")) {
      ev.preventDefault();
      closeLeaderboardModal();
      return;
    }
    if (t.closest("[data-share-close]")) {
      ev.preventDefault();
      closeShareModal();
      return;
    }
    if (t.closest("[data-ev-close]")) {
      ev.preventDefault();
      closeEvDetails();
    }
  });

  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") {
      if (els.usernameModal && !els.usernameModal.hidden) {
        // Username required before first hand — Escape cancels pending deal only.
        pendingDealAfterUsername = false;
        closeUsernameModal();
        return;
      }
      closeLeaderboardModal();
      closeShareModal();
      closeEvDetails();
    }
  });

  if (els.shareEmail) {
    els.shareEmail.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        sendShareEmail();
      }
    });
  }

  if (els.usernameInput) {
    els.usernameInput.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        commitUsernameAndMaybeDeal();
      }
    });
  }

  window.addEventListener("pagehide", function () {
    if (scoreSyncTimer) {
      clearTimeout(scoreSyncTimer);
      scoreSyncTimer = null;
    }
    syncScoreToServer();
  });

  render();
})();
