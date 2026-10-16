// =====================================================================
//  아비터 — 소리 (효과음 + 상황별 배경음악)
//  파일 없이 Web Audio API로 그 자리에서 합성한다 → 저작권 걱정 없음, 용량 0
//  - 효과음: Sound.sfx('lock') 처럼 이름으로 재생
//  - 배경음악: Sound.scene('day') 로 장면 전환 (1.5초 교차 페이드)
//    · 낮은 남은 시간이 줄수록 드럼이 붙고 필터가 열린다 (Sound.intensity(0~1))
//    · 유령(사망)이 되면 음악이 물속처럼 먹먹해진다 (Sound.muffle(true))
//  브라우저 정책상 첫 클릭/키 입력 전에는 소리가 나지 않는다.
// =====================================================================
const Sound = (() => {
  const KEY = 'arbiter:sound';
  const settings = (() => {
    try { return { music: 0.5, sfx: 0.7, muted: false, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
    catch { return { music: 0.5, sfx: 0.7, muted: false }; }
  })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {} };

  let ctx = null;
  let master, comp, musicBus, musicFilter, sfxBus, reverb, reverbSend, delay, noiseBuf, shaper;
  let wantScene = null;
  let level = 0;            // 낮 긴장도 0~1

  // ---------------------------------------------------------------- 준비
  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
      master = ctx.createGain();
      master.connect(comp).connect(ctx.destination);
      musicFilter = ctx.createBiquadFilter(); musicFilter.type = 'lowpass'; musicFilter.frequency.value = 18000;
      musicBus = ctx.createGain(); musicBus.connect(musicFilter).connect(master);
      sfxBus = ctx.createGain(); sfxBus.connect(master);
      // 공간감: 합성한 잔향 + 딜레이
      reverb = ctx.createConvolver(); reverb.buffer = impulse(2.8);
      reverbSend = ctx.createGain(); reverbSend.gain.value = 1;
      reverbSend.connect(reverb).connect(master);
      delay = ctx.createDelay(1);
      delay.delayTime.value = 0.33;
      const fb = ctx.createGain(); fb.gain.value = 0.32;
      const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2400;
      delay.connect(dl).connect(fb).connect(delay);
      const dOut = ctx.createGain(); dOut.gain.value = 0.35;
      dl.connect(dOut).connect(musicBus);
      noiseBuf = makeNoise();
      shaper = ctx.createWaveShaper(); shaper.curve = distCurve(30); shaper.connect(sfxBus);
      applyVolumes();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }
  function applyVolumes() {
    if (!ctx) return;
    const t = ctx.currentTime;
    master.gain.setTargetAtTime(settings.muted ? 0 : 0.9, t, 0.05);
    musicBus.gain.setTargetAtTime(settings.music * 1.5, t, 0.1);
    sfxBus.gain.setTargetAtTime(settings.sfx * 1.5, t, 0.05);
  }
  // 첫 사용자 입력에서 소리 켜기 (그 전에 요청된 장면이 있으면 그때 시작)
  const unlock = () => {
    if (!ensure()) return;
    if (wantScene && seq.name !== wantScene) startScene(wantScene);
  };
  ['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, unlock, { capture: true }));

  function impulse(sec) {
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }
  function makeNoise() {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  function distCurve(k) {
    const n = 1024; const c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; c[i] = ((3 + k) * x * 20 * Math.PI / 180) / (Math.PI + k * Math.abs(x)); }
    return c;
  }
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // ---------------------------------------------------------------- 기본 소리 재료
  // 하나의 음: 파형 + (선택) 필터 + 볼륨 엔벨로프 + (선택) 음높이 미끄러짐
  function tone(o) {
    const t = o.t ?? ctx.currentTime;
    const dur = o.dur ?? 0.2;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + (o.glide ?? dur));
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    const a = o.attack ?? 0.005;
    const peak = o.gain ?? 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter.type || 'lowpass';
      f.frequency.setValueAtTime(o.filter.freq, t);
      if (o.filter.to) f.frequency.exponentialRampToValueAtTime(o.filter.to, t + (o.filter.time ?? dur));
      f.Q.value = o.filter.q ?? 1;
      node.connect(f); node = f;
    }
    node.connect(g);
    g.connect(o.dest || sfxBus);
    if (o.send) { const s = ctx.createGain(); s.gain.value = o.send; g.connect(s).connect(reverbSend); }
    if (o.echo) { const s = ctx.createGain(); s.gain.value = o.echo; g.connect(s).connect(delay); }
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  function noise(o) {
    const t = o.t ?? ctx.currentTime;
    const dur = o.dur ?? 0.1;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.ftype || 'bandpass';
    f.frequency.setValueAtTime(o.freq || 1000, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    f.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain ?? 0.2, t + (o.attack ?? 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(o.dest || sfxBus);
    if (o.send) { const s = ctx.createGain(); s.gain.value = o.send; g.connect(s).connect(reverbSend); }
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  // ---------------------------------------------------------------- 효과음
  const last = {};
  const FX = {
    click: () => tone({ type: 'square', freq: 1800, dur: 0.035, gain: 0.04, filter: { freq: 3000 } }),
    hover: () => tone({ type: 'sine', freq: 2600, dur: 0.025, gain: 0.018 }),
    pickup: () => { tone({ type: 'sine', freq: 420, to: 980, dur: 0.09, gain: 0.08 }); noise({ freq: 4000, dur: 0.05, gain: 0.03, ftype: 'highpass' }); },
    drop: () => tone({ type: 'sine', freq: 700, to: 300, dur: 0.1, gain: 0.07 }),
    // 예약 확정: "철컥" + 짧은 확인음 두 번
    lock: () => {
      const t = ctx.currentTime;
      noise({ t, freq: 1400, dur: 0.06, gain: 0.18, q: 2 });
      tone({ t, type: 'square', freq: 180, to: 90, dur: 0.09, gain: 0.08, filter: { freq: 900 } });
      tone({ t: t + 0.07, type: 'triangle', freq: 1318, dur: 0.08, gain: 0.07 });
      tone({ t: t + 0.13, type: 'triangle', freq: 1976, dur: 0.14, gain: 0.06, send: 0.2 });
    },
    cancel: () => tone({ type: 'triangle', freq: 1100, to: 380, dur: 0.16, gain: 0.07 }),
    error: () => {
      const t = ctx.currentTime;
      tone({ t, type: 'square', freq: 150, dur: 0.11, gain: 0.07, filter: { freq: 1200 } });
      tone({ t: t + 0.13, type: 'square', freq: 120, dur: 0.14, gain: 0.07, filter: { freq: 1000 } });
    },
    ping: () => {   // 귓속말
      const t = ctx.currentTime;
      tone({ t, type: 'sine', freq: 1568, dur: 0.25, gain: 0.07, send: 0.3 });
      tone({ t: t + 0.09, type: 'sine', freq: 2093, dur: 0.4, gain: 0.06, send: 0.35 });
    },
    notify: () => tone({ type: 'triangle', freq: 1046, dur: 0.09, gain: 0.04, send: 0.15 }),
    coinUp: () => {
      const t = ctx.currentTime;
      tone({ t, type: 'square', freq: 988, dur: 0.07, gain: 0.04, filter: { freq: 4000 } });
      tone({ t: t + 0.07, type: 'square', freq: 1319, dur: 0.22, gain: 0.04, filter: { freq: 4000 }, send: 0.2 });
    },
    coinDown: () => {
      const t = ctx.currentTime;
      tone({ t, type: 'triangle', freq: 660, dur: 0.1, gain: 0.06 });
      tone({ t: t + 0.1, type: 'triangle', freq: 440, dur: 0.18, gain: 0.06 });
    },
    tick: () => tone({ type: 'sine', freq: 1200, dur: 0.04, gain: 0.05 }),
    tickHi: () => tone({ type: 'square', freq: 1600, dur: 0.05, gain: 0.04, filter: { freq: 3000 } }),
    flip: () => noise({ freq: 3000, to: 6000, dur: 0.12, gain: 0.05, ftype: 'highpass' }),
    buy: () => { FX.flip(); setTimeout(() => FX.coinDown(), 60); },
    // 페이즈 전환: 바람 소리처럼 쓸고 지나감
    phase: () => {
      const t = ctx.currentTime;
      noise({ t, freq: 300, to: 3500, dur: 0.6, gain: 0.07, q: 3, attack: 0.25, send: 0.3 });
      tone({ t, type: 'sine', freq: 110, to: 220, dur: 0.6, gain: 0.06, attack: 0.2 });
    },
    // 통금 사이렌: 오르내리는 경보 + 깊은 울림
    siren: () => {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator(); osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(520, t);
      for (let i = 0; i < 3; i++) {
        osc.frequency.linearRampToValueAtTime(880, t + i * 0.8 + 0.4);
        osc.frequency.linearRampToValueAtTime(520, t + i * 0.8 + 0.8);
      }
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1600;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.06, t + 0.3);
      g.gain.setValueAtTime(0.06, t + 2.0); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
      osc.connect(f).connect(g).connect(sfxBus);
      const s = ctx.createGain(); s.gain.value = 0.4; g.connect(s).connect(reverbSend);
      osc.start(t); osc.stop(t + 2.7);
      tone({ t, type: 'sine', freq: 55, dur: 2.6, gain: 0.18, attack: 0.4 });
    },
    shield: () => {
      const t = ctx.currentTime;
      [660, 990, 1320].forEach((f, i) => tone({ t: t + i * 0.06, type: 'sine', freq: f, to: f * 1.5, glide: 0.5, dur: 0.9, gain: 0.05, attack: 0.05, send: 0.5 }));
      noise({ t, freq: 5000, dur: 0.6, gain: 0.03, ftype: 'highpass', attack: 0.1 });
    },
    // 피격: 낮은 폭음 + 찢어지는 잡음 (왜곡을 걸어 거칠게)
    hit: () => {
      const t = ctx.currentTime;
      tone({ t, type: 'sine', freq: 140, to: 38, dur: 0.5, gain: 0.5, dest: shaper });
      noise({ t, freq: 900, to: 200, dur: 0.35, gain: 0.25, ftype: 'lowpass', dest: shaper });
      noise({ t: t + 0.02, freq: 3000, dur: 0.12, gain: 0.08, ftype: 'highpass', send: 0.3 });
    },
    block: () => {   // 방어에 막힘: 금속성 "챙"
      const t = ctx.currentTime;
      tone({ t, type: 'square', freq: 520, dur: 0.5, gain: 0.05, filter: { type: 'bandpass', freq: 2200, q: 8 }, send: 0.5 });
      tone({ t, type: 'triangle', freq: 1560, dur: 0.6, gain: 0.04, send: 0.5 });
      noise({ t, freq: 2500, dur: 0.08, gain: 0.12, q: 4 });
    },
    death: () => {
      const t = ctx.currentTime;
      tone({ t, type: 'sine', freq: 80, to: 30, dur: 1.8, gain: 0.45, dest: shaper });
      tone({ t, type: 'sawtooth', freq: 440, to: 55, dur: 1.6, gain: 0.06, filter: { freq: 1800, to: 200 }, send: 0.5 });
      noise({ t, freq: 600, to: 80, dur: 1.4, gain: 0.12, ftype: 'lowpass' });
      [0.3, 0.55, 0.7].forEach((d) => tone({ t: t + d, type: 'square', freq: 200 + Math.random() * 1600, dur: 0.04, gain: 0.04 }));
    },
    // 정보 탈취 글리치: 무작위 디지털 잡음 조각
    glitch: () => {
      const t = ctx.currentTime;
      for (let i = 0; i < 10; i++) {
        tone({ t: t + i * 0.045, type: 'square', freq: 300 + Math.random() * 2600, dur: 0.035, gain: 0.035, filter: { freq: 5000 } });
      }
      noise({ t: t + 0.2, freq: 7000, dur: 0.15, gain: 0.05, ftype: 'highpass' });
    },
    quiet: () => tone({ type: 'sine', freq: 880, dur: 1.4, gain: 0.04, send: 0.6 }),
    // 암시장 개장: 셔터가 드르륵 내려오는 소리 + 낮은 쿵
    shutter: () => {
      const t = ctx.currentTime;
      for (let i = 0; i < 9; i++) noise({ t: t + i * 0.055, freq: 900 - i * 50, dur: 0.05, gain: 0.05, q: 4 });
      tone({ t: t + 0.5, type: 'sine', freq: 70, to: 40, dur: 0.5, gain: 0.22 });
      noise({ t: t + 0.5, freq: 200, dur: 0.3, gain: 0.08 });
    },
    // 네온사인이 지지직 켜지는 소리
    neon: () => {
      const t = ctx.currentTime;
      [0, 0.09, 0.14, 0.32].forEach((d, i) => tone({ t: t + d, type: 'sawtooth', freq: 120, dur: i === 3 ? 0.9 : 0.04, gain: 0.03, filter: { freq: 1800 } }));
      tone({ t: t + 0.32, type: 'sine', freq: 880, dur: 0.9, gain: 0.015, send: 0.3 });
    },
    // 암시장 → 낮: 조명이 올라오는 소리
    lightsUp: () => {
      const t = ctx.currentTime;
      noise({ t, freq: 400, to: 5000, dur: 0.9, gain: 0.05, q: 2, attack: 0.5, send: 0.3 });
      [64, 69, 76].forEach((m, i) => tone({ t: t + 0.35 + i * 0.07, type: 'triangle', freq: mtof(m), dur: 0.7, gain: 0.04, send: 0.4 }));
    },
    // 소속 공개: 올라가는 바람 + 화음
    reveal: () => {
      const t = ctx.currentTime;
      noise({ t, freq: 200, to: 6000, dur: 0.9, gain: 0.06, q: 2, attack: 0.8, send: 0.4 });
      [57, 64, 69, 71, 76].forEach((m) => tone({ t: t + 0.85, type: 'sawtooth', freq: mtof(m), dur: 2.4, gain: 0.025, attack: 0.02, filter: { freq: 3000, to: 600, time: 2 }, send: 0.5 }));
      tone({ t: t + 0.85, type: 'sine', freq: 55, dur: 2, gain: 0.25 });
    },
    vote: () => {
      const t = ctx.currentTime;
      [72, 76, 79, 84].forEach((m, i) => tone({ t: t + i * 0.09, type: 'triangle', freq: mtof(m), dur: 0.5, gain: 0.06, send: 0.35 }));
    },
    win: () => {
      const t = ctx.currentTime;
      [60, 64, 67, 72, 76, 79, 84].forEach((m, i) => tone({ t: t + i * 0.08, type: 'triangle', freq: mtof(m), dur: 1.2, gain: 0.06, send: 0.4 }));
      [48, 55, 64, 67].forEach((m) => tone({ t: t + 0.55, type: 'sawtooth', freq: mtof(m), dur: 3, gain: 0.03, attack: 0.1, filter: { freq: 2500 }, send: 0.5 }));
    },
    lose: () => {
      const t = ctx.currentTime;
      [69, 65, 62, 57].forEach((m, i) => tone({ t: t + i * 0.28, type: 'triangle', freq: mtof(m), dur: 1.2, gain: 0.06, send: 0.5 }));
      tone({ t: t + 1.1, type: 'sine', freq: 55, dur: 2.5, gain: 0.2 });
    },
  };
  // 같은 효과음이 한꺼번에 쏟아지지 않게 (밤 결과 알림 여러 개 등)
  const GAP = { hover: 0.06, notify: 0.25, tick: 0.3, tickHi: 0.3, click: 0.04, error: 0.2, coinUp: 0.3, coinDown: 0.3, ping: 0.4 };
  function sfx(name) {
    if (settings.muted || !settings.sfx || !FX[name]) return;
    if (!ctx || ctx.state !== 'running') return;   // 아직 첫 클릭 전
    const now = ctx.currentTime;
    if (last[name] && now - last[name] < (GAP[name] ?? 0.05)) return;
    last[name] = now;
    try { FX[name](); } catch (e) { /* 소리 실패는 게임에 영향 없음 */ }
  }

  // ---------------------------------------------------------------- 배경음악: 악기
  function pad(notes, t, dur, o = {}) {
    for (const m of notes) {
      for (const det of [-8, 8]) {
        tone({ t, type: o.type || 'sawtooth', freq: mtof(m), detune: det, dur: dur + 0.8, gain: o.gain ?? 0.016,
          attack: o.attack ?? Math.min(1.2, dur * 0.4), filter: { freq: o.cut ?? 900 }, dest: seq.out, send: o.send ?? 0.25 });
      }
    }
  }
  function bass(m, t, dur, o = {}) {
    tone({ t, type: o.type || 'sawtooth', freq: mtof(m), dur, gain: o.gain ?? 0.09, attack: 0.008,
      filter: { freq: o.cut ?? 1100, to: 180, time: dur * 0.8, q: 4 }, dest: seq.out });
  }
  function pluck(m, t, o = {}) {
    tone({ t, type: o.type || 'square', freq: mtof(m), dur: o.dur ?? 0.22, gain: o.gain ?? 0.03, attack: 0.003,
      filter: { freq: o.cut ?? 3200, to: 700, time: 0.2 }, dest: seq.out, echo: o.echo ?? 0.5, send: 0.15 });
  }
  function bell(m, t, o = {}) {
    tone({ t, type: 'sine', freq: mtof(m), dur: o.dur ?? 2.2, gain: o.gain ?? 0.04, dest: seq.out, send: 0.5, echo: o.echo ?? 0.3 });
    tone({ t, type: 'sine', freq: mtof(m) * 2.76, dur: (o.dur ?? 2.2) * 0.4, gain: (o.gain ?? 0.04) * 0.3, dest: seq.out, send: 0.5 });
  }
  function kick(t, v = 1) {
    tone({ t, type: 'sine', freq: 150, to: 42, glide: 0.12, dur: 0.32, gain: 0.35 * v, dest: seq.out });
  }
  function hat(t, v = 1) { noise({ t, freq: 8000, ftype: 'highpass', dur: 0.04, gain: 0.035 * v, dest: seq.out }); }
  function snare(t, v = 1) {
    noise({ t, freq: 1900, q: 0.8, dur: 0.16, gain: 0.12 * v, dest: seq.out, send: 0.2 });
    tone({ t, type: 'triangle', freq: 190, to: 140, dur: 0.1, gain: 0.08 * v, dest: seq.out });
  }

  // ---------------------------------------------------------------- 배경음악: 장면 (16분음표 16칸 = 1마디)
  const _ = null;
  const C = {   // 코드 (MIDI 번호)
    Am9: [57, 60, 64, 71], Fmaj7: [53, 57, 60, 64], Cmaj7: [48, 55, 59, 64], G6: [55, 59, 62, 64],
    Em7: [52, 55, 59, 62], Gsus: [55, 60, 62, 67],
    Dm: [50, 53, 57], DmC: [48, 53, 57], Bb: [46, 50, 53], A: [45, 49, 52],
    Am: [57, 60, 64], F: [53, 57, 60], C: [48, 52, 55], G: [55, 59, 62], E: [52, 56, 59],
    Am_: [45, 52, 57, 60], F_: [41, 48, 53, 57], E_: [40, 47, 52, 56], Dm_: [38, 45, 50, 53],
  };
  const SCENES = {
    // 입장·대기실: 넓은 패드 + 드문 종소리
    lobby: { bpm: 66, chords: [C.Am9, C.Fmaj7, C.Cmaj7, C.G6], pad: { cut: 1100, gain: 0.014 },
      bass: [0, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _], bassDur: 16, bassOpt: { type: 'sine', gain: 0.12, cut: 400 },
      bell: [3, _, _, _, _, _, 2, _, _, _, 1, _, _, _, _, _] },
    // 아침 뉴스: 밝은 화음 + 통통 튀는 아르페지오
    morning: { bpm: 84, chords: [C.Cmaj7, C.Em7, C.Fmaj7, C.Gsus], pad: { cut: 1400, gain: 0.012 },
      bass: [0, _, _, _, _, _, _, _, 0, _, _, _, _, _, _, _], bassDur: 6, bassOpt: { type: 'triangle', gain: 0.12 },
      arp: [0, _, 1, _, 2, _, 3, _, 2, _, 1, _, 2, _, 3, _], arpOpt: { type: 'triangle', gain: 0.035, echo: 0.4 },
      kick: [0.5, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _] },
    // 투표: 시계처럼 째깍대는 긴장
    vote: { bpm: 100, chords: [C.Dm, C.DmC, C.Bb, C.A], pad: { cut: 700, gain: 0.012 },
      bass: [0, _, 0, _, 0, _, 0, _, 0, _, 0, _, 0, _, 0, _], bassDur: 1.4, bassOpt: { cut: 800, gain: 0.07 },
      hat: [1, .4, .6, .4, 1, .4, .6, .4, 1, .4, .6, .4, 1, .4, .6, .4],
      kick: [1, _, _, _, _, _, _, _, .7, _, _, _, _, _, _, _],
      bell: [5, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _], bellOpt: { gain: 0.025, dur: 1.2 } },
    // 암시장: 신스웨이브 그루브
    shop: { bpm: 108, chords: [C.Am, C.F, C.C, C.G], pad: { cut: 1200, gain: 0.01 },
      bass: [0, _, 12, _, 0, _, 12, _, 0, _, 12, _, 0, _, 12, 7], bassDur: 1.6, bassOpt: { cut: 1400, gain: 0.08 },
      arp: [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 4, 3], arpOpt: { gain: 0.022, dur: 0.15, echo: 0.35 },
      kick: [1, _, _, _, 1, _, _, _, 1, _, _, _, 1, _, _, _],
      snare: [_, _, _, _, 1, _, _, _, _, _, _, _, 1, _, _, _],
      hat: [_, _, 1, _, _, _, 1, _, _, _, 1, _, _, _, 1, _] },
    // 낮(협상): 어두운 오스티나토. 남은 시간이 줄수록 드럼이 붙는다
    day: { bpm: 92, chords: [C.Am, C.F, C.Dm, C.E], pad: { cut: 850, gain: 0.016 }, reactive: true,
      bass: [0, _, 0, 0, _, 0, _, 0, 0, _, 0, 0, _, 0, 7, _], bassDur: 1.2, bassOpt: { cut: 750, gain: 0.09 },
      arp: [_, _, _, _, _, _, 4, _, _, _, _, _, _, _, 2, _], arpOpt: { type: 'triangle', gain: 0.03, dur: 0.4, echo: 0.6 },
      kick: [1, _, _, _, _, _, _, _, 1, _, _, _, _, _, _, _], kickMin: 0.5,
      hat: [_, _, 1, _, _, _, 1, _, _, _, 1, _, _, _, 1, _], hatMin: 0.5,
      snare: [_, _, _, _, 1, _, _, _, _, _, _, _, 1, _, _, _], snareMin: 1,
      hat2: [.5, _, _, .5, _, .5, _, _, .5, _, _, .5, _, .5, _, .5], hat2Min: 1 },
    // 밤: 심장 박동 같은 저음 + 불안한 종소리
    night: { bpm: 56, chords: [C.Am_, C.Am_, C.F_, C.E_], pad: { cut: 480, gain: 0.016, type: 'sawtooth' },
      kick: [.8, _, _, .5, _, _, _, _, _, _, _, _, _, _, _, _],
      bell: [_, _, _, _, _, _, _, _, 'x', _, _, _, _, _, _, _], bellNotes: [82, 83], bellOpt: { gain: 0.022, dur: 3, echo: 0.5 },
      wind: true },
    win: { bpm: 96, chords: [[48, 52, 55, 60], [55, 59, 62, 67], [57, 60, 64, 69], [53, 57, 60, 65]], pad: { cut: 1800, gain: 0.012 },
      bass: [0, _, _, _, 0, _, _, _, 0, _, _, _, 0, _, _, _], bassDur: 3, bassOpt: { type: 'triangle', gain: 0.12 },
      arp: [0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1, 0, 1, 2, 3], arpOpt: { type: 'triangle', gain: 0.028, dur: 0.18 },
      kick: [.7, _, _, _, .7, _, _, _, .7, _, _, _, .7, _, _, _], snare: [_, _, _, _, .6, _, _, _, _, _, _, _, .6, _, _, _] },
    lose: { bpm: 60, chords: [C.Am, C.F, C.Dm, C.E], pad: { cut: 900, gain: 0.022 },
      bass: [0, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _], bassDur: 16, bassOpt: { type: 'sine', gain: 0.14, cut: 400 },
      bell: [2, _, _, _, _, _, _, _, 1, _, _, _, _, _, _, _], bellOpt: { gain: 0.05 } },
  };
  // 코드 안의 n번째 음 (코드 길이를 넘으면 한 옥타브 위)
  const chordNote = (ch, i) => ch[i % ch.length] + 12 * Math.floor(i / ch.length);

  const seq = { name: null, out: null, next: 0, step: 0, timer: null, windNode: null };
  function startScene(name) {
    if (!ensure() || !SCENES[name]) return;
    const t = ctx.currentTime;
    if (seq.out) {
      const old = seq.out;
      old.gain.cancelScheduledValues(t);
      old.gain.setValueAtTime(old.gain.value, t);
      old.gain.linearRampToValueAtTime(0, t + 1.2);
      setTimeout(() => old.disconnect(), 3000);
    }
    if (seq.windNode) { try { seq.windNode.stop(t + 1.3); } catch {} seq.windNode = null; }
    seq.out = ctx.createGain();
    seq.out.gain.setValueAtTime(0, t);
    seq.out.gain.linearRampToValueAtTime(1, t + 1.5);
    seq.out.connect(musicBus);
    seq.name = name;
    seq.step = 0;
    seq.next = t + 0.1;
    if (SCENES[name].wind) startWind();
    if (!seq.timer) seq.timer = setInterval(schedule, 25);
  }
  function startWind() {   // 밤바람: 천천히 흔들리는 걸러진 잡음
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 400; f.Q.value = 0.7;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lg = ctx.createGain(); lg.gain.value = 250;
    lfo.connect(lg).connect(f.frequency);
    const g = ctx.createGain(); g.gain.value = 0.035;
    src.connect(f).connect(g).connect(seq.out);
    src.start(); lfo.start();
    src.onended = () => lfo.stop();
    seq.windNode = src;
  }
  function schedule() {
    const sc = SCENES[seq.name];
    if (!sc || !ctx) return;
    const spb = 60 / sc.bpm / 4;
    if (seq.next < ctx.currentTime - 0.3) seq.next = ctx.currentTime + 0.05;   // 탭이 잠들었다 깨면 밀린 음은 건너뜀
    while (seq.next < ctx.currentTime + 0.15) {
      playStep(sc, seq.step, seq.next, spb);
      seq.next += spb;
      seq.step = (seq.step + 1) % (16 * sc.chords.length);
    }
  }
  function playStep(sc, step, t, spb) {
    const s = step % 16;
    const ch = sc.chords[Math.floor(step / 16) % sc.chords.length];
    const lv = sc.reactive ? level : 0;
    if (s === 0 && sc.pad) pad(ch, t, spb * 16, { ...sc.pad, cut: (sc.pad.cut || 900) + lv * 1400 });
    if (sc.bass && sc.bass[s] != null) bass(ch[0] - 12 + sc.bass[s], t, spb * (sc.bassDur || 1.5), { ...sc.bassOpt, cut: ((sc.bassOpt && sc.bassOpt.cut) || 1100) + lv * 900 });
    if (sc.arp && sc.arp[s] != null) pluck(chordNote(ch, sc.arp[s]) + 12, t, sc.arpOpt);
    if (sc.bell && sc.bell[s] != null) {
      const m = sc.bell[s] === 'x' ? (Math.floor(step / 32) % 2 ? null : sc.bellNotes[Math.floor(Math.random() * sc.bellNotes.length)]) : chordNote(ch, sc.bell[s]) + 12;
      if (m) bell(m, t, sc.bellOpt);
    }
    const on = (k) => sc[k] && sc[k][s] != null && lv >= (sc[k + 'Min'] || 0);
    if (on('kick')) kick(t, sc.kick[s]);
    if (on('snare')) snare(t, sc.snare[s]);
    if (on('hat')) hat(t, sc.hat[s]);
    if (on('hat2')) hat(t, sc.hat2[s]);
  }

  // ---------------------------------------------------------------- 공개 함수
  return {
    sfx,
    scene(name) {
      wantScene = name;
      if (!ctx || ctx.state !== 'running') return;   // 첫 클릭 때 시작
      if (seq.name !== name) startScene(name);
    },
    intensity(v) { level = Math.max(0, Math.min(1, v)); },
    muffle(on) {
      if (!ctx) return;
      musicFilter.frequency.setTargetAtTime(on ? 700 : 18000, ctx.currentTime, 0.4);
    },
    settings,
    set(k, v) { settings[k] = v; save(); applyVolumes(); },
    _debug: () => ({ ctx, comp, startScene, FX: Object.keys(FX) }),   // 테스트(녹음)용
  };
})();
