const screens = [...document.querySelectorAll(".screen")];
const navButtons = [...document.querySelectorAll(".nav-btn")];
const goButtons = [...document.querySelectorAll("[data-go]")];
const setupForm = document.querySelector("#setupForm");
const stressInput = document.querySelector("#stressInput");
const previewAvatar = document.querySelector("#previewAvatar");
const battleAvatar = document.querySelector("#battleAvatar");
const previewTaunt = document.querySelector("#previewTaunt");
const battleTaunt = document.querySelector("#battleTaunt");
const monsterName = document.querySelector("#monsterName");
const monsterType = document.querySelector("#monsterType");
const battleCabinet = document.querySelector("#battleCabinet");
const gameFrame = document.querySelector("#gameFrame");
const realGameTitle = document.querySelector("#realGameTitle");
const tutorialVideo = document.querySelector("#cameraPreview");
const tutorialCanvas = document.querySelector("#tutorialPoseCanvas");
const tutorialCtx = tutorialCanvas?.getContext("2d");
const arena = document.querySelector("#arena");
const arenaScene = document.querySelector("#arenaScene");
const hitWord = document.querySelector("#hitWord");
const beamEffect = document.querySelector("#beamEffect");
const warning = document.querySelector("#warning");
const targetHitbox = document.querySelector("#targetHitbox");
const toast = document.querySelector("#toast");
const reportAvatarImage = document.querySelector("#reportAvatarImage");

const resultKnockdownImages = {
  gold: "art/firge_picture/trump/飞书20260531-034625倒地.png",
  dark: "art/firge_picture/2号/飞书20260531-034813倒地2.png"
};

const state = {
  role: "gold",
  scene: "office",
  mode: "boxing",
  stress: "第 8 版方案怪",
  taunt: "再改一版呗？",
  tutorialStep: 0,
  battle: null,
  timerId: null,
  regenId: null,
  counterId: null,
  warningId: null,
  cameraStream: null,
  poseLandmarker: null,
  visionResolver: null,
  tutorialCameraReady: false,
  tutorialDetecting: false,
  tutorialLastVideoTime: -1,
  tutorialMetrics: null,
  tutorialBaseline: null,
  tutorialGestureHits: [0, 0, 0],
  tutorialAutoStarted: false,
  museum: [
    { name: "KPI 压迫怪", text: "今天把 KPI 压迫怪按进工位底下", role: "gold", mode: "boxing", date: "2026-05-28" },
    { name: "明天交作业怪", text: "Deadline 被我一拳打散", role: "dark", mode: "slap", date: "2026-05-29" },
    { name: "别急马上要怪", text: "嘴上说马上，手上完全没动", role: "gold", mode: "boxing", date: "2026-05-30" }
  ]
};

const scenes = {
  office: "办公室",
  classroom: "教室",
  subway: "地铁",
  ring: "拳击场",
  elevator: "电梯间"
};

const taunts = [
  "再改一版呗？",
  "明天上午就要。",
  "这个需求很简单。",
  "你急什么，我也刚看到。",
  "就这？",
  "年轻人多锻炼一下。"
];

const skillMap = {
  hook: { key: "a", name: "左勾拳", damage: 12, energy: 8, word: "啪！", className: "hit-hook" },
  push: { key: "s", name: "右勾拳", damage: 10, energy: 8, word: "飞！", className: "hit-push" },
  soul: { key: "d", name: "直拳", damage: 15, energy: 12, word: "嘭！", className: "hit-soul" },
  slap: { key: "f", name: "左边巴掌", damage: 9, energy: 8, word: "啪啪！", className: "hit-slap" },
  mercy: { key: "g", name: "右边巴掌", damage: 45, energy: 60, word: "超度！", className: "hit-mercy", once: true }
};

const POSE = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16
};

const poseBones = [
  [POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER],
  [POSE.LEFT_SHOULDER, POSE.LEFT_WRIST],
  [POSE.RIGHT_SHOULDER, POSE.RIGHT_WRIST]
];

function switchScreen(name) {
  screens.forEach((screen) => {
    screen.classList.toggle("is-active", screen.dataset.view === name);
  });
  document.querySelector(".app-shell").dataset.screen = name;
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  navButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.go === name));
  if (name === "museum") renderMuseum();
  if (name !== "battle") stopBattleLoops();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 1800);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distance(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function validPoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y) && (point.visibility ?? 1) > 0.2;
}

function normalizeStress(value) {
  const next = value.trim();
  return next || "今天的烦恼怪";
}

function randomTaunt(seed = "") {
  const index = Math.abs([...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % taunts.length;
  return taunts[index];
}

function setRole(role) {
  state.role = role;
  document.querySelectorAll("[data-role-card]").forEach((card) => {
    card.classList.toggle("selected", card.dataset.roleCard === role);
  });
  document.querySelectorAll("[data-battle-role]").forEach((button) => {
    button.classList.toggle("active", button.dataset.battleRole === role);
  });
  document.querySelectorAll('input[name="role"]').forEach((input) => {
    input.checked = input.value === role;
  });
  applyAvatarRole(previewAvatar, role);
  applyAvatarRole(battleAvatar, role);
  updatePreview();
}

function applyAvatarRole(node, role) {
  if (!node) return;
  node.classList.toggle("avatar-gold", role === "gold");
  node.classList.toggle("avatar-dark", role === "dark");
  const hair = node.querySelector(".hair");
  hair.classList.toggle("hair-gold", role === "gold");
  hair.classList.toggle("hair-dark", role === "dark");
  node.dataset.expression = role === "gold" ? "smirk" : "calm";
}

function setScene(scene) {
  state.scene = scene;
  document.querySelectorAll(".scene-card").forEach((card) => {
    card.classList.toggle("selected", card.dataset.scene === scene);
  });
  if (arenaScene) {
    arenaScene.className = `arena-scene ${scene}`;
  }
  updatePreview();
}

function setMode(mode) {
  state.mode = mode === "slap" ? "slap" : "boxing";
  document.querySelectorAll(".mode-card").forEach((card) => {
    card.classList.toggle("selected", card.dataset.mode === state.mode);
  });
  updatePreview();
}

function updatePreview() {
  state.stress = normalizeStress(stressInput?.value || state.stress);
  state.taunt = randomTaunt(state.stress);
  if (monsterName) monsterName.textContent = state.stress;
  if (monsterType) monsterType.textContent = `${scenes[state.scene]} · ${state.mode === "slap" ? "扇巴掌模式" : "体感拳击"} · 本地台词生成`;
  const sceneText = document.querySelector("#sceneText");
  if (sceneText) sceneText.textContent = scenes[state.scene] || scenes.office;
  if (previewTaunt) previewTaunt.textContent = state.taunt;
  if (battleTaunt) battleTaunt.textContent = state.taunt;
}

function resetTutorial() {
  state.tutorialStep = 0;
  state.tutorialGestureHits = [0, 0, 0];
  state.tutorialBaseline = null;
  state.tutorialAutoStarted = false;
  document.querySelectorAll(".gesture-item").forEach((item, index) => {
    item.classList.toggle("active", index === 0);
    item.classList.remove("done");
    item.classList.remove("detecting");
    item.querySelector("em").textContent = index === 0 ? "识别中" : "待练习";
  });
  document.querySelector("#startBattleBtn").disabled = true;
}

function completeGestureStep(manual = false) {
  const items = [...document.querySelectorAll(".gesture-item")];
  const current = items[state.tutorialStep];
  if (!current) return;
  current.classList.remove("active");
  current.classList.remove("detecting");
  current.classList.add("done");
  current.querySelector("em").textContent = manual ? "模拟完成" : "已识别";
  state.tutorialStep += 1;
  const next = items[state.tutorialStep];
  if (next) {
    next.classList.add("active");
    next.querySelector("em").textContent = "识别中";
  } else {
    document.querySelector("#startBattleBtn").disabled = false;
    showToast("手势校准完成，可以开打了");
    if (!state.tutorialAutoStarted) {
      state.tutorialAutoStarted = true;
      window.setTimeout(startBattle, 280);
    }
  }
}

async function startCamera() {
  const status = document.querySelector("#cameraStatus");
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("当前浏览器不支持摄像头采集");
    }
    const stream = state.cameraStream || await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "user"
      },
      audio: false
    });
    state.cameraStream = stream;
    tutorialVideo.srcObject = stream;
    await tutorialVideo.play();
    state.tutorialCameraReady = true;
    document.querySelector(".camera-frame")?.classList.add("camera-ready");
    status.textContent = "摄像头预览已开启，正在识别右侧 3 个动作";
    document.querySelector("#cameraBtn").textContent = "重新校准识别";
    await ensureTutorialPoseModel();
    state.tutorialBaseline = null;
    state.tutorialLastVideoTime = -1;
    if (!state.tutorialDetecting) {
      state.tutorialDetecting = true;
      requestAnimationFrame(detectTutorialPose);
    }
    showToast("摄像头已开启，开始识别动作");
  } catch (error) {
    status.textContent = "摄像头未开启，可继续用模拟识别体验流程";
    document.querySelector(".camera-frame")?.classList.remove("camera-ready");
    showToast("摄像头不可用，已切换为模拟识别");
  }
}

async function ensureTutorialPoseModel() {
  if (state.poseLandmarker) return;
  const vision = state.visionResolver || await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs");
  state.visionResolver = vision;
  const fileset = await vision.FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"
  );
  const options = (delegate) => ({
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
      delegate
    },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.28,
    minPosePresenceConfidence: 0.28,
    minTrackingConfidence: 0.28
  });
  try {
    state.poseLandmarker = await vision.PoseLandmarker.createFromOptions(fileset, options("GPU"));
  } catch (error) {
    state.poseLandmarker = await vision.PoseLandmarker.createFromOptions(fileset, options("CPU"));
  }
}

function detectTutorialPose(now) {
  if (!state.tutorialDetecting) return;
  requestAnimationFrame(detectTutorialPose);
  if (!state.poseLandmarker || !tutorialVideo?.videoWidth || tutorialVideo.paused) return;
  if (tutorialVideo.currentTime === state.tutorialLastVideoTime) return;
  state.tutorialLastVideoTime = tutorialVideo.currentTime;
  const result = state.poseLandmarker.detectForVideo(tutorialVideo, now);
  const landmarks = result.landmarks?.[0];
  if (!landmarks) {
    drawTutorialPose(null);
    setCameraHint("请让上半身、头部和双手尽量进入完整画面");
    return;
  }
  drawTutorialPose(landmarks);
  updateTutorialRecognition(landmarks);
}

function readTutorialMetrics(lm) {
  const nose = lm[POSE.NOSE];
  const leftShoulder = lm[POSE.LEFT_SHOULDER];
  const rightShoulder = lm[POSE.RIGHT_SHOULDER];
  const leftWrist = lm[POSE.LEFT_WRIST];
  const rightWrist = lm[POSE.RIGHT_WRIST];
  if (![nose, leftShoulder, rightShoulder].every(validPoint)) return null;
  const shoulderCenter = {
    x: (leftShoulder.x + rightShoulder.x) / 2,
    y: (leftShoulder.y + rightShoulder.y) / 2
  };
  const shoulderWidth = Math.max(0.05, Math.abs(leftShoulder.x - rightShoulder.x));
  const leftReach = validPoint(leftWrist) ? distance(leftWrist, leftShoulder) / shoulderWidth : 0;
  const rightReach = validPoint(rightWrist) ? distance(rightWrist, rightShoulder) / shoulderWidth : 0;
  const leftDepth = validPoint(leftWrist) ? ((leftShoulder.z || 0) - (leftWrist.z || 0)) / shoulderWidth : 0;
  const rightDepth = validPoint(rightWrist) ? ((rightShoulder.z || 0) - (rightWrist.z || 0)) / shoulderWidth : 0;
  const handsTogether = validPoint(leftWrist) && validPoint(rightWrist)
    ? distance(leftWrist, rightWrist) / shoulderWidth
    : Number.POSITIVE_INFINITY;
  return {
    nose,
    leftShoulder,
    rightShoulder,
    leftWrist,
    rightWrist,
    shoulderCenter,
    shoulderWidth,
    headLean: (nose.x - shoulderCenter.x) / shoulderWidth,
    leftForward: validPoint(leftWrist) ? Math.abs(leftWrist.x - leftShoulder.x) / shoulderWidth : 0,
    rightForward: validPoint(rightWrist) ? Math.abs(rightWrist.x - rightShoulder.x) / shoulderWidth : 0,
    leftReach,
    rightReach,
    leftDepth,
    rightDepth,
    handsTogether
  };
}

function updateTutorialRecognition(landmarks) {
  const metrics = readTutorialMetrics(landmarks);
  if (!metrics) {
    setCameraHint("已看到画面，请让头部、双肩和双手进入完整画面");
    return;
  }
  if (!state.tutorialBaseline) {
    state.tutorialBaseline = metrics;
    setCameraHint("保持自然站姿 1 秒，然后按右侧动作做");
    return;
  }
  state.tutorialMetrics = metrics;
  const step = state.tutorialStep;
  if (step > 2) {
    setCameraHint("3 个动作已完成，可以进入战斗");
    return;
  }
  const base = state.tutorialBaseline;
  const scores = [
    Math.abs(metrics.headLean - base.headLean) > 0.26,
    Math.max(
      metrics.leftForward,
      metrics.rightForward,
      metrics.leftReach - base.leftReach,
      metrics.rightReach - base.rightReach,
      (metrics.leftDepth || 0) - (base.leftDepth || 0),
      (metrics.rightDepth || 0) - (base.rightDepth || 0)
    ) > 0.72,
    metrics.handsTogether < 0.82
  ];
  state.tutorialGestureHits[step] = scores[step] ? state.tutorialGestureHits[step] + 1 : Math.max(0, state.tutorialGestureHits[step] - 1);
  updateGestureProgress(step, scores[step]);
  if (state.tutorialGestureHits[step] >= 5) completeGestureStep(false);
}

function updateGestureProgress(step, detected) {
  const items = [...document.querySelectorAll(".gesture-item")];
  const item = items[step];
  if (!item) return;
  item.classList.toggle("detecting", detected);
  item.querySelector("em").textContent = detected ? "识别到" : "识别中";
  const hints = [
    "左右移动头部和上半身，保持整个人在画面里",
    "单手向前快速伸出，像直拳一样打出去",
    "双手靠近胸前或脸前，保持半秒"
  ];
  setCameraHint(hints[step]);
}

function setCameraHint(text) {
  const status = document.querySelector("#cameraStatus");
  if (status) status.textContent = text;
}

function drawTutorialPose(landmarks) {
  if (!tutorialCanvas || !tutorialCtx) return;
  const rect = tutorialCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  tutorialCanvas.width = Math.max(1, Math.round(rect.width * dpr));
  tutorialCanvas.height = Math.max(1, Math.round(rect.height * dpr));
  tutorialCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  tutorialCtx.clearRect(0, 0, rect.width, rect.height);
  if (!landmarks) return;
  const box = getVideoContainBox(rect.width, rect.height);
  const point = (lm) => ({
    x: box.x + lm.x * box.w,
    y: box.y + lm.y * box.h
  });
  tutorialCtx.lineWidth = 4;
  tutorialCtx.lineCap = "round";
  tutorialCtx.strokeStyle = "rgba(245, 197, 24, 0.92)";
  for (const [a, b] of poseBones) {
    if (!validPoint(landmarks[a]) || !validPoint(landmarks[b])) continue;
    const pa = point(landmarks[a]);
    const pb = point(landmarks[b]);
    tutorialCtx.beginPath();
    tutorialCtx.moveTo(pa.x, pa.y);
    tutorialCtx.lineTo(pb.x, pb.y);
    tutorialCtx.stroke();
  }
  for (const index of [POSE.NOSE, POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER, POSE.LEFT_WRIST, POSE.RIGHT_WRIST]) {
    if (!validPoint(landmarks[index])) continue;
    const p = point(landmarks[index]);
    tutorialCtx.fillStyle = index === POSE.NOSE ? "#f0332f" : "#f5c518";
    tutorialCtx.strokeStyle = "#21110f";
    tutorialCtx.lineWidth = 3;
    tutorialCtx.beginPath();
    tutorialCtx.arc(p.x, p.y, index === POSE.NOSE ? 8 : 7, 0, Math.PI * 2);
    tutorialCtx.fill();
    tutorialCtx.stroke();
  }
}

function getVideoContainBox(width, height) {
  const vw = tutorialVideo.videoWidth || 16;
  const vh = tutorialVideo.videoHeight || 9;
  const scale = Math.min(width / vw, height / vh);
  const w = vw * scale;
  const h = vh * scale;
  return {
    x: (width - w) / 2,
    y: (height - h) / 2,
    w,
    h
  };
}

function stopTutorialCamera() {
  state.tutorialDetecting = false;
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((track) => track.stop());
    state.cameraStream = null;
  }
  if (tutorialVideo) {
    tutorialVideo.pause();
    tutorialVideo.srcObject = null;
  }
  state.tutorialCameraReady = false;
  state.tutorialLastVideoTime = -1;
  document.querySelector(".camera-frame")?.classList.remove("camera-ready");
}

function startBattle() {
  if (document.querySelector('[data-view="battle"]')?.classList.contains("is-active")) return;
  loadRealGame();
}

function setEmbeddedDebugPanels(open) {
  if (!gameFrame?.contentWindow) return;
  const targetOrigin = window.location.protocol === "file:" ? "*" : window.location.origin;
  gameFrame.contentWindow.postMessage({
    type: "pressure-debug-panels",
    open: Boolean(open)
  }, targetOrigin);
}

function stopBattleLoops() {
  window.clearInterval(state.timerId);
  window.clearInterval(state.regenId);
  window.clearInterval(state.counterId);
  window.clearTimeout(state.warningId);
  setEmbeddedDebugPanels(false);
  if (gameFrame && !document.querySelector('[data-view="battle"]')?.classList.contains("is-active")) {
    gameFrame.src = "about:blank";
  }
}

function getGameUrl() {
  const params = new URLSearchParams({
    embed: "1",
    autostart: "1",
    enemy: state.stress,
    role: state.role,
    scene: state.scene,
    mode: state.mode,
    taunt: state.taunt
  });
  return `game.html?${params.toString()}`;
}

function loadRealGame() {
  updatePreview();
  stopTutorialCamera();
  state.battle = {
    playerHp: 100,
    enemyHp: 100,
    energy: 100,
    combo: 0,
    maxCombo: 0,
    hits: 0,
    damageTaken: 0,
    seconds: state.mode === "slap" ? 45 : 90,
    ultimateUsed: false,
    warning: false,
    dodged: false,
    ended: false,
    realGame: true
  };
  if (realGameTitle) realGameTitle.textContent = `${state.stress} · ${state.mode === "slap" ? "扇巴掌" : "拳击"}`;
  battleCabinet?.classList.add("real-game-active");
  if (gameFrame) gameFrame.src = getGameUrl();
  switchScreen("battle");
  showToast("真实体感战斗已接入，键盘演示可直接开打");
}

function handleGameResult(result) {
  if (!result || result.type !== "pressure-game-result") return;
  const sameTarget = result.enemyName === state.stress;
  if (!sameTarget) return;
  state.battle = {
    playerHp: result.playerHp ?? 0,
    enemyHp: result.enemyHp ?? 0,
    energy: 0,
    combo: result.bestCombo ?? 0,
    maxCombo: result.bestCombo ?? 0,
    hits: result.hits ?? 0,
    damageTaken: result.damageTaken ?? 0,
    seconds: 0,
    ultimateUsed: result.mode === "slap" ? (result.slapCount ?? 0) >= 30 : (result.score ?? 0) >= 700,
    warning: false,
    dodged: false,
    ended: false,
    realGame: true,
    score: result.score ?? 0
  };
  state.mode = result.mode === "slap" ? "slap" : "boxing";
  state.role = result.role === "dark" ? "dark" : "gold";
  state.scene = result.scene || state.scene;
  endBattle(Boolean(result.won));
}

function tickBattleClock() {
  if (!state.battle || state.battle.ended) return;
  state.battle.seconds = Math.max(0, state.battle.seconds - 1);
  updateBattleHud();
  if (state.battle.seconds <= 0) endBattle(state.battle.enemyHp <= 45);
}

function regenEnergy() {
  if (!state.battle || state.battle.ended) return;
  state.battle.energy = Math.min(100, state.battle.energy + 3);
  updateBattleHud();
}

function queueCounter() {
  if (!state.battle || state.battle.ended || state.battle.warning) return;
  state.battle.warning = true;
  state.battle.dodged = false;
  warning.classList.add("show");
  battleAvatar.classList.add("countering");
  battleTaunt.textContent = ["烦！", "滚！", "改一下！", "明天交！"][Math.floor(Math.random() * 4)];
  battleTaunt.classList.add("show");
  state.warningId = window.setTimeout(resolveCounter, 950);
}

function resolveCounter() {
  if (!state.battle || state.battle.ended) return;
  warning.classList.remove("show");
  battleTaunt.classList.remove("show");
  battleAvatar.classList.remove("countering");
  state.battle.warning = false;
  if (state.battle.dodged) {
    showToast("闪避成功，连击不断");
    return;
  }
  state.battle.playerHp = Math.max(0, state.battle.playerHp - 12);
  state.battle.damageTaken += 1;
  state.battle.combo = 0;
  arena.classList.add("flash", "hit-shake");
  window.setTimeout(() => arena.classList.remove("flash", "hit-shake"), 320);
  updateBattleHud();
  if (state.battle.playerHp <= 0) endBattle(false);
}

function dodge(direction) {
  if (!state.battle || state.battle.ended) return;
  if (!state.battle.warning) {
    showToast(direction === "left" ? "左闪预备" : "右闪预备");
    return;
  }
  state.battle.dodged = true;
}

function useSkill(skillId) {
  const skill = skillMap[skillId];
  if (!skill || !state.battle || state.battle.ended) return;
  if (skill.once && state.battle.ultimateUsed) {
    showToast("大招每场只能用一次");
    return;
  }
  if (state.battle.energy < skill.energy) {
    showToast("能量不足，先普通拳攒一下");
    return;
  }

  state.battle.energy = Math.max(0, state.battle.energy - skill.energy);
  const bonus = Math.min(10, Math.floor(state.battle.combo / 3) * 2);
  const damage = skill.damage + bonus;
  state.battle.enemyHp = Math.max(0, state.battle.enemyHp - damage);
  state.battle.combo += 1;
  state.battle.maxCombo = Math.max(state.battle.maxCombo, state.battle.combo);
  state.battle.hits += 1;
  if (skill.once) state.battle.ultimateUsed = true;

  animateHit(skill);
  updateBattleHud();
  if (state.battle.enemyHp <= 0) {
    window.setTimeout(() => endBattle(true), skill.once ? 900 : 420);
  }
}

function animateHit(skill) {
  battleAvatar.classList.remove("hit-push", "hit-hook", "hit-soul", "hit-slap", "hit-mercy");
  void battleAvatar.offsetWidth;
  battleAvatar.classList.add(skill.className);
  hitWord.textContent = skill.word;
  hitWord.classList.remove("show");
  void hitWord.offsetWidth;
  hitWord.classList.add("show");
  arena.classList.add("hit-shake", "flash");
  battleTaunt.textContent = taunts[Math.floor(Math.random() * taunts.length)];
  battleTaunt.classList.add("show");
  if (skill.key === "t" || skill.key === "e") {
    beamEffect.classList.remove("show");
    void beamEffect.offsetWidth;
    beamEffect.classList.add("show");
  }
  window.setTimeout(() => {
    arena.classList.remove("hit-shake", "flash");
    battleTaunt.classList.remove("show");
  }, 520);
  window.setTimeout(() => battleAvatar.classList.remove(skill.className), 1100);
}

function updateBattleHud() {
  if (!state.battle) return;
  const b = state.battle;
  document.querySelector("#playerHpText").textContent = `${Math.round(b.playerHp)}%`;
  document.querySelector("#enemyHpText").textContent = `${Math.round(b.enemyHp)}%`;
  document.querySelector("#energyText").textContent = `${Math.round(b.energy)}%`;
  document.querySelector("#comboText").textContent = `连击 ${b.combo}`;
  document.querySelector("#sceneText").textContent = scenes[state.scene];
  document.querySelector("#playerHpBar").style.width = `${b.playerHp}%`;
  document.querySelector("#enemyHpBar").style.width = `${b.enemyHp}%`;
  document.querySelector("#energyBar").style.width = `${b.energy}%`;
  const minutes = String(Math.floor(b.seconds / 60)).padStart(2, "0");
  const seconds = String(b.seconds % 60).padStart(2, "0");
  document.querySelector("#timerText").textContent = `${minutes}:${seconds}`;
  document.querySelectorAll(".skill-btn").forEach((button) => {
    const skill = skillMap[button.dataset.skill];
    if (!skill) return;
    button.disabled = b.energy < skill.energy || (skill.once && b.ultimateUsed);
  });
}

function endBattle(won) {
  if (!state.battle || state.battle.ended) return;
  state.battle.ended = true;
  stopBattleLoops();
  warning?.classList.remove("show");
  battleTaunt?.classList.remove("show");
  battleCabinet?.classList.remove("real-game-active");
  if (gameFrame) gameFrame.src = "about:blank";
  const b = state.battle;
  const score = computeScore(won, b);
  document.querySelector("#scoreBadge").textContent = score.grade;
  document.querySelector("#result-title").textContent = won ? "压力已被打散" : "小人嘲讽了你一下";
  document.querySelector("#resultCopy").textContent = score.copy;
  document.querySelector("#reportTitle").textContent = won ? `打倒了${state.stress}` : `${state.stress}：就这？`;
  document.querySelector("#shareCopy").textContent = score.share;
  document.querySelector("#statHits").textContent = b.hits;
  document.querySelector("#statCombo").textContent = b.maxCombo;
  document.querySelector("#statDamage").textContent = b.damageTaken;
  document.querySelector("#statRelease").textContent = `${score.release}%`;
  if (reportAvatarImage) {
    reportAvatarImage.src = resultKnockdownImages[state.role] || resultKnockdownImages.gold;
    reportAvatarImage.alt = state.role === "dark" ? "黑发冷脸怪倒地画面" : "金发挑眉怪倒地画面";
  }
  if (won) addSpecimen();
  window.setTimeout(() => switchScreen("result"), 420);
}

function computeScore(won, battle) {
  if (!won) {
    return {
      grade: "C",
      release: 38,
      copy: "被打倒也要爽。不服？马上再来一局。",
      share: `我被${state.stress}嘲讽了，但下一局它完了。`
    };
  }
  let points = 64 + battle.maxCombo * 3 + (battle.damageTaken === 0 ? 18 : 0) + (battle.ultimateUsed ? 12 : 0);
  points = Math.min(99, points);
  const grade = points >= 90 ? "S" : points >= 78 ? "A" : points >= 62 ? "B" : "C";
  const copyPool = [
    "今天打得很狠，心情好一点了吗？",
    "你不是脾气差，你只是压力太久没出口。",
    `压力已清掉 ${points}%，建议今晚早点休息。`,
    "今天这一架，值了。"
  ];
  return {
    grade,
    release: points,
    copy: copyPool[Math.floor(Math.random() * copyPool.length)],
    share: `压力释放 ${grade} 级，我刚打倒了${state.stress}，舒服了。`
  };
}

function addSpecimen() {
  const today = formatLocalDate(new Date());
  const exists = state.museum.some((item) => item.name === state.stress && item.date === today);
  if (exists) return;
  state.museum.unshift({
    name: state.stress,
    text: `${state.mode === "slap" ? "扇巴掌" : "拳击"}战报：${state.battle?.hits ?? 0} 次命中，最高连击 ${state.battle?.maxCombo ?? 0}`,
    role: state.role,
    mode: state.mode,
    date: today
  });
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function renderMuseum() {
  const grid = document.querySelector("#museumGrid");
  grid.innerHTML = state.museum
    .map(
      (item) => `
        <article class="specimen">
          <div class="specimen-top">
            <div>
              <strong>${escapeHtml(item.name)}</strong>
              <time>${item.date}</time>
            </div>
            <span class="specimen-avatar ${item.role === "gold" ? "gold-face" : "dark-face"}" aria-label="${item.role === "gold" ? "金发挑眉怪" : "黑发冷脸怪"}"></span>
          </div>
          <div class="specimen-target ${item.role === "gold" ? "gold-face" : "dark-face"}" aria-hidden="true"></div>
          <p>${escapeHtml(item.text)}</p>
          <p class="specimen-mode">${item.mode === "slap" ? "扇巴掌模式" : "体感拳击"}</p>
          <button class="secondary-action" type="button" data-replay="${escapeHtml(item.name)}">再打一遍</button>
        </article>
      `
    )
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

goButtons.forEach((button) => {
  button.addEventListener("click", () => switchScreen(button.dataset.go));
});

document.querySelectorAll(".chip").forEach((button) => {
  button.addEventListener("click", () => {
    stressInput.value = button.dataset.stress;
    updatePreview();
  });
});

stressInput.addEventListener("input", updatePreview);

document.querySelectorAll('input[name="role"]').forEach((input) => {
  input.addEventListener("change", () => setRole(input.value));
});

document.querySelectorAll(".role-card").forEach((card) => {
  card.addEventListener("click", () => setRole(card.dataset.roleCard));
});

document.querySelectorAll("[data-battle-role]").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    setRole(button.dataset.battleRole);
  });
});

document.querySelectorAll(".scene-card").forEach((button) => {
  button.addEventListener("click", () => setScene(button.dataset.scene));
});

document.querySelectorAll(".mode-card").forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});

setupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.stress = normalizeStress(stressInput.value);
  stressInput.value = state.stress;
  updatePreview();
  resetTutorial();
  switchScreen("tutorial");
  startCamera().catch(() => {});
});

document.querySelector("#practiceBtn").addEventListener("click", () => completeGestureStep(true));
document.querySelector("#cameraBtn").addEventListener("click", startCamera);
document.querySelector("#startBattleBtn").addEventListener("click", startBattle);
document.querySelector("#reloadGameBtn")?.addEventListener("click", loadRealGame);
document.querySelector("#exitGameBtn")?.addEventListener("click", () => {
  battleCabinet?.classList.remove("real-game-active");
  if (gameFrame) gameFrame.src = "about:blank";
  resetTutorial();
  switchScreen("setup");
});

window.addEventListener("message", (event) => {
  const sameOrigin = event.origin === window.location.origin;
  const fileOrigin = window.location.protocol === "file:" && event.origin === "null";
  if (!sameOrigin && !fileOrigin) return;
  handleGameResult(event.data);
});

gameFrame?.addEventListener("load", () => setEmbeddedDebugPanels(false));

targetHitbox.addEventListener("click", () => useSkill("hook"));
targetHitbox.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    useSkill("hook");
  }
});

document.querySelectorAll(".skill-btn").forEach((button) => {
  button.addEventListener("click", () => useSkill(button.dataset.skill));
});

document.querySelectorAll("[data-dodge]").forEach((button) => {
  button.addEventListener("click", () => dodge(button.dataset.dodge));
});

document.addEventListener("keydown", (event) => {
  if (event.code === "Tab" && document.querySelector('[data-view="battle"]')?.classList.contains("is-active")) {
    event.preventDefault();
    setEmbeddedDebugPanels(true);
    return;
  }
  const key = event.key.toLowerCase();
  const skillId = Object.keys(skillMap).find((id) => skillMap[id].key === key);
  if (skillId && document.querySelector('[data-view="battle"]').classList.contains("is-active")) {
    event.preventDefault();
    useSkill(skillId);
  }
  if (key === "arrowleft") dodge("left");
  if (key === "arrowright") dodge("right");
});

document.addEventListener("keyup", (event) => {
  if (event.code === "Tab") {
    event.preventDefault();
    setEmbeddedDebugPanels(false);
  }
});

document.querySelector("[data-restart]").addEventListener("click", () => {
  resetTutorial();
  switchScreen("tutorial");
});

document.querySelector("#copyReportBtn").addEventListener("click", async () => {
  const text = document.querySelector("#shareCopy").textContent;
  try {
    await navigator.clipboard.writeText(text);
    showToast("战报文案已复制");
  } catch (error) {
    showToast(text);
  }
});

document.querySelector("#museumGrid").addEventListener("click", (event) => {
  const replay = event.target.closest("[data-replay]");
  if (!replay) return;
  stressInput.value = replay.dataset.replay;
  const item = state.museum.find((museumItem) => museumItem.name === replay.dataset.replay);
  if (item) {
    setRole(item.role);
    setMode(item.mode || "boxing");
  }
  updatePreview();
  switchScreen("setup");
});

setRole("gold");
setScene("office");
setMode("boxing");
updatePreview();
renderMuseum();
switchScreen("intro");
