// Screens, input and canvas drawing. Rules live in core.js and sound in audio.js.
(function () {
  'use strict';

  const Core = window.BeatCore;
  const SONGS = window.BeatSongs;
  const $ = (id) => document.getElementById(id);

  const COLORS = {
    sky: '#2b2453', hillBack: '#231d48', hillFront: '#1b3b45', lane: '#15112d', laneLine: '#4a3f80',
    low: '#f2914a', lowDark: '#a9562a', high: '#39c6d6', highDark: '#1c7f8d', gold: '#ffd166',
    text: '#f6f1ff', muted: '#b9afd9', elephant: '#8f93c9', elephantDark: '#6a6ea8', ink: '#221a3f',
  };
  const FONT = '"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
  const JUDGE_LABEL = {
    perfect: { text: '完美', color: COLORS.gold },
    great: { text: '很好', color: '#8be28b' },
    good: { text: '可以', color: COLORS.text },
    miss: { text: '漏接', color: COLORS.muted },
    wrong: { text: '敲錯鼓', color: '#ff8fa3' },
  };
  const ZONES = [{ kind: 'low', key: 'F' }, { kind: 'high', key: 'J' }];
  const KEY_TO_ZONE = { KeyF: 0, KeyJ: 1 };
  const LEAD_IN_SECONDS = 1;
  const CALIBRATE_BEATS = 16;
  const CALIBRATE_LISTEN_BEATS = 4;
  const CALIBRATE_INTERVAL = 0.6;
  const CALIBRATE_MIN_TAPS = 6;
  const OFFSET_LIMIT_MS = 300;
  const ROLL_BOT_INTERVAL = 0.09;
  const COMBO_MILESTONES = new Set([10, 25, 50, 75, 100, 150, 200, 250, 300]);
  const COMBO_BANNER_SECONDS = 0.9;
  const useBot = new URLSearchParams(location.search).has('bot');
  const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CALIBRATE_HINT = isTouchDevice
    ? '先聽 4 下，再跟著節拍點螢幕 12 下'
    : '先聽 4 下，再跟著節拍敲 12 下（點畫面或按 F、J 鍵）';

  const store = {
    get(key, fallback) {
      try {
        const value = localStorage.getItem('beatpark.' + key);
        return value === null ? fallback : JSON.parse(value);
      } catch (error) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem('beatpark.' + key, JSON.stringify(value));
      } catch (error) {
        // Progress just isn't saved when storage is blocked; the game still works.
      }
    },
  };

  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const view = { w: 0, h: 0, stageH: 0, laneTop: 0, laneH: 0, padTop: 0, hitX: 0, noteR: 0 };
  const padFlash = [0, 0];

  let audio = null;
  let screen = 'menu';
  let song = SONGS.find((item) => item.id === store.get('song', SONGS[0].id)) || SONGS[0];
  let difficultyId = store.get('difficulty', 'normal');
  if (!Core.DIFFICULTIES[difficultyId]) difficultyId = 'normal';
  let offsetMs = store.get('offsetMs', 0);
  let run = null;
  let judge = null;
  let rings = [];
  let comboPop = 0;
  let comboBanner = null;
  let lastFrame = performance.now();
  let lastBotRoll = 0;
  let countdownTimer = null;
  let calibration = null;
  let currentSongTime = 0;

  function ensureAudio() {
    if (!audio) audio = new AudioEngine();
    return audio.unlock();
  }

  // On tablets, fullscreen keeps stray taps away from the browser's own controls. It is optional.
  function enterFullscreenOnTouch() {
    const root = document.documentElement;
    if (!isTouchDevice || document.fullscreenElement || !root.requestFullscreen) return;
    root.requestFullscreen().catch(() => {});
  }

  // ---------- Screens ----------

  function showOverlay(id) {
    ['menu', 'pause', 'countdownOverlay', 'result', 'calibrate'].forEach((name) => {
      $(name).classList.toggle('show', name === id);
    });
  }

  function setScreen(next, overlay) {
    screen = next;
    showOverlay(overlay);
    $('pauseButton').classList.toggle('show', next === 'play');
  }

  function renderMenu() {
    $('songInfo').textContent = song.origin + ' · ' + song.bpm + ' BPM';
    const songHolder = $('songs');
    songHolder.textContent = '';
    SONGS.forEach((item) => {
      const button = document.createElement('button');
      button.className = 'song-card' + (item === song ? ' selected' : '');
      button.setAttribute('aria-pressed', String(item === song));
      button.textContent = item.title;
      button.addEventListener('click', () => {
        song = item;
        store.set('song', song.id);
        renderMenu();
      });
      songHolder.append(button);
    });
    const holder = $('difficulties');
    holder.textContent = '';
    Object.values(Core.DIFFICULTIES).forEach((difficulty) => {
      const best = store.get('best.' + song.id + '.' + difficulty.id, null);
      const button = document.createElement('button');
      button.className = 'difficulty' + (difficulty.id === difficultyId ? ' selected' : '');
      button.setAttribute('aria-pressed', String(difficulty.id === difficultyId));
      const name = document.createElement('strong');
      name.textContent = difficulty.label;
      const record = document.createElement('small');
      record.textContent = best ? '最佳 ' + best.grade + ' · ' + best.score.toLocaleString() : '尚未挑戰';
      button.append(name, record);
      button.addEventListener('click', () => {
        difficultyId = difficulty.id;
        store.set('difficulty', difficultyId);
        renderMenu();
      });
      holder.append(button);
    });
    renderOffset();
  }

  function renderOffset() {
    const sign = offsetMs > 0 ? '+' : '';
    $('offsetValue').textContent = sign + offsetMs + ' 毫秒';
  }

  function changeOffset(amount) {
    offsetMs = Math.max(-OFFSET_LIMIT_MS, Math.min(OFFSET_LIMIT_MS, offsetMs + amount));
    store.set('offsetMs', offsetMs);
    renderOffset();
  }

  function goToMenu() {
    clearTimeout(countdownTimer);
    if (audio) {
      audio.stopSong();
      audio.resume();
    }
    run = null;
    renderMenu();
    setScreen('menu', 'menu');
  }

  async function startGame() {
    clearTimeout(countdownTimer);
    enterFullscreenOnTouch();
    await ensureAudio();
    await audio.resume();
    const chart = Core.buildChart(song, difficultyId);
    run = Core.createRun(chart, Core.DIFFICULTIES[difficultyId]);
    judge = null;
    rings = [];
    comboPop = 0;
    comboBanner = null;
    audio.startSong(song, LEAD_IN_SECONDS);
    setScreen('play', null);
  }

  function pauseGame() {
    if (screen !== 'play' && screen !== 'countdown') return;
    clearTimeout(countdownTimer);
    audio.pause();
    setScreen('paused', 'pause');
  }

  function resumeGame() {
    let remaining = 3;
    setScreen('countdown', 'countdownOverlay');
    const tick = () => {
      if (remaining === 0) {
        audio.resume().then(() => {
          audio.syncClock();
          setScreen('play', null);
        });
        return;
      }
      $('countdown').textContent = String(remaining);
      remaining--;
      countdownTimer = setTimeout(tick, 600);
    };
    tick();
  }

  function finishGame() {
    audio.stopSong();
    const summary = Core.summarize(run);
    const bestKey = 'best.' + song.id + '.' + difficultyId;
    const best = store.get(bestKey, null);
    const isRecord = !useBot && (!best || summary.score > best.score);
    if (isRecord) store.set(bestKey, { score: summary.score, grade: summary.grade });

    $('resultTitle').textContent = '《' + song.title + '》 · ' + Core.DIFFICULTIES[difficultyId].label;
    $('resultGrade').textContent = summary.grade;
    $('resultScore').textContent = summary.score.toLocaleString() + ' 分';
    $('resultCombo').textContent = '最高連擊 ' + summary.maxCombo + ' 次';
    const badges = [summary.cleared ? '通過' : '未通過，準確率到 60% 就過關'];
    if (summary.fullCombo) badges.push('全連擊');
    if (isRecord) badges.push('新紀錄');
    $('resultBadge').textContent = badges.join(' · ');
    $('statPerfect').textContent = summary.counts.perfect;
    $('statGreat').textContent = summary.counts.great;
    $('statGood').textContent = summary.counts.good;
    $('statMiss').textContent = summary.counts.miss;
    const timing = Math.round(summary.meanDeltaMs);
    const timingText = timing === 0 ? '時間點剛好' : '平均' + (timing > 0 ? '偏晚 ' : '偏早 ') + Math.abs(timing) + ' 毫秒';
    $('resultDetail').textContent = '準確率 ' + (summary.accuracy * 100).toFixed(1) + '% · 連打 '
      + summary.rollHits + ' 下 · ' + timingText;
    setScreen('result', 'result');
  }

  // ---------- Calibration ----------

  async function startCalibration() {
    await ensureAudio();
    const startAt = audio.ctx.currentTime + 0.6;
    for (let i = 0; i < CALIBRATE_BEATS; i++) {
      audio.playCalibrationClick(startAt + i * CALIBRATE_INTERVAL);
    }
    const totalMs = (0.6 + CALIBRATE_BEATS * CALIBRATE_INTERVAL + 0.4) * 1000;
    calibration = { startAt, errors: [], timer: setTimeout(finishCalibration, totalMs) };
    $('calibrateHint').textContent = CALIBRATE_HINT;
    setScreen('calibrate', 'calibrate');
  }

  function calibrationTap(perfMs) {
    audio.playHit('low');
    audio.syncClock();
    const heard = audio.audioTimeAt(perfMs) - audio.outputLatency - calibration.startAt;
    const beat = Math.round(heard / CALIBRATE_INTERVAL);
    if (beat < CALIBRATE_LISTEN_BEATS || beat >= CALIBRATE_BEATS) return;
    calibration.errors.push(heard - beat * CALIBRATE_INTERVAL);
  }

  function updateCalibrationBeat() {
    const elapsed = audio.ctx.currentTime - calibration.startAt;
    const beat = Math.floor(elapsed / CALIBRATE_INTERVAL) + 1;
    if (beat >= 1 && beat <= CALIBRATE_BEATS) {
      $('calibrateBeat').textContent = beat <= CALIBRATE_LISTEN_BEATS ? '聽 ' + beat : '敲！' + (beat - CALIBRATE_LISTEN_BEATS);
    }
  }

  function finishCalibration() {
    const errors = calibration.errors;
    calibration = null;
    $('calibrateBeat').textContent = '';
    if (errors.length >= CALIBRATE_MIN_TAPS) {
      const measured = Math.round(Core.median(errors) * 1000);
      offsetMs = Math.max(-OFFSET_LIMIT_MS, Math.min(OFFSET_LIMIT_MS, measured));
      store.set('offsetMs', offsetMs);
    }
    goToMenu();
  }

  // ---------- Input ----------

  function eventTime(event) {
    const now = performance.now();
    return Math.abs(now - event.timeStamp) < 1000 ? event.timeStamp : now;
  }

  function hit(zoneIndex, perfMs) {
    const kind = ZONES[zoneIndex].kind;
    audio.playHit(kind);
    padFlash[zoneIndex] = 1;
    registerResult(Core.judgeHit(run, kind, audio.songTimeAt(perfMs, offsetMs)));
  }

  function registerResult(result) {
    if (!result) return;
    if (result.type === 'roll') {
      rings.push({ age: 0, color: COLORS.gold, max: 1.25 });
      return;
    }
    let sub = '';
    if ((result.type === 'great' || result.type === 'good') && result.delta !== undefined) {
      sub = result.delta < 0 ? '偏早' : '偏晚';
    }
    judge = { label: JUDGE_LABEL[result.type], sub, age: 0 };
    if (result.type !== 'wrong') {
      rings.push({ age: 0, color: result.note.kind === 'low' ? COLORS.low : COLORS.high, max: 1.7 });
      comboPop = 1;
      if (COMBO_MILESTONES.has(run.combo)) {
        comboBanner = { text: run.combo + ' 連擊！', age: 0 };
        audio.playComboMilestone();
      }
    }
  }

  window.addEventListener('pointerdown', (event) => {
    if (screen === 'calibrate' && calibration && event.target.tagName !== 'BUTTON') {
      calibrationTap(eventTime(event));
      return;
    }
    if (screen !== 'play' || event.target !== canvas) return;
    hit(event.clientX < view.w / 2 ? 0 : 1, eventTime(event));
  });

  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    const zone = KEY_TO_ZONE[event.code];
    if (screen === 'calibrate' && calibration && zone !== undefined) {
      calibrationTap(eventTime(event));
      return;
    }
    if (screen === 'play') {
      if (zone !== undefined) {
        event.preventDefault();
        hit(zone, eventTime(event));
      } else if (event.code === 'Escape' || event.code === 'Space') {
        event.preventDefault();
        pauseGame();
      }
    } else if (screen === 'paused' && (event.code === 'Escape' || event.code === 'Space')) {
      event.preventDefault();
      resumeGame();
    }
  });

  // ---------- Drawing ----------

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    view.w = w;
    view.h = h;
    view.stageH = h * 0.3;
    view.laneTop = view.stageH;
    view.laneH = Math.min(h * 0.2, w * 0.22);
    view.padTop = view.laneTop + view.laneH;
    view.hitX = w * 0.11;
    view.noteR = view.laneH * 0.3;
    $('deviceHint').hidden = w >= h;
  }

  function circle(x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function ellipse(x, y, rx, ry, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function roundRect(x, y, w, h, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  }

  function text(content, x, y, size, color, align) {
    ctx.font = '700 ' + size + 'px ' + FONT;
    ctx.fillStyle = color;
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(content, x, y);
  }

  function drawHippo(x, y, s) {
    circle(x - s * 0.62, y - s * 0.72, s * 0.2, COLORS.lowDark);
    circle(x + s * 0.62, y - s * 0.72, s * 0.2, COLORS.lowDark);
    ellipse(x, y, s * 0.82, s * 0.72, COLORS.low);
    ellipse(x, y + s * 0.3, s * 0.62, s * 0.38, '#f8b27e');
    circle(x - s * 0.22, y + s * 0.26, s * 0.07, COLORS.lowDark);
    circle(x + s * 0.22, y + s * 0.26, s * 0.07, COLORS.lowDark);
    circle(x - s * 0.34, y - s * 0.26, s * 0.1, COLORS.ink);
    circle(x + s * 0.34, y - s * 0.26, s * 0.1, COLORS.ink);
  }

  function drawParrot(x, y, s) {
    ctx.fillStyle = COLORS.gold;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.2, y - s * 0.6);
    ctx.lineTo(x, y - s * 1.08);
    ctx.lineTo(x + s * 0.2, y - s * 0.6);
    ctx.fill();
    ellipse(x, y, s * 0.68, s * 0.76, COLORS.high);
    ctx.fillStyle = COLORS.gold;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.2, y + s * 0.02);
    ctx.lineTo(x + s * 0.2, y + s * 0.02);
    ctx.lineTo(x, y + s * 0.42);
    ctx.fill();
    circle(x - s * 0.28, y - s * 0.24, s * 0.1, COLORS.ink);
    circle(x + s * 0.28, y - s * 0.24, s * 0.1, COLORS.ink);
  }

  function drawElephant(x, y, s) {
    ellipse(x - s * 0.8, y - s * 0.05, s * 0.42, s * 0.55, COLORS.elephantDark);
    ellipse(x + s * 0.8, y - s * 0.05, s * 0.42, s * 0.55, COLORS.elephantDark);
    ellipse(x, y, s * 0.72, s * 0.72, COLORS.elephant);
    roundRect(x - s * 0.14, y + s * 0.1, s * 0.28, s * 0.72, s * 0.14, COLORS.elephant);
    circle(x - s * 0.3, y - s * 0.2, s * 0.1, COLORS.ink);
    circle(x + s * 0.3, y - s * 0.2, s * 0.1, COLORS.ink);
  }

  function drawStage(songTime) {
    ctx.fillStyle = COLORS.sky;
    ctx.fillRect(0, 0, view.w, view.stageH);
    circle(view.w * 0.84, view.stageH * 0.3, view.stageH * 0.16, COLORS.gold);
    ellipse(view.w * 0.25, view.stageH, view.w * 0.4, view.stageH * 0.68, COLORS.hillBack);
    ellipse(view.w * 0.8, view.stageH, view.w * 0.45, view.stageH * 0.55, COLORS.hillBack);
    ellipse(view.w * 0.5, view.stageH * 1.08, view.w * 0.65, view.stageH * 0.4, COLORS.hillFront);

    const beat = songTime / (60 / song.bpm);
    const bounce = Math.abs(Math.sin(beat * Math.PI));
    const energy = reduceMotion ? 0 : run ? 0.3 + run.hype * 0.9 : 0.4;
    const size = Math.min(view.stageH * 0.21, view.w * 0.09);
    const groundY = view.stageH * 0.68;
    const offBounce = 1 - bounce;
    drawHippo(view.w * 0.34, groundY - bounce * size * 0.4 * energy, size);
    drawElephant(view.w * 0.5, groundY - offBounce * size * 0.3 * energy, size);
    drawParrot(view.w * 0.66, groundY - bounce * size * 0.4 * energy, size);
  }

  function drawHud(songTime) {
    const progress = Math.max(0, Math.min(1, songTime / run.duration));
    roundRect(16, 12, view.w * 0.32, 8, 4, COLORS.ink);
    roundRect(16, 12, Math.max(8, view.w * 0.32 * progress), 8, 4, COLORS.gold);
    text(run.score.toLocaleString(), 16, 44, Math.max(24, view.h * 0.042), COLORS.text, 'left');
    if (run.combo >= 2) {
      const size = Math.max(32, Math.min(view.w, view.h) * 0.07);
      const y = Math.max(size * 0.7, view.stageH * 0.16);
      text(String(run.combo), view.w * 0.5, y, size * (1 + comboPop * 0.3), COLORS.gold, 'right');
      text('連擊', view.w * 0.5 + 6, y, size * 0.5, COLORS.text, 'left');
    }
    if (comboBanner) {
      const size = Math.max(30, Math.min(view.w, view.h) * 0.09);
      const y = view.stageH * 0.56;
      ctx.globalAlpha = Math.min(1, (COMBO_BANNER_SECONDS - comboBanner.age) * 4);
      text(comboBanner.text, view.w * 0.5 + 2, y + 2, size, COLORS.ink);
      text(comboBanner.text, view.w * 0.5, y, size, COLORS.gold);
      ctx.globalAlpha = 1;
    }
  }

  function drawLowNote(x, y, r) {
    circle(x - r * 0.68, y - r * 0.72, r * 0.26, COLORS.lowDark);
    circle(x + r * 0.68, y - r * 0.72, r * 0.26, COLORS.lowDark);
    circle(x, y, r, COLORS.low);
    circle(x - r * 0.34, y - r * 0.18, r * 0.13, COLORS.ink);
    circle(x + r * 0.34, y - r * 0.18, r * 0.13, COLORS.ink);
    ellipse(x, y + r * 0.42, r * 0.42, r * 0.22, '#f8b27e');
  }

  function drawHighNote(x, y, r) {
    ctx.fillStyle = COLORS.high;
    ctx.beginPath();
    ctx.moveTo(x, y - r * 1.12);
    ctx.lineTo(x + r * 1.05, y);
    ctx.lineTo(x, y + r * 1.12);
    ctx.lineTo(x - r * 1.05, y);
    ctx.closePath();
    ctx.fill();
    circle(x - r * 0.3, y - r * 0.2, r * 0.13, COLORS.ink);
    circle(x + r * 0.3, y - r * 0.2, r * 0.13, COLORS.ink);
    ctx.fillStyle = COLORS.gold;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.2, y + r * 0.05);
    ctx.lineTo(x + r * 0.2, y + r * 0.05);
    ctx.lineTo(x, y + r * 0.45);
    ctx.fill();
  }

  function drawRoll(note, songTime, speed, y) {
    const start = Math.max(view.hitX, view.hitX + (note.time - songTime) * speed);
    const end = view.hitX + (note.end - songTime) * speed;
    if (end < view.hitX || start > view.w + view.noteR) return;
    const r = view.noteR;
    roundRect(start - r, y - r, end - start + r * 2, r * 2, r, COLORS.gold);
    text(note.hits > 0 ? String(note.hits) : '連打', start, y, r * 0.8, '#5a3d05');
  }

  function drawLane(songTime) {
    const { laneTop, laneH, hitX, noteR, w } = view;
    const y = laneTop + laneH / 2;
    ctx.fillStyle = COLORS.lane;
    ctx.fillRect(0, laneTop, w, laneH);
    ctx.fillStyle = COLORS.laneLine;
    ctx.fillRect(0, laneTop, w, 2);
    ctx.fillRect(0, laneTop + laneH - 2, w, 2);

    const beatSeconds = 60 / song.bpm;
    const speed = (w - hitX) / run.difficulty.travel;
    const firstBeat = Math.ceil(songTime / beatSeconds);
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    for (let i = firstBeat; ; i++) {
      const x = hitX + (i * beatSeconds - songTime) * speed;
      if (x > w) break;
      ctx.fillRect(x - 1, laneTop + 2, i % 4 === 0 ? 3 : 1, laneH - 4);
    }

    ctx.strokeStyle = COLORS.text;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(hitX, y, noteR * 1.2, 0, Math.PI * 2);
    ctx.stroke();

    for (let i = run.notes.length - 1; i >= 0; i--) {
      const note = run.notes[i];
      if (note.kind === 'roll') {
        if (note.result !== 'done') drawRoll(note, songTime, speed, y);
        continue;
      }
      if (note.result && note.result !== 'miss') continue;
      const x = hitX + (note.time - songTime) * speed;
      if (x > w + noteR * 2 || x < -noteR * 2) continue;
      ctx.globalAlpha = note.result === 'miss' ? 0.3 : 1;
      if (note.kind === 'low') drawLowNote(x, y, noteR);
      else drawHighNote(x, y, noteR);
      ctx.globalAlpha = 1;
    }

    rings.forEach((ring) => {
      const progress = ring.age / 0.25;
      ctx.globalAlpha = Math.max(0, 1 - progress);
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(hitX, y, noteR * (1.2 + progress * (ring.max - 1)), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    });

    if (judge && judge.age < 0.45) {
      const lift = judge.age * 40;
      const judgeY = laneTop - view.h * 0.04 - lift;
      const judgeSize = Math.max(22, Math.min(view.h, view.w) * 0.042);
      const judgeX = Math.max(hitX + noteR * 0.3, judgeSize * 1.7);
      ctx.globalAlpha = Math.min(1, (0.45 - judge.age) * 5);
      text(judge.label.text, judgeX, judgeY, judgeSize, judge.label.color);
      if (judge.sub) text(judge.sub, judgeX + judgeSize * 2, judgeY, judgeSize * 0.6, COLORS.muted);
      ctx.globalAlpha = 1;
    }
  }

  function drawPads() {
    const { padTop, w, h } = view;
    const gap = 8;
    const padW = (w - gap * (ZONES.length + 1)) / ZONES.length;
    const padH = h - padTop - gap * 2;
    ZONES.forEach((zone, index) => {
      const x = gap + index * (padW + gap);
      const y = padTop + gap;
      const isLow = zone.kind === 'low';
      roundRect(x, y, padW, padH, 18, isLow ? COLORS.lowDark : COLORS.highDark);
      if (padFlash[index] > 0) {
        ctx.globalAlpha = padFlash[index];
        roundRect(x, y, padW, padH, 18, isLow ? COLORS.low : COLORS.high);
        ctx.globalAlpha = 1;
      }
      const centerX = x + padW / 2;
      const centerY = y + padH * (isTouchDevice ? 0.5 : 0.44);
      const iconR = Math.min(padW, padH) * 0.18;
      if (isLow) drawLowNote(centerX, centerY, iconR);
      else drawHighNote(centerX, centerY, iconR);
      if (!isTouchDevice) text(zone.key, centerX, y + padH * 0.82, Math.max(18, padH * 0.11), COLORS.text);
    });
  }

  // ---------- Main loop ----------

  function runBot(songTime) {
    for (let i = run.cursor; i < run.notes.length; i++) {
      const note = run.notes[i];
      if (note.time > songTime) break;
      if (note.result) continue;
      if (note.kind === 'roll') {
        if (songTime <= note.end && songTime - lastBotRoll >= ROLL_BOT_INTERVAL) {
          lastBotRoll = songTime;
          registerResult(Core.judgeHit(run, 'low', songTime));
        }
        continue;
      }
      padFlash[note.kind === 'low' ? 0 : 1] = 1;
      audio.playHit(note.kind);
      registerResult(Core.judgeHit(run, note.kind, note.time));
    }
  }

  function frame(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;

    if (screen === 'calibrate' && calibration) updateCalibrationBeat();

    const inSong = run && (screen === 'play' || screen === 'paused' || screen === 'countdown');
    if (screen === 'play') {
      audio.syncClock();
      currentSongTime = audio.songTimeAt(now, offsetMs);
      if (useBot) runBot(currentSongTime);
      Core.sweepMisses(run, currentSongTime).forEach(() => {
        judge = { label: JUDGE_LABEL.miss, sub: '', age: 0 };
      });
      if (currentSongTime >= run.duration) {
        Core.sweepMisses(run, Infinity);
        finishGame();
      }
    }

    padFlash.forEach((value, index) => { padFlash[index] = Math.max(0, value - dt * 6); });
    rings.forEach((ring) => { ring.age += dt; });
    rings = rings.filter((ring) => ring.age < 0.25);
    if (judge) judge.age += dt;
    comboPop = Math.max(0, comboPop - dt * 7);
    if (comboBanner) {
      comboBanner.age += dt;
      if (comboBanner.age >= COMBO_BANNER_SECONDS) comboBanner = null;
    }

    const stageTime = inSong || screen === 'result' ? currentSongTime : now / 1000;
    drawStage(stageTime);
    if (run && screen !== 'menu') {
      drawLane(currentSongTime);
      drawPads();
      drawHud(currentSongTime);
    } else {
      ctx.fillStyle = COLORS.lane;
      ctx.fillRect(0, view.stageH, view.w, view.h - view.stageH);
    }
    requestAnimationFrame(frame);
  }

  // ---------- Wiring ----------

  $('startButton').addEventListener('click', startGame);
  $('retryButton').addEventListener('click', startGame);
  $('pauseRetry').addEventListener('click', startGame);
  $('menuButton').addEventListener('click', goToMenu);
  $('pauseMenu').addEventListener('click', goToMenu);
  $('resumeButton').addEventListener('click', resumeGame);
  $('pauseButton').addEventListener('click', pauseGame);
  $('offsetDown').addEventListener('click', () => changeOffset(-5));
  $('offsetUp').addEventListener('click', () => changeOffset(5));
  $('calibrateButton').addEventListener('click', startCalibration);
  $('calibrateCancel').addEventListener('click', () => {
    clearTimeout(calibration && calibration.timer);
    calibration = null;
    goToMenu();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseGame();
  });
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  document.addEventListener('touchmove', (event) => {
    if (event.target === canvas) event.preventDefault();
  }, { passive: false });
  document.addEventListener('gesturestart', (event) => event.preventDefault());
  document.addEventListener('contextmenu', (event) => event.preventDefault());

  window.__beatPark = {
    get run() { return run; },
    get screen() { return screen; },
    get songTime() { return currentSongTime; },
    liveSongTime: () => audio.songTimeAt(performance.now(), offsetMs),
    calibrationClock: () => calibration && {
      untilStart: calibration.startAt - audio.ctx.currentTime,
      outputLatency: audio.outputLatency,
    },
    get offsetMs() { return offsetMs; },
    summary: () => (run ? Core.summarize(run) : null),
  };

  document.documentElement.lang = 'zh-Hant';
  $('howToPlay').textContent = isTouchDevice
    ? '橘色河馬敲左半邊，青色鸚鵡敲右半邊，金色連打兩邊都算'
    : '橘色河馬敲左邊（F 鍵），青色鸚鵡敲右邊（J 鍵），金色連打兩邊都算';
  renderMenu();
  resize();
  requestAnimationFrame(frame);
})();
