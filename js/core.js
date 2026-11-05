// Pure game rules: chart parsing, judgment and scoring. No DOM or audio here.
(function () {
  'use strict';

  const STEPS_PER_BAR = 16;

  // Timing windows are half-widths in seconds. These are starting values to tune in playtests.
  const DIFFICULTIES = {
    easy: { id: 'easy', label: '輕鬆', travel: 2.0, windows: { perfect: 0.06, great: 0.11, good: 0.15 } },
    normal: { id: 'normal', label: '標準', travel: 1.6, windows: { perfect: 0.045, great: 0.085, good: 0.12 } },
    expert: { id: 'expert', label: '達人', travel: 1.2, windows: { perfect: 0.03, great: 0.06, good: 0.085 } },
  };

  const BASE_SCORE = { perfect: 300, great: 200, good: 100 };
  const ACCURACY_WEIGHT = { perfect: 1, great: 0.7, good: 0.4 };
  const HYPE_GAIN = { perfect: 0.03, great: 0.02, good: 0.01, miss: -0.06 };
  const ROLL_HIT_SCORE = 50;
  const CLEAR_ACCURACY = 0.6;

  // Bar strings use 16 steps: o = low drum, x = high drum, R = roll start, - = roll continues, . = rest.
  function buildChart(song, difficultyId) {
    const bars = song.charts[difficultyId];
    if (!bars) throw new Error('Unknown difficulty: ' + difficultyId);
    const stepSeconds = 60 / song.bpm / 4;
    const notes = [];
    let openRoll = null;

    const closeRoll = (stepIndex) => {
      if (!openRoll) return;
      openRoll.end = stepIndex * stepSeconds;
      openRoll = null;
    };

    bars.forEach((bar, barIndex) => {
      if (bar.length !== STEPS_PER_BAR) {
        throw new Error('Bar ' + barIndex + ' must have ' + STEPS_PER_BAR + ' steps: "' + bar + '"');
      }
      for (let step = 0; step < STEPS_PER_BAR; step++) {
        const stepIndex = barIndex * STEPS_PER_BAR + step;
        const symbol = bar[step];
        if (symbol === '-') {
          if (!openRoll) throw new Error('Roll continuation without a start in bar ' + barIndex);
          continue;
        }
        closeRoll(stepIndex);
        const time = stepIndex * stepSeconds;
        if (symbol === 'o') notes.push({ kind: 'low', time, result: null });
        else if (symbol === 'x') notes.push({ kind: 'high', time, result: null });
        else if (symbol === 'R') {
          openRoll = { kind: 'roll', time, end: time, hits: 0, result: null };
          notes.push(openRoll);
        } else if (symbol !== '.') {
          throw new Error('Unknown chart symbol "' + symbol + '" in bar ' + barIndex);
        }
      }
    });
    closeRoll(bars.length * STEPS_PER_BAR);

    return { notes, duration: bars.length * STEPS_PER_BAR * stepSeconds };
  }

  function createRun(chart, difficulty) {
    return {
      notes: chart.notes,
      duration: chart.duration,
      difficulty,
      cursor: 0,
      counts: { perfect: 0, great: 0, good: 0, miss: 0 },
      combo: 0,
      maxCombo: 0,
      score: 0,
      hype: 0.4,
      rollHits: 0,
      deltaSum: 0,
      deltaCount: 0,
    };
  }

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  function applyJudgment(run, note, result, delta) {
    note.result = result;
    run.counts[result]++;
    run.hype = clamp(run.hype + HYPE_GAIN[result], 0, 1);
    if (result === 'miss') {
      run.combo = 0;
      return;
    }
    run.combo++;
    run.maxCombo = Math.max(run.maxCombo, run.combo);
    run.score += Math.round(BASE_SCORE[result] * (1 + Math.min(run.combo, 50) * 0.01));
    run.deltaSum += delta;
    run.deltaCount++;
  }

  // Finds the matching drum note nearest to the hit. A hit on the wrong drum only costs a note
  // when no matching note is in range and the other note is close enough to be the clear target.
  function judgeHit(run, kind, time) {
    const windows = run.difficulty.windows;
    let bestMatch = null;
    let bestWrong = null;
    let activeRoll = null;

    for (let i = run.cursor; i < run.notes.length; i++) {
      const note = run.notes[i];
      if (note.time > time + windows.good) break;
      if (note.result) continue;

      if (note.kind === 'roll') {
        if (time >= note.time - windows.good && time < note.end) activeRoll = note;
        continue;
      }

      const distance = Math.abs(note.time - time);
      if (distance > windows.good) continue;
      if (note.kind === kind) {
        if (!bestMatch || distance < Math.abs(bestMatch.time - time)) bestMatch = note;
      } else if (distance <= windows.great) {
        if (!bestWrong || distance < Math.abs(bestWrong.time - time)) bestWrong = note;
      }
    }

    if (bestMatch) {
      const delta = time - bestMatch.time;
      const distance = Math.abs(delta);
      const result = distance <= windows.perfect ? 'perfect' : distance <= windows.great ? 'great' : 'good';
      applyJudgment(run, bestMatch, result, delta);
      return { type: result, note: bestMatch, delta };
    }
    if (activeRoll) {
      activeRoll.hits++;
      run.rollHits++;
      run.score += ROLL_HIT_SCORE;
      return { type: 'roll', note: activeRoll };
    }
    if (bestWrong) {
      applyJudgment(run, bestWrong, 'miss', 0);
      return { type: 'wrong', note: bestWrong };
    }
    return null;
  }

  // Marks notes that can no longer be hit. Returns the notes missed during this call.
  function sweepMisses(run, time) {
    const windows = run.difficulty.windows;
    const missed = [];
    for (let i = run.cursor; i < run.notes.length; i++) {
      const note = run.notes[i];
      if (note.result) {
        if (i === run.cursor) run.cursor++;
        continue;
      }
      if (note.kind === 'roll') {
        if (time > note.end) {
          note.result = 'done';
          if (i === run.cursor) run.cursor++;
          continue;
        }
        break;
      }
      if (time > note.time + windows.good) {
        applyJudgment(run, note, 'miss', 0);
        missed.push(note);
        if (i === run.cursor) run.cursor++;
        continue;
      }
      break;
    }
    return missed;
  }

  function summarize(run) {
    const counts = run.counts;
    const total = run.notes.filter((note) => note.kind !== 'roll').length;
    const earned = ACCURACY_WEIGHT.perfect * counts.perfect
      + ACCURACY_WEIGHT.great * counts.great
      + ACCURACY_WEIGHT.good * counts.good;
    const accuracy = total ? earned / total : 0;
    let grade = 'D';
    if (accuracy >= 0.95) grade = 'S';
    else if (accuracy >= 0.88) grade = 'A';
    else if (accuracy >= 0.75) grade = 'B';
    else if (accuracy >= CLEAR_ACCURACY) grade = 'C';
    return {
      score: run.score,
      accuracy,
      grade,
      cleared: accuracy >= CLEAR_ACCURACY,
      fullCombo: total > 0 && counts.miss === 0 && counts.perfect + counts.great + counts.good === total,
      counts: Object.assign({}, counts),
      maxCombo: run.maxCombo,
      rollHits: run.rollHits,
      meanDeltaMs: run.deltaCount ? (run.deltaSum / run.deltaCount) * 1000 : 0,
    };
  }

  // Used by the calibration screen: the median ignores the odd badly timed tap.
  function median(values) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  window.BeatCore = {
    STEPS_PER_BAR, DIFFICULTIES, CLEAR_ACCURACY,
    buildChart, createRun, judgeHit, sweepMisses, summarize, median,
  };
})();
