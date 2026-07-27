(function () {
  const moves = ["rock", "paper", "scissors"];
  const counters = { rock: "paper", paper: "scissors", scissors: "rock" };
  const losesTo = { rock: "scissors", paper: "rock", scissors: "paper" };
  const display = { rock: "Rock", paper: "Paper", scissors: "Scissors" };
  const page = document.body.dataset.page;

  function normalize(scores) {
    const floor = 0.001;
    const total = moves.reduce((sum, move) => sum + Math.max(floor, scores[move] || 0), 0);
    return Object.fromEntries(moves.map((move) => [move, Math.max(floor, scores[move] || 0) / total]));
  }

  function blankScores(value = 0) {
    return { rock: value, paper: value, scissors: value };
  }

  function winner(human, ai) {
    if (human === ai) return "tie";
    return losesTo[human] === ai ? "human" : "ai";
  }

  function entropy(distribution) {
    const maxEntropy = Math.log2(3);
    const raw = moves.reduce((sum, move) => {
      const p = distribution[move];
      return sum - (p > 0 ? p * Math.log2(p) : 0);
    }, 0);
    return raw / maxEntropy;
  }

  function bestMove(distribution) {
    return moves.reduce((best, move) => distribution[move] > distribution[best] ? move : best, "rock");
  }

  function mix(a, b, t) {
    const mixed = blankScores();
    moves.forEach((move) => {
      mixed[move] = a[move] * (1 - t) + b[move] * t;
    });
    return normalize(mixed);
  }

  function makePredictors(history) {
    const n = history.length;
    const last = history[n - 1];
    const prior = blankScores(1);

    const globalCounts = () => {
      const scores = { ...prior };
      history.forEach((round) => scores[round.human] += 1);
      return {
        name: "global frequency",
        dist: normalize(scores),
        confidence: Math.min(0.85, n / 18),
        reason: "Your full match history is tilted."
      };
    };

    const recencyCounts = () => {
      const scores = blankScores(0.8);
      history.slice().reverse().forEach((round, index) => {
        scores[round.human] += Math.pow(0.82, index);
      });
      return {
        name: "recency pulse",
        dist: normalize(scores),
        confidence: Math.min(0.92, n / 10),
        reason: "Recent throws are more predictive than old throws."
      };
    };

    const markovOne = () => {
      const scores = blankScores(0.55);
      if (!last) {
        return { name: "one-step Markov", dist: normalize(scores), confidence: 0, reason: "No previous throw yet." };
      }
      let matches = 0;
      for (let i = 1; i < history.length; i += 1) {
        if (history[i - 1].human === last.human) {
          scores[history[i].human] += 1;
          matches += 1;
        }
      }
      return {
        name: "one-step Markov",
        dist: normalize(scores),
        confidence: Math.min(0.96, matches / 5),
        reason: `You have followed ${display[last.human]} in a recognizable way.`
      };
    };

    const markovTwo = () => {
      const scores = blankScores(0.45);
      if (history.length < 2) {
        return { name: "two-step Markov", dist: normalize(scores), confidence: 0, reason: "Needs two prior throws." };
      }
      const a = history[history.length - 2].human;
      const b = history[history.length - 1].human;
      let matches = 0;
      for (let i = 2; i < history.length; i += 1) {
        if (history[i - 2].human === a && history[i - 1].human === b) {
          scores[history[i].human] += 1.5;
          matches += 1;
        }
      }
      return {
        name: "two-step Markov",
        dist: normalize(scores),
        confidence: Math.min(1, matches / 3),
        reason: `The pair ${display[a]} then ${display[b]} has repeated.`
      };
    };

    const outcomeResponse = () => {
      const scores = blankScores(0.35);
      if (!last) {
        scores.rock += 0.25;
        return {
          name: "outcome response",
          dist: normalize(scores),
          confidence: 0.08,
          reason: "Opening players slightly overuse rock."
        };
      }

      let matches = 0;
      for (let i = 1; i < history.length; i += 1) {
        if (history[i - 1].result === last.result) {
          scores[history[i].human] += 1;
          matches += 1;
        }
      }

      if (last.result === "human") {
        scores[last.human] += 1.25;
      } else if (last.result === "ai") {
        scores[counters[last.ai]] += 1.15;
      } else {
        scores[counters[last.human]] += 0.8;
      }

      return {
        name: "outcome response",
        dist: normalize(scores),
        confidence: Math.min(0.88, 0.22 + matches / 7),
        reason: "Your next move is often shaped by the last outcome."
      };
    };

    const antiRepeat = () => {
      const scores = blankScores(0.7);
      if (!last) {
        return { name: "anti-repeat trap", dist: normalize(scores), confidence: 0, reason: "Needs a streak." };
      }
      let streak = 1;
      for (let i = history.length - 2; i >= 0; i -= 1) {
        if (history[i].human !== last.human) break;
        streak += 1;
      }
      if (streak >= 2) {
        scores[counters[last.human]] += 1.2 + streak * 0.45;
        scores[last.human] -= 0.2;
      } else {
        scores[last.human] += 0.35;
      }
      return {
        name: "anti-repeat trap",
        dist: normalize(scores),
        confidence: Math.min(0.84, streak / 4),
        reason: streak >= 2 ? "Long repeats often break toward the counter-move." : "No long repeat to attack."
      };
    };

    const beatLastAi = () => {
      const scores = blankScores(0.6);
      if (!last) {
        return { name: "revenge read", dist: normalize(scores), confidence: 0, reason: "No AI move to react to yet." };
      }
      scores[counters[last.ai]] += last.result === "ai" ? 1.4 : 0.55;
      return {
        name: "revenge read",
        dist: normalize(scores),
        confidence: last.result === "ai" ? 0.54 : 0.22,
        reason: "Players often try to beat the AI move they just saw."
      };
    };

    return [globalCounts(), recencyCounts(), markovOne(), markovTwo(), outcomeResponse(), antiRepeat(), beatLastAi()];
  }

  function chooseAiMove(history, modelStats) {
    const predictors = makePredictors(history);
    const combined = blankScores(0);
    let totalWeight = 0;
    let trusted = predictors[0];
    let trustedWeight = -Infinity;

    predictors.forEach((predictor) => {
      const stats = modelStats[predictor.name] || { seen: 0, correct: 0 };
      const accuracy = (stats.correct + 1) / (stats.seen + 3);
      const sharpness = 1 - entropy(predictor.dist);
      const weight = predictor.confidence * (0.55 + accuracy * 1.85) * (0.72 + sharpness);
      predictor.weight = weight;
      predictor.pick = bestMove(predictor.dist);
      if (weight > trustedWeight) {
        trusted = predictor;
        trustedWeight = weight;
      }
      moves.forEach((move) => {
        combined[move] += predictor.dist[move] * weight;
      });
      totalWeight += weight;
    });

    const fallback = history.length === 0
      ? normalize({ rock: 1.28, paper: 1, scissors: 0.95 })
      : normalize({ rock: 1, paper: 1, scissors: 1 });
    const raw = totalWeight > 0.01 ? normalize(combined) : fallback;
    const confidence = Math.max(0, Math.min(1, 1 - entropy(raw)));
    const exploration = history.length < 4 ? 0.22 : confidence < 0.16 ? 0.18 : 0.05;
    const predicted = bestMove(mix(raw, fallback, exploration));
    const ai = counters[predicted];

    return {
      ai,
      predicted,
      probabilities: mix(raw, fallback, exploration),
      confidence,
      trusted,
      predictors: predictors.map((predictor) => ({
        name: predictor.name,
        pick: predictor.pick,
        weight: predictor.weight,
        dist: predictor.dist
      }))
    };
  }

  function initGame() {
    const target = 7;
    const state = {
      history: [],
      score: { human: 0, ai: 0, tie: 0 },
      modelStats: {},
      streak: { owner: null, count: 0 },
      over: false,
      thinking: false
    };

    const els = {
      buttons: Array.from(document.querySelectorAll("[data-move]")),
      playerScore: document.getElementById("playerScore"),
      aiScore: document.getElementById("aiScore"),
      tieScore: document.getElementById("tieScore"),
      roundStatus: document.getElementById("roundStatus"),
      matchState: document.getElementById("matchState"),
      pressureLabel: document.getElementById("pressureLabel"),
      pressureValue: document.getElementById("pressureValue"),
      pressureMeter: document.getElementById("pressureMeter"),
      streakValue: document.getElementById("streakValue"),
      readValue: document.getElementById("readValue"),
      playerThrow: document.getElementById("playerThrow"),
      aiThrow: document.getElementById("aiThrow"),
      resultText: document.getElementById("resultText"),
      confidenceValue: document.getElementById("confidenceValue"),
      trustedModel: document.getElementById("trustedModel"),
      modelReason: document.getElementById("modelReason"),
      log: document.getElementById("roundLog"),
      reset: document.getElementById("resetGame")
    };

    function updateStats(plan, humanMove) {
      plan.predictors.forEach((predictor) => {
        if (!state.modelStats[predictor.name]) {
          state.modelStats[predictor.name] = { seen: 0, correct: 0 };
        }
        state.modelStats[predictor.name].seen += 1;
        if (predictor.pick === humanMove) {
          state.modelStats[predictor.name].correct += 1;
        }
      });
    }

    function updateStreak(result) {
      if (result === "tie") return;
      if (state.streak.owner === result) {
        state.streak.count += 1;
      } else {
        state.streak = { owner: result, count: 1 };
      }
    }

    function pressureText(diff) {
      if (diff >= 3) return "You lead";
      if (diff <= -3) return "AI lead";
      if (diff > 0) return "Edge";
      if (diff < 0) return "Danger";
      return "Even";
    }

    function render(plan) {
      const diff = state.score.human - state.score.ai;
      els.playerScore.textContent = state.score.human;
      els.aiScore.textContent = state.score.ai;
      els.tieScore.textContent = state.score.tie;
      els.roundStatus.textContent = state.over ? "Match over" : `Round ${state.history.length + 1}`;
      els.matchState.textContent = state.over
        ? state.score.human >= target ? "You win" : "AI wins"
        : state.score.human === target - 1 || state.score.ai === target - 1 ? "Match point" : "Race to 7";
      els.matchState.className = `match-chip ${state.over ? "is-over" : ""}`;
      els.pressureLabel.textContent = pressureText(diff);
      els.pressureValue.textContent = diff > 0 ? `+${diff}` : String(diff);
      els.pressureMeter.value = diff;
      els.streakValue.textContent = state.streak.owner
        ? `${state.streak.owner === "human" ? "You" : "AI"} x${state.streak.count}`
        : "0";

      const confidence = plan ? plan.confidence : 0;
      els.confidenceValue.textContent = `${Math.round(confidence * 100)}%`;
      els.readValue.textContent = plan ? display[plan.predicted] : "none";
      els.trustedModel.textContent = plan ? plan.trusted.name : "Cold read";
      els.modelReason.textContent = plan ? plan.trusted.reason : "No pattern yet.";
      els.buttons.forEach((button) => {
        button.disabled = state.over || state.thinking;
      });
      els.log.closest(".history-band").classList.toggle("is-empty", state.history.length === 0);

      els.log.innerHTML = state.history.slice(-12).reverse().map((round) => {
        const label = round.result === "human" ? "Win" : round.result === "ai" ? "Loss" : "Tie";
        return `<li class="${round.result}"><b>${label}</b><span>${display[round.human]} vs ${display[round.ai]}</span><span>Read: ${display[round.plan.predicted]} · ${Math.round(round.plan.confidence * 100)}%</span></li>`;
      }).join("");
    }

    function play(humanMove) {
      if (state.over || state.thinking) return;
      const plan = chooseAiMove(state.history, state.modelStats);
      const aiMove = plan.ai;
      const result = winner(humanMove, aiMove);

      els.playerThrow.textContent = `You: ${display[humanMove]}`;
      els.aiThrow.textContent = "AI: ...";
      els.resultText.textContent = "Reading...";
      els.resultText.classList.add("is-thinking");
      state.thinking = true;
      render(plan);

      window.setTimeout(() => {
        updateStats(plan, humanMove);
        state.score[result] += 1;
        updateStreak(result);
        state.history.push({ human: humanMove, ai: aiMove, result, plan });
        state.over = state.score.human >= target || state.score.ai >= target;
        state.thinking = false;

        els.aiThrow.textContent = `AI: ${display[aiMove]}`;
        els.resultText.classList.remove("is-thinking");
        els.resultText.textContent = state.over
          ? state.score.human >= target ? "Match yours." : "Match lost."
          : result === "human" ? "Point." : result === "ai" ? "AI point." : "Tie.";
        render(plan);
      }, 720);
    }

    els.buttons.forEach((button) => {
      button.addEventListener("click", () => play(button.dataset.move));
    });
    els.reset.addEventListener("click", () => {
      state.history = [];
      state.score = { human: 0, ai: 0, tie: 0 };
      state.modelStats = {};
      state.streak = { owner: null, count: 0 };
      state.over = false;
      state.thinking = false;
      els.playerThrow.textContent = "You: -";
      els.aiThrow.textContent = "AI: -";
      els.resultText.textContent = "Choose.";
      els.resultText.classList.remove("is-thinking");
      render(null);
    });

    render(null);
  }

  function initExplainer() {
    const slider = document.getElementById("patternSlider");
    const bars = {
      rock: document.getElementById("explainRock"),
      paper: document.getElementById("explainPaper"),
      scissors: document.getElementById("explainScissors")
    };
    const callout = document.getElementById("chartCallout");
    const terms = {
      probability: {
        title: "P(m)",
        body: "The model's final belief that your next move is m.",
        link: "#gloss-probability"
      },
      weight: {
        title: "w_i",
        body: "A predictor's influence, based on confidence and recent accuracy.",
        link: "#gloss-weight"
      },
      model: {
        title: "p_i(m)",
        body: "One predictor's probability for a move before the ensemble combines it.",
        link: "#gloss-model"
      },
      normalizer: {
        title: "sum w_i",
        body: "The total active weight, used so the final probabilities add to one.",
        link: "#gloss-normalizer"
      }
    };

    function setDefinition(termName) {
      const term = terms[termName];
      const card = document.getElementById("definitionCard");
      document.getElementById("definitionTitle").textContent = term.title;
      document.getElementById("definitionBody").textContent = term.body;
      document.getElementById("definitionLink").href = term.link;
      card.classList.add("is-active");
    }

    function renderChart() {
      const strength = Number(slider.value) / 100;
      const values = {
        rock: 0.333 + strength * 0.27,
        paper: 0.333 - strength * 0.08,
        scissors: 0.334 - strength * 0.19
      };
      moves.forEach((move) => {
        const height = 220 * values[move];
        bars[move].setAttribute("y", String(280 - height));
        bars[move].setAttribute("height", String(height));
      });
      callout.textContent = strength < 0.18
        ? "balanced play gives no target"
        : strength < 0.62
          ? "small bias creates a counter"
          : "strong pattern invites paper";
    }

    document.querySelectorAll(".term").forEach((button) => {
      button.addEventListener("click", () => setDefinition(button.dataset.term));
    });
    slider.addEventListener("input", renderChart);
    renderChart();
  }

  if (page === "game") initGame();
  if (page === "explain") initExplainer();
}());
