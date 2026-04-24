const views = document.querySelectorAll(".view");
const menuButtons = document.querySelectorAll(".menu-button");
const backButtons = document.querySelectorAll(".back-to-menu");

const durationInput = document.getElementById("durationMinutes");
const durationSecondsInput = document.getElementById("durationSeconds");
const minIntervalMinutesInput = document.getElementById("minIntervalMinutes");
const minIntervalSecondsInput = document.getElementById("minIntervalSeconds");
const maxIntervalMinutesInput = document.getElementById("maxIntervalMinutes");
const maxIntervalSecondsInput = document.getElementById("maxIntervalSeconds");

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const playNowBtn = document.getElementById("playNowBtn");

const statusText = document.getElementById("statusText");
const remainingText = document.getElementById("remainingText");
const nextPlayText = document.getElementById("nextPlayText");
const shotCountText = document.getElementById("shotCountText");
const toastBanner = document.getElementById("toastBanner");

const drawCardBtn = document.getElementById("drawCardBtn");
const resetKingsBtn = document.getElementById("resetKingsBtn");
const kingsRemainingText = document.getElementById("kingsRemainingText");
const kingsKingText = document.getElementById("kingsKingText");
const drawnCardVisual = document.getElementById("drawnCardVisual");
const drawnCardTitle = document.getElementById("drawnCardTitle");
const drawnCardRule = document.getElementById("drawnCardRule");

let audioContext;
let masterGain;
let isRunning = false;
let sessionEndAt = 0;
let nextPlayAt = 0;
let nextPlayTimeoutId = null;
let displayIntervalId = null;
let toastTimeoutId = null;
let shotCount = 0;

let kingsDeck = [];
let kingsDrawn = 0;
let kingsCount = 0;

const suits = [
  { symbol: "♠", color: "black" },
  { symbol: "♥", color: "red" },
  { symbol: "♦", color: "red" },
  { symbol: "♣", color: "black" }
];

const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

const kingsRules = {
  A: {
    title: "Vízesés",
    text: "Mindenki egyszerre kezd inni, és csak akkor állhatsz le, ha az előtted ülő már letette az italát."
  },
  2: {
    title: "Te iszol",
    text: "Válassz valakit, aki iszik két kortyot vagy egy felest."
  },
  3: {
    title: "Én iszom",
    text: "A lap húzója iszik."
  },
  4: {
    title: "Padló",
    text: "Az utolsó, aki megérinti a padlót, iszik."
  },
  5: {
    title: "Fiúk",
    text: "Minden fiú iszik."
  },
  6: {
    title: "Lányok",
    text: "Minden lány iszik."
  },
  7: {
    title: "Mennyország",
    text: "Az utolsó, aki a kezét a levegőbe emeli, iszik."
  },
  8: {
    title: "Haver",
    text: "Válassz ivópajtást. Amíg új havert nem húznak, együtt isztok."
  },
  9: {
    title: "Rímelés",
    text: "Mondj egy szót, és körben mindenki mondjon rá rímelő szót. Aki hibázik, iszik."
  },
  10: {
    title: "Kategória",
    text: "Mondj egy kategóriát, és körben soroljatok elemeket. Aki megakad, iszik."
  },
  J: {
    title: "Szabály",
    text: "Találj ki egy új szabályt, ami a játék végéig él."
  },
  Q: {
    title: "Kérdésmester",
    text: "Te leszel a kérdésmester. Aki válaszol egy kérdésedre, iszik."
  },
  K: {
    title: "Király kupa",
    text: "Önts a közös kupába. A negyedik király húzója megissza az egészet."
  }
};

function showView(viewId) {
  views.forEach((view) => {
    view.classList.toggle("active", view.id === viewId);
  });
}

function ensureAudioContext() {
  const ContextClass = window.AudioContext || window.webkitAudioContext;
  if (!ContextClass) {
    throw new Error("A böngésző nem támogatja a Web Audio API-t.");
  }

  if (!audioContext) {
    audioContext = new ContextClass();
    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.72;
    masterGain.connect(audioContext.destination);
  }

  if (audioContext.state === "suspended") {
    return audioContext.resume();
  }

  return Promise.resolve();
}

function clampInt(value, fallback, min, max) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

function readTimeParts(minutesInput, secondsInput, fallbackMinutes, fallbackSeconds, maxMinutes) {
  const minutes = clampInt(Number(minutesInput.value), fallbackMinutes, 0, maxMinutes);
  const seconds = clampInt(Number(secondsInput.value), fallbackSeconds, 0, 59);

  minutesInput.value = String(minutes);
  secondsInput.value = String(seconds);

  return (minutes * 60 + seconds) * 1000;
}

function writeDelay(delayMs, minutesInput, secondsInput) {
  const totalSeconds = Math.floor(delayMs / 1000);
  minutesInput.value = String(Math.floor(totalSeconds / 60));
  secondsInput.value = String(totalSeconds % 60);
}

function readConfig() {
  let durationMs = readTimeParts(durationInput, durationSecondsInput, 60, 0, 9999);
  let minDelayMs = readTimeParts(minIntervalMinutesInput, minIntervalSecondsInput, 1, 0, 20);
  let maxDelayMs = readTimeParts(maxIntervalMinutesInput, maxIntervalSecondsInput, 20, 0, 20);

  if (durationMs < 1000) {
    durationMs = 1000;
    durationInput.value = "0";
    durationSecondsInput.value = "1";
  }

  if (minDelayMs < 1000) {
    minDelayMs = 1000;
    writeDelay(minDelayMs, minIntervalMinutesInput, minIntervalSecondsInput);
  }

  if (maxDelayMs < 1000) {
    maxDelayMs = 1000;
    writeDelay(maxDelayMs, maxIntervalMinutesInput, maxIntervalSecondsInput);
  }

  if (minDelayMs > maxDelayMs) {
    [minDelayMs, maxDelayMs] = [maxDelayMs, minDelayMs];
    writeDelay(minDelayMs, minIntervalMinutesInput, minIntervalSecondsInput);
    writeDelay(maxDelayMs, maxIntervalMinutesInput, maxIntervalSecondsInput);
  }

  return {
    durationMs,
    minDelayMs,
    maxDelayMs
  };
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function clearTimers() {
  if (nextPlayTimeoutId) {
    clearTimeout(nextPlayTimeoutId);
    nextPlayTimeoutId = null;
  }

  if (displayIntervalId) {
    clearInterval(displayIntervalId);
    displayIntervalId = null;
  }

  if (toastTimeoutId) {
    clearTimeout(toastTimeoutId);
    toastTimeoutId = null;
  }
}

function setRunningUi(running) {
  startBtn.disabled = running;
  stopBtn.disabled = !running;
  playNowBtn.disabled = !running;
  durationInput.disabled = running;
  durationSecondsInput.disabled = running;
  minIntervalMinutesInput.disabled = running;
  minIntervalSecondsInput.disabled = running;
  maxIntervalMinutesInput.disabled = running;
  maxIntervalSecondsInput.disabled = running;
}

function updateStatusDisplay() {
  if (!isRunning) {
    remainingText.textContent = "00:00:00";
    nextPlayText.textContent = "-";
    return;
  }

  const now = Date.now();
  const remaining = sessionEndAt - now;

  remainingText.textContent = formatDuration(remaining);
  nextPlayText.textContent = nextPlayAt > now ? formatDuration(nextPlayAt - now) : "hamarosan";

  if (remaining <= 0) {
    stopSession("Lejárt");
  }
}

function setToast(message) {
  toastBanner.textContent = message;
  toastBanner.classList.add("visible");

  if (toastTimeoutId) {
    clearTimeout(toastTimeoutId);
  }

  toastTimeoutId = window.setTimeout(() => {
    toastBanner.classList.remove("visible");
  }, 2200);
}

function triggerPartyFlash() {
  document.body.classList.remove("party-flash");
  void document.body.offsetWidth;
  document.body.classList.add("party-flash");

  window.setTimeout(() => {
    document.body.classList.remove("party-flash");
  }, 600);
}

function stopSession(reason = "Leállítva") {
  isRunning = false;
  clearTimers();
  setRunningUi(false);
  statusText.textContent = reason;
  updateStatusDisplay();
}

function updateShotCount() {
  shotCount += 1;
  shotCountText.textContent = String(shotCount);
  setToast(`Csörömpölés! Jöhet a(z) ${shotCount}. feles.`);
  triggerPartyFlash();
}

function buildMetalHit(now) {
  const partials = [
    { frequency: 310, gain: 0.32, decay: 1.6, type: "triangle" },
    { frequency: 468, gain: 0.22, decay: 1.35, type: "triangle" },
    { frequency: 731, gain: 0.18, decay: 1.1, type: "sine" },
    { frequency: 1117, gain: 0.1, decay: 0.85, type: "sine" }
  ];

  partials.forEach((partial, index) => {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();

    oscillator.type = partial.type;
    oscillator.frequency.setValueAtTime(partial.frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(partial.frequency * (1 + 0.015 * (index + 1)), now + 0.035);

    filter.type = "bandpass";
    filter.frequency.setValueAtTime(partial.frequency * 1.4, now);
    filter.Q.value = 3;

    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(partial.gain, now + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + partial.decay);

    oscillator.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(masterGain);

    oscillator.start(now);
    oscillator.stop(now + partial.decay + 0.08);
  });

  const noiseBuffer = audioContext.createBuffer(1, audioContext.sampleRate * 1.6, audioContext.sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);

  for (let i = 0; i < noiseData.length; i += 1) {
    noiseData[i] = (Math.random() * 2 - 1) * (1 - i / noiseData.length);
  }

  const noiseSource = audioContext.createBufferSource();
  const noiseFilter = audioContext.createBiquadFilter();
  const noiseGain = audioContext.createGain();

  noiseSource.buffer = noiseBuffer;
  noiseFilter.type = "highpass";
  noiseFilter.frequency.setValueAtTime(700, now);
  noiseGain.gain.setValueAtTime(0.0001, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.24, now + 0.008);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);

  noiseSource.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(masterGain);

  noiseSource.start(now);
  noiseSource.stop(now + 0.45);
}

async function playMetalSound() {
  await ensureAudioContext();
  buildMetalHit(audioContext.currentTime + 0.02);
  updateShotCount();
}

function scheduleNextPlay() {
  if (!isRunning) {
    return;
  }

  const { minDelayMs, maxDelayMs } = readConfig();
  const now = Date.now();
  const remainingMs = sessionEndAt - now;

  if (remainingMs <= 0) {
    stopSession("Lejárt");
    return;
  }

  const randomDelay = randomBetween(minDelayMs, maxDelayMs);
  const actualDelay = Math.min(randomDelay, remainingMs);

  nextPlayAt = now + actualDelay;
  updateStatusDisplay();

  nextPlayTimeoutId = window.setTimeout(async () => {
    if (!isRunning) {
      return;
    }

    await playMetalSound();

    if (Date.now() >= sessionEndAt) {
      stopSession("Lejárt");
      return;
    }

    scheduleNextPlay();
  }, actualDelay);
}

async function startSession() {
  const { durationMs } = readConfig();

  await ensureAudioContext();

  clearTimers();
  isRunning = true;
  sessionEndAt = Date.now() + durationMs;
  statusText.textContent = "Fut";
  setRunningUi(true);
  setToast("A riasztó élesítve. Várjuk az első csörömpölést.");
  scheduleNextPlay();
  updateStatusDisplay();
  displayIntervalId = window.setInterval(updateStatusDisplay, 250);
}

async function playNowAndReschedule() {
  if (!isRunning) {
    return;
  }

  clearTimeout(nextPlayTimeoutId);
  nextPlayTimeoutId = null;

  await playMetalSound();

  if (Date.now() >= sessionEndAt) {
    stopSession("Lejárt");
    return;
  }

  scheduleNextPlay();
}

function shuffleDeck(deck) {
  const result = [...deck];

  for (let i = result.length - 1; i > 0; i -= 1) {
    const swapIndex = Math.floor(Math.random() * (i + 1));
    [result[i], result[swapIndex]] = [result[swapIndex], result[i]];
  }

  return result;
}

function createKingsDeck() {
  const deck = [];

  ranks.forEach((rank) => {
    suits.forEach((suit) => {
      deck.push({
        rank,
        suit: suit.symbol,
        color: suit.color
      });
    });
  });

  return shuffleDeck(deck);
}

function updateKingsStatus() {
  kingsRemainingText.textContent = `${kingsDeck.length} lap maradt`;
  kingsKingText.textContent = `Királyok húzva: ${kingsCount} / 4`;
  drawCardBtn.disabled = kingsDeck.length === 0;
}

function setCardVisual(card) {
  drawnCardVisual.className = `playing-card ${card.color}`;
  drawnCardVisual.dataset.center = `${card.rank}${card.suit}`;
  drawnCardVisual.querySelector(".card-rank").textContent = card.rank;
  drawnCardVisual.querySelector(".card-suit").textContent = card.suit;
}

function setPlaceholderCard() {
  drawnCardVisual.className = "playing-card placeholder";
  drawnCardVisual.dataset.center = "?";
  drawnCardVisual.querySelector(".card-rank").textContent = "?";
  drawnCardVisual.querySelector(".card-suit").textContent = "♠";
}

function resetKingsGame() {
  kingsDeck = createKingsDeck();
  kingsDrawn = 0;
  kingsCount = 0;
  setPlaceholderCard();
  drawnCardTitle.textContent = "Még nincs húzott lap";
  drawnCardRule.textContent = "Nyomd meg a lap húzása gombot, és a rendszer kioszt egy véletlen szabályt a pakliból.";
  updateKingsStatus();
}

function drawKingsCard() {
  if (kingsDeck.length === 0) {
    drawnCardTitle.textContent = "Elfogyott a pakli";
    drawnCardRule.textContent = "Indíts új paklit, ha menne még egy kör.";
    drawCardBtn.disabled = true;
    return;
  }

  const card = kingsDeck.pop();
  const rule = kingsRules[card.rank];

  kingsDrawn += 1;
  if (card.rank === "K") {
    kingsCount += 1;
  }

  setCardVisual(card);

  drawnCardTitle.textContent = `${card.rank}${card.suit} • ${rule.title}`;

  if (card.rank === "K" && kingsCount === 4) {
    drawnCardRule.textContent = "Ez a negyedik király. A királykupát most meg kell inni.";
  } else {
    drawnCardRule.textContent = rule.text;
  }

  updateKingsStatus();
  triggerPartyFlash();
}

menuButtons.forEach((button) => {
  button.addEventListener("click", () => {
    showView(button.dataset.target);
  });
});

backButtons.forEach((button) => {
  button.addEventListener("click", () => {
    showView("mainMenu");
  });
});

startBtn.addEventListener("click", async () => {
  try {
    await startSession();
  } catch (error) {
    statusText.textContent = "Hiba";
    nextPlayText.textContent = "-";
    alert(error.message);
  }
});

stopBtn.addEventListener("click", () => {
  stopSession("Leállítva");
});

playNowBtn.addEventListener("click", async () => {
  try {
    await playNowAndReschedule();
  } catch (error) {
    statusText.textContent = "Hiba";
    alert(error.message);
  }
});

drawCardBtn.addEventListener("click", drawKingsCard);
resetKingsBtn.addEventListener("click", resetKingsGame);

setRunningUi(false);
updateStatusDisplay();
resetKingsGame();
