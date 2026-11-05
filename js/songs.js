// Song data. All three melodies are traditional and in the public domain;
// the arrangements and charts here are original to this game.
(function () {
  'use strict';

  const INTRO_BARS = 4;
  const OUTRO_BARS = 2;
  const silentBar = '................';

  // "A4 r2" means pitch A for 4 sixteenth-note steps, then a rest of 2 steps.
  function phrase(text, pitches) {
    return text.split(' ').map((token) => ({
      pitch: token[0] === 'r' ? null : pitches[token[0]],
      steps: Number(token.slice(1)),
    }));
  }

  const repeat = (items, times) => Array.from({ length: times }, () => items).flat();

  // Chart strings: o = low drum, x = high drum, R = roll start, - = roll continues, . = rest.
  // With only two buttons, keep at most two same-drum sixteenth notes in a row (test.html checks this).
  function buildSong(definition) {
    const { sections, passes, charts, chords, ...rest } = definition;
    const form = repeat(sections, passes);
    const fullChart = (chart) => [
      ...repeat([silentBar], INTRO_BARS),
      ...repeat(chart, passes),
      ...repeat([silentBar], OUTRO_BARS),
    ];
    return {
      ...rest,
      introBars: INTRO_BARS,
      outroBars: OUTRO_BARS,
      melody: form,
      chords: repeat(chords, passes),
      charts: {
        easy: fullChart(charts.easy),
        normal: fullChart(charts.normal),
        expert: fullChart(charts.expert),
      },
    };
  }

  const SAKURA_PITCH = { b: 59, C: 60, E: 64, F: 65, A: 69, B: 71, c: 72 };
  const SAKURA_ROOT = { Am: 45, F: 41, E: 40 };

  const sakura = buildSong({
    id: 'sakura',
    title: '櫻花',
    origin: '日本傳統民謠',
    bpm: 112,
    passes: 2,
    groove: { lead: 'koto', kick: [0, 6, 8, 14], clave: [4, 12], snare: [], shakerEvery: 0, bass: [0, 8], bassUp: [] },
    sections: [
      'A4 A4 B8', 'A4 A4 B8', 'A4 B4 c4 B4', 'A4 B2 A2 F8',
      'E4 C4 E4 F4', 'E4 E2 C2 b8', 'A4 B4 c4 B4', 'A4 B2 A2 F8',
      'E4 C4 E4 F4', 'E4 E2 C2 b8', 'A4 A4 B8', 'A4 A4 B8',
      'E4 F4 B2 A2 F4', 'E16',
    ].map((text) => phrase(text, SAKURA_PITCH)),
    chords: ['Am', 'Am', 'Am', 'F', 'Am', 'E', 'Am', 'F', 'Am', 'E', 'Am', 'Am', 'F', 'E']
      .map((name) => SAKURA_ROOT[name]),
    charts: {
      easy: [
        'o...o...o.......', 'o...o...o.......', 'o...x...o...x...', 'o...x...o.......',
        'x...o...x...o...', 'x...o...o.......', 'o...x...o...x...', 'o...x...o.......',
        'x...o...x...o...', 'x...o...o.......', 'o...o...x.......', 'o...o...x.......',
        'o...x...o...x...', 'R-------........',
      ],
      normal: [
        'o...o...o.x.o...', 'o...o...o.x.x...', 'o.x.o.x.o...x...', 'o...x.o.o...x...',
        'x...o.x.x...o.x.', 'x...o.o.o...x...', 'o.x.o.x.o...x...', 'o...x.o.o...x...',
        'x...o.x.x...o.x.', 'x...o.o.o...x...', 'o...o...o.x.o.x.', 'o...o...x.x.x...',
        'o.x.o.x.o.x.o.x.', 'R-----------....',
      ],
      expert: [
        'o.x.o.xxo.x.o.xo', 'o.x.o.xxo.xxo.x.', 'o.xxo.xxo.oxo.x.', 'o.x.x.oxo.oxx.o.',
        'x.o.x.oox.o.x.oo', 'x.oox.oox.x.ooxo', 'o.xxo.xxo.oxo.x.', 'o.x.x.oxo.oxx.o.',
        'x.o.x.oox.o.x.oo', 'x.oox.oox.x.ooxo', 'o.x.o.xxo.xoxox.', 'o.x.o.xox.xoxoxo',
        'o.xoxoxoo.xoxoxo', 'x...R-------....',
      ],
    },
  });

  const SAINTS_PITCH = { C: 60, D: 62, E: 64, F: 65, G: 67 };
  const SAINTS_ROOT = { C: 36, F: 41, G: 43 };

  const saints = buildSong({
    id: 'saints',
    title: '聖者的行進',
    origin: '美國紐奧良傳統靈歌',
    bpm: 126,
    passes: 2,
    groove: { lead: 'brass', kick: [0, 10], clave: [], snare: [4, 12], shakerEvery: 2, bass: [0, 8], bassUp: [6, 14] },
    sections: [
      'r4 C4 E4 F4', 'G16', 'r4 C4 E4 F4', 'G16',
      'r4 C4 E4 F4', 'G4 E4 C4 E4', 'D16', 'r4 E4 E4 D4',
      'C8 C4 E4', 'G4 G4 F8', 'r8 E4 F4', 'G4 E4 C4 D4',
      'C16', 'r16',
    ].map((text) => phrase(text, SAINTS_PITCH)),
    chords: ['C', 'C', 'C', 'C', 'C', 'C', 'G', 'G', 'C', 'F', 'F', 'C', 'C', 'C']
      .map((name) => SAINTS_ROOT[name]),
    charts: {
      easy: [
        '....o...o...o...', 'x.......x.......', '....o...o...o...', 'x.......x.......',
        '....o...o...o...', 'x...o...x...o...', 'o.......x.......', '....x...x...o...',
        'o.......o...o...', 'x...x...o.......', '........x...o...', 'x...o...x...o...',
        'o.......o.......', 'R-----------....',
      ],
      normal: [
        '....o.o.o.x.o...', 'x...x.o.x...o.x.', '....o.o.o.x.o...', 'x...x.o.x...o.x.',
        '....o.o.o.x.o...', 'x...o.x.x...o.x.', 'o...x...o.x.o...', '....x.x.x...o...',
        'o...o.x.o...x...', 'x...x...o.x.o...', '....x.x.x...o...', 'x.o.x.o.x.o.x.o.',
        'o...x...o.......', 'R-----------x.x.',
      ],
      expert: [
        'x...o.oxo.x.oxo.', 'x.oxo.x.x.oxo.xo', 'x...o.oxo.x.oxo.', 'x.oxo.x.x.oxo.xo',
        'x...o.oxo.x.oxo.', 'x.oxo.xoxx.oxo.x', 'o.xxo.x.o.xxo.xo', 'x...x.xox.oxo.xo',
        'o.oxo.x.o.oxx.o.', 'x.xox.xoo.xxo.x.', 'o...x.xox.oxo.xo', 'x.oxo.xox.oxo.xo',
        'o.x.o.xoxoxoxox.', 'R-----------xoxo',
      ],
    },
  });

  const SAILOR_PITCH = { C: 60, D: 62, E: 64, F: 65, G: 67, A: 69, B: 71, c: 72, d: 74 };
  const SAILOR_ROOT = { Dm: 38, C: 36 };
  const sailorChords = ['Dm', 'Dm', 'C', 'C', 'Dm', 'Dm', 'C', 'Dm'];

  const sailor = buildSong({
    id: 'sailor',
    title: '水手之歌',
    origin: '英語傳統水手號子',
    bpm: 140,
    passes: 2,
    groove: { lead: 'marimba', kick: [0, 8], clave: [0, 3, 6, 10, 12], snare: [], shakerEvery: 2, bass: [0, 6, 8], bassUp: [14] },
    sections: [
      'A4 A2 A2 A4 A2 A2', 'A4 D4 F4 A4', 'G4 G2 G2 G4 G2 G2', 'G4 C4 E4 G4',
      'A4 A2 A2 A4 A2 A2', 'A4 B4 c4 d4', 'c4 A4 G4 E4', 'D8 D8',
      'A8 A6 A2', 'A4 D4 F4 A4', 'G8 G6 G2', 'G4 C4 E4 G4',
      'A8 A6 A2', 'A4 B4 c4 d4', 'c4 A4 G4 E4', 'D8 D8',
    ].map((text) => phrase(text, SAILOR_PITCH)),
    chords: repeat(sailorChords, 2).map((name) => SAILOR_ROOT[name]),
    charts: {
      easy: [
        'o...o...o...o...', 'o.......x.......', 'o...o...o...o...', 'o.......x.......',
        'o...o...o...o...', 'o...x...o...x...', 'o...x...o...x...', 'o.......o.......',
        'x.......x.......', 'o...o...o...o...', 'x.......x.......', 'o...o...o...o...',
        'x.......x.......', 'o...x...o...x...', 'o...x...o...x...', 'R-------........',
      ],
      normal: [
        'o...o.o.o...o.o.', 'o...x...o...x...', 'o...o.o.o...o.o.', 'o...x...o...x...',
        'o...o.o.o...o.o.', 'o.x.o.x.o.x.o.x.', 'o...x...o.x.o...', 'o.......x.......',
        'x.......x.....x.', 'o...o...o.o.o...', 'x.......x.....x.', 'o...o...o.o.o...',
        'x.......x.....x.', 'o.x.o.x.o.x.o.x.', 'o.o.x...o.o.x...', 'R-----------....',
      ],
      expert: [
        'o.x.o.oxo.x.o.ox', 'o.x.x.o.o.x.xxo.', 'o.x.o.oxo.x.o.ox', 'o.x.x.o.o.x.xxo.',
        'o.x.o.oxo.x.o.ox', 'o.oox.oox.oox.oo', 'x.xxo.oox.xxo.ox', 'o.......R-------',
        'x.x.o.o.xxo.o.x.', 'o.oxo.x.o.oxo.x.', 'x.x.o.o.xxo.o.x.', 'o.oxo.x.o.oxo.x.',
        'x.x.o.o.xxo.o.x.', 'o.x.oxo.x.oxo.xx', 'oxoxooxxoxoxoo..', 'R-----------....',
      ],
    },
  });

  window.BeatSongs = [sakura, saints, sailor];
})();
