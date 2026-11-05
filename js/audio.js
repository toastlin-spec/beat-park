// Web Audio engine: the song clock, the look-ahead scheduler and all synthesized instruments.
(function () {
  'use strict';

  const SCHEDULE_AHEAD = 0.2;
  const SCHEDULER_INTERVAL_MS = 25;
  const CLOCK_SNAP_SECONDS = 0.05;

  const midiToHz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  class AudioEngine {
    constructor() {
      const Context = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Context({ latencyHint: 'interactive' });
      this.master = this.ctx.createDynamicsCompressor();
      this.master.connect(this.ctx.destination);
      this.noise = this.createNoiseBuffer();
      this.songBus = null;
      this.timer = null;
      this.startAt = 0;
      this.clockOffset = this.ctx.currentTime - performance.now() / 1000;
    }

    // Browsers keep audio silent until a user gesture, so call this from a click or key handler.
    unlock() {
      return this.ctx.state === 'suspended' ? this.ctx.resume() : Promise.resolve();
    }

    createNoiseBuffer() {
      const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      return buffer;
    }

    get outputLatency() {
      const ctx = this.ctx;
      return typeof ctx.outputLatency === 'number' && ctx.outputLatency > 0 ? ctx.outputLatency : ctx.baseLatency || 0;
    }

    // Keeps a smooth mapping from performance.now() to the audio clock, which only advances in blocks.
    syncClock() {
      if (this.ctx.state !== 'running') return;
      const sample = this.ctx.currentTime - performance.now() / 1000;
      const drift = sample - this.clockOffset;
      this.clockOffset = Math.abs(drift) > CLOCK_SNAP_SECONDS ? sample : this.clockOffset + drift * 0.05;
    }

    audioTimeAt(perfMs) {
      return this.clockOffset + perfMs / 1000;
    }

    // Position in the song as the player hears it, after output latency and the calibration offset.
    songTimeAt(perfMs, offsetMs) {
      return this.audioTimeAt(perfMs) - this.startAt - this.outputLatency - offsetMs / 1000;
    }

    startSong(song, leadInSeconds) {
      this.stopSong();
      this.clockOffset = this.ctx.currentTime - performance.now() / 1000;
      this.song = song;
      this.songBus = this.ctx.createGain();
      this.songBus.gain.value = 0.8;
      this.songBus.connect(this.master);
      this.stepSeconds = 60 / song.bpm / 4;
      this.startAt = this.ctx.currentTime + leadInSeconds;
      this.nextStep = 0;
      this.totalSteps = song.charts.easy.length * BeatCore.STEPS_PER_BAR;
      this.events = this.buildSongEvents(song);
      this.nextEvent = 0;
      this.timer = setInterval(() => this.schedule(), SCHEDULER_INTERVAL_MS);
      this.schedule();
    }

    stopSong() {
      clearInterval(this.timer);
      this.timer = null;
      if (this.songBus) {
        this.songBus.disconnect();
        this.songBus = null;
      }
    }

    pause() {
      return this.ctx.suspend();
    }

    resume() {
      return this.ctx.resume();
    }

    buildSongEvents(song) {
      const events = [];
      let cursor = song.introBars * BeatCore.STEPS_PER_BAR;
      song.melody.forEach((bar) => {
        bar.forEach((note) => {
          if (note.pitch !== null) events.push({ step: cursor, pitch: note.pitch, steps: note.steps });
          cursor += note.steps;
        });
      });
      return events;
    }

    schedule() {
      const horizon = this.ctx.currentTime + SCHEDULE_AHEAD;
      while (this.nextStep < this.totalSteps) {
        const time = this.startAt + this.nextStep * this.stepSeconds;
        if (time > horizon) break;
        this.scheduleBackingStep(this.nextStep, time);
        this.nextStep++;
      }
      while (this.nextEvent < this.events.length) {
        const event = this.events[this.nextEvent];
        const time = this.startAt + event.step * this.stepSeconds;
        if (time > horizon) break;
        this[this.song.groove.lead](event.pitch, time, event.steps * this.stepSeconds);
        this.nextEvent++;
      }
    }

    scheduleBackingStep(stepIndex, time) {
      const stepsPerBar = BeatCore.STEPS_PER_BAR;
      const song = this.song;
      const bar = Math.floor(stepIndex / stepsPerBar);
      const step = stepIndex % stepsPerBar;
      const inOutro = bar >= song.charts.easy.length - song.outroBars;
      if (inOutro && !(bar === song.charts.easy.length - song.outroBars && step === 0)) return;

      const groove = song.groove;
      if (groove.shakerEvery && step % groove.shakerEvery === 0) this.shaker(time, step % 4 === 0 ? 0.12 : 0.07);
      if (groove.clave.includes(step)) this.clave(time);
      if (groove.kick.includes(step)) this.kick(time);
      if (groove.snare.includes(step)) this.snare(time);

      const chordIndex = bar - song.introBars;
      if (chordIndex >= 0 && chordIndex < song.chords.length) {
        const root = song.chords[chordIndex];
        if (groove.bass.includes(step)) this.bass(root, time);
        if (groove.bassUp.includes(step)) this.bass(root + 12, time);
      }
    }

    envelope(peak, attack, decay, time, destination) {
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(peak, time + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);
      gain.connect(destination);
      return gain;
    }

    tone(type, frequency, time, duration, gainNode, endFrequency) {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, time);
      if (endFrequency) osc.frequency.exponentialRampToValueAtTime(endFrequency, time + duration);
      osc.connect(gainNode);
      osc.start(time);
      osc.stop(time + duration + 0.02);
    }

    noiseBurst(time, duration, peak, filterType, frequency, destination) {
      const source = this.ctx.createBufferSource();
      source.buffer = this.noise;
      const filter = this.ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = frequency;
      source.connect(filter);
      filter.connect(this.envelope(peak, 0.002, duration, time, destination));
      source.start(time, Math.random() * 0.8, duration + 0.02);
    }

    marimba(midi, time, length) {
      if (!this.songBus) return;
      const decay = Math.min(0.5, Math.max(0.18, length));
      const frequency = midiToHz(midi);
      this.tone('sine', frequency, time, decay, this.envelope(0.34, 0.004, decay, time, this.songBus));
      this.tone('sine', frequency * 4, time, 0.07, this.envelope(0.1, 0.002, 0.06, time, this.songBus));
    }

    koto(midi, time, length) {
      if (!this.songBus) return;
      const decay = Math.min(0.9, Math.max(0.25, length));
      const frequency = midiToHz(midi);
      this.tone('triangle', frequency, time, decay, this.envelope(0.4, 0.002, decay, time, this.songBus));
      this.tone('sine', frequency * 2, time, 0.16, this.envelope(0.16, 0.002, 0.15, time, this.songBus));
    }

    brass(midi, time, length) {
      if (!this.songBus) return;
      const decay = Math.min(1.2, Math.max(0.16, length * 0.85));
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1500;
      filter.connect(this.envelope(0.2, 0.02, decay, time, this.songBus));
      this.tone('sawtooth', midiToHz(midi), time, decay + 0.02, filter);
    }

    snare(time) {
      if (!this.songBus) return;
      this.noiseBurst(time, 0.1, 0.2, 'bandpass', 1900, this.songBus);
    }

    bass(midi, time) {
      if (!this.songBus) return;
      this.tone('triangle', midiToHz(midi), time, 0.2, this.envelope(0.36, 0.005, 0.2, time, this.songBus));
    }

    kick(time) {
      if (!this.songBus) return;
      this.tone('sine', 120, time, 0.14, this.envelope(0.34, 0.002, 0.14, time, this.songBus), 48);
    }

    shaker(time, peak) {
      if (!this.songBus) return;
      this.noiseBurst(time, 0.035, peak, 'highpass', 6500, this.songBus);
    }

    clave(time, destination, peak) {
      const target = destination || this.songBus;
      if (!target) return;
      this.tone('sine', 2200, time, 0.04, this.envelope(peak || 0.08, 0.001, 0.04, time, target));
    }

    // The player's drums play instantly on every hit, whether or not the hit scores.
    playHit(kind) {
      const time = this.ctx.currentTime;
      if (kind === 'low') {
        this.tone('sine', 190, time, 0.2, this.envelope(0.95, 0.002, 0.2, time, this.master), 72);
        this.noiseBurst(time, 0.018, 0.22, 'lowpass', 1600, this.master);
      } else {
        this.tone('triangle', 430, time, 0.07, this.envelope(0.42, 0.001, 0.07, time, this.master), 300);
        this.noiseBurst(time, 0.07, 0.5, 'bandpass', 2100, this.master);
      }
    }

    playComboMilestone() {
      const time = this.ctx.currentTime;
      [76, 83].forEach((midi, index) => {
        const start = time + index * 0.09;
        this.tone('sine', midiToHz(midi), start, 0.22, this.envelope(0.26, 0.004, 0.22, start, this.master));
      });
    }

    playCalibrationClick(time) {
      this.clave(time, this.master, 0.5);
    }
  }

  window.AudioEngine = AudioEngine;
})();
