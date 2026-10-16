// =====================================================================
//  아비터 — 게임 엔진
// ---------------------------------------------------------------------
//  gameState.js 가 "데이터 모양"이라면, 이 파일은 "규칙".
//  - 페이즈 흐름:  MORNING → (VOTE, 2일차부터) → DAY → NIGHT → 다음 MORNING ...
//  - 낮에는 예약만 받고, 밤에 NIGHT_ORDER 순서대로 한꺼번에 처리한다.
//  - 소켓을 직접 만지지 않는다. 화면 갱신/개인 알림은 index.js 가 넘겨준 hooks 로만.
// =====================================================================
const S = require('./gameState');
const { PHASES, RULES, COMPANIES, COMPANY_IDS, CARD_DEFS } = S;

let hooks = {
  broadcast: () => {},          // (room) → 모든 플레이어에게 각자의 view 전송
  notify: () => {},             // (room, playerId, note) → 개인 팝업
};
function init(h) { hooks = { ...hooks, ...h }; }

const timers = new Map();       // roomCode → setTimeout 핸들 (데이터가 아니라서 room 밖에 둔다)

// ---------------------------------------------------------------------
// 공통 도우미
// ---------------------------------------------------------------------
const CHAT_CAP = 300;
let msgCounter = 0;

function pushMsg(list, msg) {
  list.push({ id: ++msgCounter, at: Date.now(), ...msg });
  if (list.length > CHAT_CAP) list.splice(0, list.length - CHAT_CAP);
}

// 아비터 공식 방송 (공개 채팅에 시스템 메시지로)
function announce(room, text) {
  pushMsg(room.chat.public, { from: 'ARBITER', name: '아비터', text, system: true });
}

// 개인 결과: 정보 수첩에 기록 + 팝업
// dir: 'in' = 나에게 일어난 일 / 'out' = 내가 한 일의 결과
function notify(room, playerId, kind, text, dir = 'in') {
  const p = room.players[playerId];
  if (!p) return;
  const note = { day: room.day, kind, text, dir };
  p.notebook.push(note);
  hooks.notify(room, playerId, note);
}

const notifyOut = (room, playerId, kind, text) => notify(room, playerId, kind, text, 'out');
// 화면 HUD 태그: owner 에게만 보이는, target 자리 옆에 붙는 짧은 정보 (다음 밤 정산 전까지 유지)
// tone: intel(알아낸 것) / bad(나쁜 일) / good(좋은 일) / money(돈)
function hud(room, ownerId, targetId, text, tone = 'intel', lines) {
  const p = room.players[ownerId];
  if (p) (p.hud ||= []).push({ day: room.day, targetId, text, tone, ...(lines ? { lines } : {}) });
}
const short = (n) => (n >= 10000 ? `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}k` : n.toLocaleString('ko-KR'));
const nameOf = (room, id) => (room.players[id] ? room.players[id].name : '???');
const won = (n) => n.toLocaleString('ko-KR');

// 페이즈 전환 + 타이머 예약
// phaseToken: 예전에 걸어둔 타이머가 늦게 터져도, 번호가 다르면 무시한다.
//   (예: 전원 준비완료로 DAY 가 일찍 끝났는데, 원래 DAY 타이머가 나중에 터지는 경우)
function setPhase(room, phase, ms, next) {
  clearTimeout(timers.get(room.code));
  const token = ++room.phaseToken;
  room.phase = phase;
  room.phaseEndsAt = ms ? Date.now() + ms : null;
  room.phaseDuration = ms || 0;
  if (ms && next) {
    timers.set(room.code, setTimeout(() => {
      if (room.phaseToken !== token) return;
      try { next(room); } catch (e) { console.error('[phase]', phase, e); }
    }, ms));
  }
  hooks.broadcast(room);
}

function stopRoom(room) {
  clearTimeout(timers.get(room.code));
  timers.delete(room.code);
}

// ---------------------------------------------------------------------
// 게임 시작
// ---------------------------------------------------------------------
function startGame(room) {
  if (room.phase !== PHASES.LOBBY) return '이미 시작되었습니다.';
  if (room.seatOrder.length < RULES.minPlayers) return `최소 ${RULES.minPlayers}명이 필요합니다.`;

  S.startGame(room);            // 자리 섞기, 소속 배분, 크래딧·손패 지급, day=1
  announce(room, `심사 시작 · ${room.settings.maxDays}일 · 참가 기업은 비밀 (정보로 알아내세요)`);
  for (const pid of room.seatOrder) {
    const p = room.players[pid];
    const c = COMPANIES[p.company];
    notify(room, pid, 'company', `소속: ${c.name} · 특수능력 ${c.special.icon} ${c.special.label}`);
  }
  enterMorning(room);
  return null;
}

// ---------------------------------------------------------------------
// 아침: 받은 돈 해제 → 뉴스 → (순위 공개일이면 발표)
// ---------------------------------------------------------------------
function enterMorning(room) {
  room.turn = S.createTurn();
  for (const p of Object.values(room.players)) {
    p.credits += p.pendingCredits + p.lockedCredits;   // 묶인 돈은 혹시 남았으면 돌려줌
    p.pendingCredits = 0;
    p.lockedCredits = 0;
    p.ready = false;
  }

  (room.creditLog ||= []).push({ day: room.day, by: Object.fromEntries(Object.values(room.players).map((p) => [p.id, p.credits])) });
  const lines = [`[${room.day}일차] 아비터 뉴스`];
  if (room.day === 1) lines.push(`심사 ${room.settings.maxDays}일 · 마지막 날 생존 비율이 가장 높은 기업 승리`);
  if (room.lastNight) {
    const dead = room.lastNight.deaths.map((id) => nameOf(room, id));
    lines.push(dead.length ? `☠ 사망: ${dead.join(', ')}` : '사망자 없음');
  }
  // 폭로: 위장과 상관없이 소속을 전원에게 공개
  for (const id of room.exposeQueue) {
    const p = room.players[id];
    p.exposed = true;
    lines.push(`⚠ 폭로: ${p.name} = ${COMPANIES[p.company].name}`);
  }
  room.exposeQueue = [];
  if ([3, 6, 9].includes(room.day)) {
    // 장부 조작한 사람은 순위에서 빠진다
    const top = S.alivePlayers(room).filter((p) => p.hideRankDay !== room.day)
      .sort((a, b) => b.credits - a.credits).slice(0, 3);
    lines.push('💰 크래딧 순위: ' + top.map((p, i) => `${i + 1}. ${p.name} ₵${won(p.credits)}`).join(' · '));
  }
  if (room.day >= 2) {
    room.turn.topic = pickTopic(room);
    lines.push(`🗳 오늘의 회의 주제: ${RULES.voteTopics[room.turn.topic].label}`);
  }
  // 네온캐스트 가짜 뉴스: 진짜 뉴스 사이 무작위 위치에 섞는다 (제목 줄 뒤)
  for (const fake of room.fakeNews) {
    const pos = 1 + Math.floor(Math.random() * lines.length);
    lines.splice(pos, 0, fake);
  }
  room.fakeNews = [];
  room.news.push({ day: room.day, lines });
  lines.forEach((l) => announce(room, l));

  setPhase(room, PHASES.MORNING, room.settings.durations.morning,
    (r) => (r.day >= 2 ? enterDiscuss(r) : enterShop(r)));
}

// ---------------------------------------------------------------------
// 토의 (2일차부터): 투표 전에 의논할 시간. 생존자 전원이 "토의 끝"을 누르면 바로 투표로
// ---------------------------------------------------------------------
function enterDiscuss(room) {
  for (const p of Object.values(room.players)) p.ready = false;
  setPhase(room, PHASES.DISCUSS, room.settings.durations.discuss, enterVote);
}

// ---------------------------------------------------------------------
// 투표 (2일차부터) — 아침마다 주제가 정해진다
//   누구: 지원금 / 피해 1 / 벌금 / 랜덤 카드 3장   찬반: 자본 1위 공개 / 부의 균일화
// ---------------------------------------------------------------------
function pickTopic(room) {
  // 개발용: DEV_TOPIC="equalize,damage" 이면 2일차부터 차례로
  if (process.env.DEV_TOPIC) { const l = process.env.DEV_TOPIC.split(','); return l[(room.day - 2) % l.length]; }
  const last = room.vote.lastTopic;
  const pool = Object.entries(RULES.voteTopics)
    .filter(([k, t]) => k !== last && (!t.minDay || room.day >= t.minDay));
  let r = Math.random() * pool.reduce((a, [, t]) => a + t.weight, 0);
  for (const [k, t] of pool) { r -= t.weight; if (r <= 0) return k; }
  return pool[0][0];
}

function enterVote(room) {
  const topic = room.turn.topic || 'subsidy';
  const base = RULES.votePot(room.day) + room.vote.carryover;
  let pot = base;
  // 횡령: 지원금 주제일 때만, 투표 전에 먼저 빼돌린다
  if (topic === 'subsidy') {
    for (const e of room.voteFx.embezzles) {
      const p = room.players[e.who];
      if (!p.alive) continue;
      const amt = Math.min(pot, Math.floor(base * e.rate));
      pot -= amt;
      p.credits += amt;
      notifyOut(room, p.id, 'politics', `횡령 성공: 지원금에서 ${won(amt)}을 빼돌렸습니다. (바로 사용 가능)`);
    }
  }
  room.turn.votePot = pot;
  for (const p of Object.values(room.players)) p.ready = false;
  if (pot < base) announce(room, `⚠ 지원금이 줄었습니다. 현재 보조금 ${won(pot)}`);
  setPhase(room, PHASES.VOTE, room.settings.durations.vote, resolveVote);
}

function resolveVote(room) {
  const fx = room.voteFx;
  const topic = room.turn.topic || 'subsidy';
  const T = RULES.voteTopics[topic];
  const pot = room.turn.votePot ?? (RULES.votePot(room.day) + room.vote.carryover);
  const alive = (id) => room.players[id] && room.players[id].alive;
  const banned = topic === 'subsidy' ? S.voteBannedId(room) : null;   // 어제 지원금 받은 사람은 오늘 지원금 후보 제외
  const aliveN = S.alivePlayers(room).length;
  const R = { day: room.day, topic, pot };

  if (T.yesno) {
    // 찬반: 표 배수·블랙리스트 적용. 찬성이 반대보다 많아야 통과 (동률 = 부결)
    let yes = 0; let no = 0;
    for (const [voterId, choice] of Object.entries(room.turn.votes)) {
      if (!alive(voterId) || fx.blocked.includes(voterId)) continue;
      const w = fx.weights[voterId] || 1;
      if (choice === 'yes') yes += w; else if (choice === 'no') no += w;
    }
    Object.assign(R, { yes, no, passed: yes > no });
    if (R.passed && topic === 'revealTop') {
      const ps = S.alivePlayers(room);
      const top = Math.max(...ps.map((p) => p.credits));
      R.revealed = ps.filter((p) => p.credits === top).map((p) => ({ id: p.id, credits: p.credits }));
      announce(room, `💰 자본 1위 공개: ${R.revealed.map((x) => `${nameOf(room, x.id)} ₵${won(x.credits)}`).join(' · ')}`);
    } else if (R.passed && topic === 'equalize') {
      const ps = S.alivePlayers(room);
      const sum = ps.reduce((t, p) => t + p.credits, 0);
      const each = Math.floor(sum / ps.length);
      ps.forEach((p) => { p.credits = each; });
      room.vote.carryover += sum - each * ps.length;
      R.each = each;
      announce(room, `⚖ 부의 균일화 통과: 생존자 전원 ₵${won(each)}`);
    } else {
      announce(room, `${T.label} — ${R.passed ? '통과' : '부결'} (찬성 ${yes} · 반대 ${no})`);
    }
  } else {
    // 누구: 최다 득표자 1명 (동률이면 동률 결정권, 그래도 동률이면 무효)
    const tally = {};
    for (const [voterId, targetId] of Object.entries(room.turn.votes)) {
      if (!alive(voterId) || !alive(targetId) || targetId === banned) continue;
      if (fx.blocked.includes(voterId)) continue;
      tally[targetId] = (tally[targetId] || 0) + (fx.weights[voterId] || 1);
    }
    const max = Math.max(0, ...Object.values(tally));
    let leaders = Object.keys(tally).filter((id) => tally[id] === max);
    if (max > 0 && leaders.length > 1) {
      const picks = new Set(fx.tieBreakers.filter(alive).map((id) => room.turn.votes[id]).filter((t) => leaders.includes(t)));
      if (picks.size === 1) leaders = [...picks];
    }
    Object.assign(R, { tally, votes: max });
    // 피해 1 은 생존자 과반 득표가 있어야 실행
    const ok = max > 0 && leaders.length === 1 && (!T.majority || max > aliveN / 2);
    if (!ok) {
      R.winnerId = null; R.tie = max > 0 && leaders.length > 1; R.noMajority = max > 0 && leaders.length === 1 && T.majority;
      if (topic === 'subsidy') room.vote.carryover = 0;   // 지원금은 이월 없음
      announce(room, `${T.label} — ${R.noMajority ? '과반 미달로 무효' : R.tie ? '동률로 무효' : '투표 없음'}`);
    } else {
      const w = room.players[leaders[0]];
      R.winnerId = w.id;
      if (topic === 'subsidy') {
        let rest = pot;
        const commissions = [];
        for (const c of fx.commissions) {
          if (!alive(c.who) || c.who === w.id || room.turn.votes[c.who] !== w.id) continue;
          const cut = Math.min(rest, Math.floor(pot * c.rate));
          rest -= cut;
          if (cut <= 0) continue;
          room.players[c.who].credits += cut;
          commissions.push({ who: c.who, amount: cut });
          notifyOut(room, c.who, 'politics', `커미션: ${w.name}의 당선으로 ${won(cut)}을 받았습니다.`);
          hud(room, c.who, c.who, `커미션 +₵${won(cut)}`, 'money');
        }
        w.credits += rest;
        room.vote.carryover = 0;
        room.vote.lastSubsidy = { day: room.day, winnerId: w.id };
        R.commissions = commissions;
        announce(room, `보조금 ${won(pot)} → ${w.name} (${max}표)`);
      } else if (topic === 'damage') {
        // 투표 피해: 방어로 못 막는다. 유사체력이 있으면 그게 먼저 깨진다
        R.hpBefore = w.hp; R.armorBefore = w.armor;
        if (w.armor > 0) { w.armor -= 1; R.result = 'armor'; } else { w.hp = Math.max(0, w.hp - 1); R.result = 'hp'; }
        R.hpAfter = w.hp;
        if (w.hp === 0) {
          w.alive = false; w.diedOnDay = room.day; w.ready = false; R.died = true;
          notify(room, w.id, 'death', '투표로 사망했습니다. 유령 모드로 전환됩니다.');
        }
        hud(room, w.id, w.id, R.result === 'armor' ? '투표 피해: ◈ −1' : '투표 피해: ♥ −1', 'bad');
        announce(room, `처벌 투표 → ${w.name} (${max}표)${R.died ? ' — 사망' : ''}`);
      } else if (topic === 'fine') {
        const amt = Math.min(w.credits, T.amount);
        w.credits -= amt;
        room.vote.carryover += amt;
        R.amount = amt;
        hud(room, w.id, w.id, `벌금 −₵${won(amt)}`, 'bad');
        announce(room, `벌금 ₵${won(amt)} → ${w.name} (다음 보조금에 적립)`);
      } else if (topic === 'cards') {
        for (let k = 0; k < T.count; k++) {
          const { defId } = S.rollCard(RULES.randomTierWeights);
          w.hand.push(S.createCard(defId, 'gift', 0));
        }
        R.count = T.count;
        hud(room, w.id, w.id, `카드 +${T.count}`, 'good');
        announce(room, `랜덤 카드 ${T.count}장 → ${w.name}`);
      }
      room.history.push({ day: room.day, kind: `vote_${topic}`, from: w.id, to: w.id, amount: R.amount });
    }
  }
  room.vote.lastResult = R;

  // 개인 결과: 투표권 무효 통보, 개표 감시 결과
  for (const id of new Set(fx.blocked)) {
    if (alive(id) && room.turn.votes[id]) notify(room, id, 'politics', '당신의 표는 블랙리스트에 올라 무효 처리되었습니다.');
  }
  const voteTxt = (v) => (v === 'yes' ? '찬성' : v === 'no' ? '반대' : nameOf(room, v));
  for (const w of fx.watchers) {
    if (!alive(w.who)) continue;
    const t = room.players[w.target];
    const v = room.turn.votes[w.target];
    notifyOut(room, w.who, 'politics', v ? `개표 감시: ${t.name}은(는) ${voteTxt(v)}에 투표했습니다.` : `개표 감시: ${t.name}은(는) 투표하지 않았습니다.`);
    hud(room, w.who, t.id, v ? `투표 → ${v === t.id ? '자신' : voteTxt(v)}` : '투표 안 함');
  }
  room.voteFx = S.createVoteFx();
  room.vote.lastTopic = topic;
  // 결과 연출 시간을 둔 뒤 암시장으로. 투표로 승부가 났으면 끝
  setPhase(room, PHASES.VOTE_RESULT, process.env.DURATIONS ? 400 : 5500, (r) => {
    const win = checkWinner(r);
    if (win) return endGame(r, win);
    enterShop(r);
  });
}

// ---------------------------------------------------------------------
// 카드 구매 턴: 경매(비공개 입찰) + 랜덤 구매 + 판매
// ---------------------------------------------------------------------
function enterShop(room) {
  // 경매 5장 = 무력·정보·기만·공작·정치 한 장씩 (계열은 고정, 카드는 무작위)
  const fams = ['force', 'intel', 'deceit', 'ops', 'politics'];
  room.turn.auction = fams.slice(0, RULES.auctionSlots).map((fam, i) => {
    const { family, tier, defId } = S.rollCard(RULES.auctionTierWeights, fam);
    return { id: `a${room.day}_${i}`, family, tier, defId, sold: false, price: null, winnerId: null };
  });
  room.turn.bids = {};
  // 매일 무료 랜덤 카드 1장 (판매가 0, 랜덤 구매와 같은 등급 확률)
  room.turn.freeCards = {};
  for (const p of S.alivePlayers(room)) {
    const { defId } = S.rollCard(RULES.randomTierWeights);
    const card = S.createCard(defId, 'free', 0);
    p.hand.push(card);
    room.turn.freeCards[p.id] = card.uid;
  }
  for (const p of Object.values(room.players)) p.ready = false;
  setPhase(room, PHASES.SHOP, room.settings.durations.shop, resolveShop);
}

function resolveShop(room) {
  // 1) 묶어둔 입찰금을 전부 풀었다가
  for (const p of Object.values(room.players)) {
    p.credits += p.lockedCredits;
    p.lockedCredits = 0;
  }
  // 2) 슬롯마다 최고가 낙찰자만 자기 입찰가를 낸다 (동률이면 랜덤)
  const soldLines = [];
  for (const slot of room.turn.auction) {
    const bids = Object.entries(room.turn.bids)
      .map(([pid, b]) => ({ p: room.players[pid], amount: b[slot.id] || 0 }))
      .filter((x) => x.amount > 0 && x.p.alive);
    if (!bids.length) { soldLines.push('유찰'); continue; }
    const max = Math.max(...bids.map((x) => x.amount));
    const top = bids.filter((x) => x.amount === max);
    const winner = top[Math.floor(Math.random() * top.length)].p;
    const slotNo = room.turn.auction.indexOf(slot) + 1;
    const FAM = { force: '무력', intel: '정보', deceit: '기만', ops: '공작', politics: '정치' };
    for (const x of bids) {
      if (x.p === winner) continue;
      notifyOut(room, x.p.id, 'auction', `경매 ${slotNo}번 ${FAM[slot.family]} 낙찰 실패 — ${won(max)}에 팔림${x.amount === max ? ' (동률 추첨에서 밀림)' : ''}, 내 입찰 ${won(x.amount)} 환불`);
    }
    winner.credits -= max;
    winner.hand.push(S.createCard(slot.defId, 'auction', max));
    Object.assign(slot, { sold: true, price: max, winnerId: winner.id });
    soldLines.push(`팔림 ${won(max)}`);
    notifyOut(room, winner.id, 'auction',
      `경매 낙찰: ${CARD_DEFS[slot.defId].name} (${won(max)})${top.length > 1 ? ' — 동률 추첨에서 당첨' : ''}`);
  }
  announce(room, `경매 결과: ${soldLines.map((l, i) => `${i + 1}번 ${l}`).join(' · ')}`);
  room.turn.bids = {};

  for (const p of S.alivePlayers(room)) {
    const limit = RULES.handLimit(room.day);
    if (p.hand.length > limit) {
      notify(room, p.id, 'limit', `손패 한도(${limit}장)를 넘었습니다. ${p.hand.length - limit}장을 팔거나 버려야 카드를 쓸 수 있습니다.`);
    }
  }
  enterDay(room);
}

// ---------------------------------------------------------------------
// 낮: 협상 + 예약. 생존자 전원 준비완료면 바로 밤.
// ---------------------------------------------------------------------
function enterDay(room) {
  for (const p of Object.values(room.players)) p.ready = false;   // 구매 턴의 "구매 완료" 체크를 지운다
  setPhase(room, PHASES.DAY, room.settings.durations.day, enterNight);
}

function checkAllReady(room) {
  if (!S.alivePlayers(room).every((p) => p.ready)) return;
  if (room.phase === PHASES.DAY) enterNight(room);
  else if (room.phase === PHASES.SHOP) resolveShop(room);
  else if (room.phase === PHASES.DISCUSS) enterVote(room);
}

// ---------------------------------------------------------------------
// 밤: 예약 일괄 처리
// ---------------------------------------------------------------------
function enterNight(room) {
  room.lastNight = resolveNight(room);
  // 밤 연출 길이: 무슨 일이 일어난 사람 한 명당 한 장면(beatMs) + 끝난 뒤 잠깐 정리(summaryMs)
  const N = room.lastNight;
  const people = new Set([...N.attacks.map((a) => a.targetId), ...N.heals.map((h) => h.targetId), ...N.armors, ...(N.ops || []).map((o) => o.targetId)]);
  const fixed = process.env.DURATIONS ? room.settings.durations.night : null;   // 자동 테스트용
  N.beatMs = fixed ? Math.max(150, Math.floor(fixed / (Math.max(1, people.size) + 1))) : (process.env.FAST ? 3000 : 4300);
  N.summaryMs = fixed ? N.beatMs : (process.env.FAST ? 5000 : 8000);   // 정리 화면: 무슨 일이 있었는지 볼 시간
  // 한 사람에게 결과가 여러 개면 차례로 터지도록 그 사람 장면을 늘린다 (결과 2개 넘으면 1개당 +slot)
  const slot = fixed ? 0 : (process.env.FAST ? 800 : 1200);
  N.beatPlan = {};
  let total = 0;
  for (const id of people) {
    const at = N.attacks.find((x) => x.targetId === id);
    const n = (at ? Math.max(1, at.result.split('+').length) : 0) + (N.heals.some((h) => h.targetId === id) ? 1 : 0)
      + (N.armors.includes(id) ? 1 : 0) + (N.ops || []).filter((o) => o.targetId === id).length + (N.deaths.includes(id) ? 1 : 0);
    N.beatPlan[id] = N.beatMs + Math.max(0, n - 2) * slot;
    total += N.beatPlan[id];
  }
  if (!people.size) total = N.beatMs;
  setPhase(room, PHASES.NIGHT, total + N.summaryMs, afterNight);
}

function resolveNight(room) {
  const day = room.day;
  const aliveAtStart = S.alivePlayers(room);
  for (const p of Object.values(room.players)) p.hud = [];   // 지난 태그는 새 밤 결과로 교체

  // 0) 예약 → 실행할 행동 목록으로 펼치기 (손패에 실제로 있는 카드만)
  const actions = [];
  for (const p of aliveAtStart) {
    const res = room.turn.reservations[p.id];
    if (!res) continue;
    for (const a of res.cards) {
      const card = p.hand.find((c) => c.uid === a.cardUid);
      if (!card) continue;
      const ability = CARD_DEFS[card.defId].abilities.find((ab) => ab.key === a.ability);
      if (!ability) continue;
      actions.push({ actor: p, card, ability, targetId: a.targetId, usePierce: !!a.usePierce, fakeCompany: a.fakeCompany });
    }
  }
  // 회사 특수능력: 숨은 카드처럼 같은 단계에서 처리 (EMP 대상 아님, 정보 수집에 안 잡힘)
  for (const p of aliveAtStart) {
    const ca = room.turn.reservations[p.id] && room.turn.reservations[p.id].company;
    if (!ca || ca.type !== 'special') continue;
    const defId = COMPANIES[p.company].special.card;
    actions.push({ actor: p, card: { uid: `co_${p.id}`, defId }, ability: CARD_DEFS[defId].abilities[0], targetId: ca.targetId, isCompany: true, fakeKind: ca.fakeKind });
  }
  // 쓴 카드는 1회용 → 손패에서 제거 (EMP로 취소돼도 사라진다)
  for (const act of actions) act.actor.hand = act.actor.hand.filter((c) => c.uid !== act.card.uid);

  const opsEvents = [];   // 공개 밤 장면: { targetId, kind: 'destroy'|'snatch'|'steal'|'scan'|'firewall', amount?, blocked? }
  // 0.5) 방화벽: 오늘 밤 나에게 오는 정보·공작·디버프 무효 (EMP 로도 못 끈다)
  const firewalled = new Set(actions.filter((a) => a.ability.key === 'firewall').map((a) => a.actor.id));
  const FW_BLOCK = ['investigate', 'snoop', 'wiretap', 'expose', 'emp', 'sabotage', 'steal', 'destroyCard', 'snatchCard', 'voteBlock'];
  const fwBlocked = [];
  for (const a of actions) {
    if (!FW_BLOCK.includes(a.ability.key) || !firewalled.has(a.targetId) || a.targetId === a.actor.id) continue;
    fwBlocked.push(a);
    if (!opsEvents.some((o) => o.targetId === a.targetId && o.kind === 'firewall')) opsEvents.push({ targetId: a.targetId, kind: 'firewall', blocked: true });
    hud(room, a.actor.id, a.targetId, '방화벽에 막힘', 'bad');
    notifyOut(room, a.actor.id, 'ops', `${nameOf(room, a.targetId)}의 방화벽에 막혔습니다.`);
  }
  for (const pid of firewalled) {
    const n = fwBlocked.filter((a) => a.targetId === pid).length;
    hud(room, pid, pid, n ? `방화벽: ${n}건 차단` : '방화벽: 차단 없음', 'good');
  }
  // 막힌 행동은 아래 단계에서 빠진다 (EMP 대상 목록에서도 제외)
  for (const a of fwBlocked) actions.splice(actions.indexOf(a), 1);

  // 1) EMP: 대상이 오늘 밤 쓴 인물 카드 1장을 무작위로 취소. EMP끼리는 무작위 순서로 먼저 터진 쪽이 이긴다.
  const cancelled = new Set();
  for (const e of shuffle(actions.filter((a) => a.ability.key === 'emp'))) {
    if (cancelled.has(e)) continue;
    const t = room.players[e.targetId];
    const victims = actions.filter((a) => a.actor.id === t.id && !cancelled.has(a) && !a.isCompany);
    room.history.push({ day, kind: 'emp', from: e.actor.id, to: t.id });
    if (!victims.length) {
      notifyOut(room, e.actor.id, 'ops', `EMP: ${t.name}은(는) 오늘 밤 인물 카드를 쓰지 않았다.`);
      hud(room, e.actor.id, t.id, 'EMP · 카드 없음');
      continue;
    }
    const v = victims[Math.floor(Math.random() * victims.length)];
    cancelled.add(v);
    notifyOut(room, e.actor.id, 'ops', `EMP: ${t.name}의 카드 1장을 무효화했습니다.`);
    notify(room, t.id, 'ops', `누군가의 EMP로 오늘 밤 [${CARD_DEFS[v.card.defId].name}]이(가) 무효가 되었습니다.`);
    hud(room, e.actor.id, t.id, 'EMP 성공');
    hud(room, t.id, t.id, `EMP: ${CARD_DEFS[v.card.defId].name} 무효`, 'bad');
  }
  const live = actions.filter((a) => !cancelled.has(a));
  const of = (key) => live.filter((a) => a.ability.key === key);

  // 2) 기만: 오늘 밤 이 사람에게 걸린 속임수를 정리해둔다 (5단계 정보, 7단계 송금에서 사용)
  const deceit = {};   // { [playerId]: { disguise: 최고등급, forgery: 회사, cookBooks, counterTrace, anon } }
  for (const a of live.filter((x) => CARD_DEFS[x.card.defId].family === 'deceit')) {
    const d = (deceit[a.actor.id] ||= {});
    const k = a.ability.key;
    if (k === 'disguise') d.disguise = Math.max(d.disguise || 0, a.ability.level);
    if (k === 'forgery') d.forgery = a.fakeCompany;
    if (k === 'cookBooks') { d.cookBooks = true; a.actor.hideRankDay = day + 1; }
    if (k === 'counterTrace') d.counterTrace = true;
    if (k === 'anonTransfer') d.anon = true;
    if (k === 'escrow') d.escrow = true;
    if (k === 'bribe') d.bribe = Math.max(d.bribe || 0, a.ability.mult);   // 오늘 송금 3배 (EMP 로 취소되면 없음)
  }

  // 3) 방어와 회복
  const defense = {};
  for (const a of of('defend')) {
    defense[a.targetId] = (defense[a.targetId] || 0) + a.ability.power;
    room.history.push({ day, kind: 'defend', from: a.actor.id, to: a.targetId });
  }
  const cardName = (a) => CARD_DEFS[a.card.defId].name;
  const heals = [];    // 공개: 체력이 실제로 오른 사람
  const armors = [];   // 공개: 유사체력을 얻은 사람
  for (const a of of('heal')) {
    const t = room.players[a.targetId];
    if (!t.alive) continue;
    const before = t.hp;
    t.hp = Math.min(RULES.startHp, t.hp + a.ability.power);
    if (t.hp > before) {
      const h = heals.find((x) => x.targetId === t.id);
      if (h) h.hpAfter = t.hp; else heals.push({ targetId: t.id, hpBefore: before, hpAfter: t.hp });
    }
    room.history.push({ day, kind: 'heal', from: a.actor.id, to: t.id });
    if (t.hp > before && t.id !== a.actor.id) notify(room, t.id, 'heal', `누군가 당신을 치료했습니다. 체력 ${before} → ${t.hp}`);
    notifyOut(room, a.actor.id, 'heal', t.hp > before
      ? `[${cardName(a)}] ${t.id === a.actor.id ? '나' : t.name} 치료 → 체력 ${before} → ${t.hp}`
      : `[${cardName(a)}] ${t.id === a.actor.id ? '나' : t.name} 치료 → 이미 최대 체력이라 효과 없음`);
  }

  // 유사체력: 체력이 깎일 때 대신 소모된다. 소모될 때까지 다음 밤에도 유지, 최대 RULES.maxArmor
  for (const a of of('armor')) {
    const t = room.players[a.targetId];
    if (!t.alive) continue;
    const before = t.armor;
    t.armor = Math.min(RULES.maxArmor, t.armor + a.ability.power);
    if (t.armor > before && !armors.includes(t.id)) armors.push(t.id);
    room.history.push({ day, kind: 'armor', from: a.actor.id, to: t.id });
    const who = t.id === a.actor.id ? '나' : t.name;
    if (t.armor > before && t.id !== a.actor.id) notify(room, t.id, 'heal', '누군가 당신에게 장갑을 입혔습니다. 유사체력 +1 (체력 대신 한 번 깎임)');
    notifyOut(room, a.actor.id, 'heal', t.armor > before
      ? `[${cardName(a)}] ${who}에게 유사체력 +1`
      : `[${cardName(a)}] ${who === '나' ? '나는' : `${who}은(는)`} 이미 유사체력이 있어 효과 없음 (최대 ${RULES.maxArmor})`);
  }

  // 4) 공격 — 같은 대상에게 온 공격은 합산, 관통 공격은 방어를 무시
  //    남은 피해 1  → 손패 1장 무작위 파괴 (손패가 없으면 크래딧 손실)
  //    남은 피해 2+ → 체력 1 (유사체력이 있으면 그것부터). 하루에 잃는 건 체력 1 또는 카드 1
  //    압도(사이보그 용병)가 섞인 피해 2+ → 체력 1 + 카드 1
  const hits = {};
  for (const a of of('attack')) {
    // 카드 자체 관통(사이보그 용병) 또는 레드라인 패시브 관통
    let pierce = !!a.ability.pierce;
    if (!pierce && a.usePierce && (a.actor.passiveUses.pierce || 0) > 0) {
      a.actor.passiveUses.pierce -= 1;
      pierce = true;
    }
    const h = (hits[a.targetId] ||= { normal: 0, pierce: 0, count: 0, by: [], overwhelm: false });
    if (a.ability.overwhelm) h.overwhelm = true;
    if (pierce) h.pierce += a.ability.power; else h.normal += a.ability.power;
    h.count += 1;
    h.by.push({ actor: a.actor, card: cardName(a), pierce });
    room.history.push({ day, kind: 'attack', from: a.actor.id, to: a.targetId, pierce });
  }
  const attacks = [];
  const deaths = [];
  // 피해 1의 대가: 손패 1장 무작위 파괴, 손패가 없으면 크래딧 손실. 결과 문장을 돌려준다
  const loseCard = (t) => {
    if (t.hand.length) {
      const card = t.hand.splice(Math.floor(Math.random() * t.hand.length), 1)[0];
      return { kind: 'card', name: CARD_DEFS[card.defId].name };
    }
    const amount = Math.min(t.credits, RULES.noCardPenalty);
    t.credits -= amount;
    return { kind: 'credits', amount };
  };
  for (const [tid, h] of Object.entries(hits)) {
    const t = room.players[tid];
    const def = defense[tid] || 0;
    const damage = h.pierce + Math.max(0, h.normal - def);
    const hpBefore = t.hp;
    const armorBefore = t.armor;
    let lost = null;          // 카드/크래딧 손실
    let hpLoss = 0;
    let armorUsed = false;
    // 유사체력이 있으면 가장 먼저 깨진다 (피해 1이든 2 이상이든 그날 공격을 통째로 막음)
    if (damage >= 1 && t.armor > 0) {
      t.armor -= 1; armorUsed = true;
      if (h.overwhelm && damage >= 2) lost = loseCard(t);
    } else if (damage >= 2) {
      t.hp = Math.max(0, t.hp - 1); hpLoss = 1;
      if (h.overwhelm) lost = loseCard(t);
    } else if (damage === 1) {
      lost = loseCard(t);
    }
    // 공개 결과: 카드 이름은 비공개, "카드 1장 / 크래딧"만
    const result = damage === 0 ? 'blocked' : [hpLoss && 'hp', armorUsed && 'armor', lost && lost.kind].filter(Boolean).join('+');
    attacks.push({ targetId: tid, count: h.count, damage, hpBefore, hpAfter: t.hp, armorBefore, armorAfter: t.armor,
      result, lostCredits: lost && lost.kind === 'credits' ? lost.amount : 0, shielded: def > 0 });
    const lostTxt = !lost ? '' : lost.kind === 'card' ? `손패 [${lost.name}] 파괴` : `손패가 없어 크래딧 ${won(lost.amount)} 손실`;
    if (lost && lost.kind === 'card') hud(room, tid, tid, `${lost.name} 파괴됨`, 'bad');
    const bodyTxt = hpLoss ? `체력 -1 (남은 체력 ${t.hp})` : armorUsed ? '유사체력이 대신 깎임' : '';
    notify(room, tid, 'attack', damage > 0
      ? `공격을 ${h.count}번 받았습니다 (남은 피해 ${damage}). ${[bodyTxt, lostTxt].filter(Boolean).join(' · ')}`
      : `공격을 ${h.count}번 받았지만 모두 막아냈습니다.`);
    if (t.hp === 0) {
      t.alive = false;
      t.diedOnDay = day;
      t.ready = false;
      deaths.push(tid);
      notify(room, tid, 'death', '당신은 사망했습니다. 유령 모드로 전환됩니다. 이제 모든 소속이 보입니다.');
    }
    // 공격한 사람에게도 결과 (같은 대상에게 온 공격은 합산되므로 합산 결과를 알려준다)
    const pubLost = !lost ? '' : lost.kind === 'card' ? '카드 1장 파괴' : `크래딧 ${won(lost.amount)} 손실 (손패 없음)`;
    const pubBody = hpLoss ? `체력 ${hpBefore} → ${t.hp}${t.hp === 0 ? ' · 사망' : ''}` : armorUsed ? '유사체력 소모' : '';
    for (const b of h.by) {
      const others = h.count > 1 ? ` (이 대상에게 온 공격 총 ${h.count}회 합산)` : '';
      notifyOut(room, b.actor.id, 'attack', damage > 0
        ? `[${b.card}] ${t.name} 공격 → 피해 ${damage}: ${[pubBody, pubLost].filter(Boolean).join(' · ')}${b.pierce ? ' · 관통' : ''}${others}`
        : `[${b.card}] ${t.name} 공격 → 방어에 막힘${others}`);
    }
  }

  // 방어한 사람에게 결과
  for (const a of of('defend')) {
    const t = room.players[a.targetId];
    const atk = attacks.find((x) => x.targetId === t.id);
    const who = t.id === a.actor.id ? '나' : t.name;
    notifyOut(room, a.actor.id, 'defend', !atk
      ? `[${cardName(a)}] ${who} 방어 → 오늘 밤 공격은 없었습니다`
      : atk.damage > 0
        ? `[${cardName(a)}] ${who} 방어 → 공격 ${atk.count}회 중 일부가 뚫림 (남은 피해 ${atk.damage})`
        : `[${cardName(a)}] ${who} 방어 → 공격 ${atk.count}회를 모두 막아냄`);
  }

  // 오리온 공매도: 찍어둔 사람이 오늘 밤 피해(카드·크래딧·체력)를 입었으면 지급
  for (const a of of('shortSell')) {
    const t = room.players[a.targetId];
    const atk = attacks.find((x) => x.targetId === t.id && x.damage > 0);
    room.history.push({ day, kind: 'shortSell', from: a.actor.id, to: t.id, amount: atk ? a.ability.payout : 0 });
    if (atk) {
      a.actor.pendingCredits += a.ability.payout;
      notifyOut(room, a.actor.id, 'income', `공매도 성공: ${t.name}이(가) 피해를 입어 ${won(a.ability.payout)} (내일 아침부터)`);
      hud(room, a.actor.id, t.id, `공매도 +₵${short(a.ability.payout)}`, 'money');
    } else {
      notifyOut(room, a.actor.id, 'income', `공매도 실패: ${t.name}은(는) 피해를 입지 않았습니다.`);
      hud(room, a.actor.id, t.id, '공매도 실패', 'bad');
    }
  }

  // 5) 정보: 조사, 추적, 도청, 폭로 — 결과는 쓴 사람에게만
  const intelActs = live.filter((a) => ['investigate', 'snoop', 'wiretap', 'expose'].includes(a.ability.key));
  const snoopers = {};  // 역추적용: { [대상]: [{ who, kind }] }
  for (const a of intelActs) {
    (snoopers[a.targetId] ||= []).push({ who: a.actor.id, kind: a.ability.key });
    const text = resolveIntel(room, a, deceit, actions);
    if (a.targetId !== a.actor.id) opsEvents.push({ targetId: a.targetId, kind: 'scan' });   // 공개 장면: 누군가 이 사람을 캐냄 (누가인지는 비밀)
    notifyOut(room, a.actor.id, 'intel', `[${a.card.defId && CARD_DEFS[a.card.defId].name}] ${text}`);
    if (a._tags) a._tags.forEach((tg) => hud(room, a.actor.id, a.targetId, tg, 'intel'));
    else if (a._tag) hud(room, a.actor.id, a.targetId, a._tag, 'intel', a._lines);
    room.history.push({ day, kind: a.ability.key, from: a.actor.id, to: a.targetId });
  }

  // 암시장 정찰: 다음 암시장(내일)에서 경매 카드 앞면이 보인다
  for (const a of of('marketPeek')) {
    a.actor.marketPeekDay = day + 1;
    hud(room, a.actor.id, a.actor.id, '내일 경매 정찰', 'good');
    notifyOut(room, a.actor.id, 'intel', `[${cardName(a)}] 내일 암시장 경매 카드 5장의 정체를 미리 볼 수 있습니다.`);
  }

  // 역추적: 오늘 밤 나를 캐낸 사람 (어떤 방법으로 캐냈는지까지)
  const INTEL_LABEL = { investigate: '조사', snoop: '정보 수집', wiretap: '도청', expose: '폭로' };
  for (const [pid, d] of Object.entries(deceit)) {
    if (!d.counterTrace) continue;
    const list = (snoopers[pid] || []).map((x) => `${nameOf(room, x.who)}(${INTEL_LABEL[x.kind]})`);
    for (const x of snoopers[pid] || []) {
      hud(room, pid, x.who, `나를 ${INTEL_LABEL[x.kind]}함`, 'bad');
      // 역으로 털어오기: 캐낸 사람에 대한 정보 수집 1개
      const rev = { actor: room.players[pid], targetId: x.who, ability: { key: 'snoop', count: 1 }, card: { uid: 'rev' } };
      const txt = resolveIntel(room, rev, deceit, actions);
      (rev._tags || []).forEach((tg) => hud(room, pid, x.who, tg, 'intel'));
      notifyOut(room, pid, 'deceit', `역추적 → ${txt}`);
    }
    if (!list.length) hud(room, pid, pid, '역추적: 캐낸 사람 없음', 'good');
    notifyOut(room, pid, 'deceit', list.length
      ? `역추적: 오늘 밤 당신을 캐낸 사람 — ${list.join(', ')}`
      : '역추적: 오늘 밤 당신을 캐낸 사람은 없습니다.');
  }

  // 6) 공작: 사보타주 → 도둑질 → 손패 파괴 → 빼앗기. 도둑질·빼앗기는 대상에게 방어가 있으면 막힌다 (손패 파괴는 방어 무시).
  const shielded = (id) => (defense[id] || 0) > 0;
  for (const a of of('sabotage')) {
    const t = room.players[a.targetId];
    t.sabotagedDay = day + 1;
    room.history.push({ day, kind: 'sabotage', from: a.actor.id, to: t.id });
    notifyOut(room, a.actor.id, 'ops', `사보타주: ${t.name}의 내일 회사 카드를 정지시켰습니다.`);
    notify(room, t.id, 'ops', '누군가의 사보타주로 내일 회사 카드를 쓸 수 없습니다.');
    hud(room, a.actor.id, t.id, '회사카드 정지시킴');
    hud(room, t.id, t.id, '내일 회사카드 정지', 'bad');
  }
  const blocked = (a, what) => {
    const t = room.players[a.targetId];
    notifyOut(room, a.actor.id, 'ops', `${what}: ${t.name}의 방어에 막혔습니다.`);
    notify(room, t.id, 'ops', `누군가의 ${what} 시도가 방어에 막혔습니다.`);
    hud(room, a.actor.id, t.id, `${what} 막힘`, 'bad');
    hud(room, t.id, t.id, `${what} 막아냄`, 'good');
  };
  for (const a of of('steal')) {
    const t = room.players[a.targetId];
    room.history.push({ day, kind: 'steal', from: a.actor.id, to: t.id });
    if (shielded(t.id)) { blocked(a, '도둑질'); opsEvents.push({ targetId: t.id, kind: 'steal', blocked: true }); continue; }
    const amount = Math.floor(t.credits * a.ability.rate);
    opsEvents.push({ targetId: t.id, kind: 'steal', amount });
    t.credits -= amount;
    a.actor.pendingCredits += amount;
    notifyOut(room, a.actor.id, 'ops', `${t.name}에게서 ${won(amount)} 훔침 (내일 아침부터 사용 가능)`);
    notify(room, t.id, 'ops', `누군가 당신의 크래딧 ${won(amount)}을 훔쳐갔습니다.`);
    hud(room, a.actor.id, t.id, `₵${short(amount)} 훔침`, 'money');
    hud(room, t.id, t.id, `₵${short(amount)} 도둑맞음`, 'bad');
  }
  for (const a of of('destroyCard')) {
    const t = room.players[a.targetId];
    room.history.push({ day, kind: 'destroyCard', from: a.actor.id, to: t.id });
    if (!t.hand.length) { notifyOut(room, a.actor.id, 'ops', `손패 파괴: ${t.name}의 손패가 비어 있었습니다.`); continue; }
    const card = t.hand.splice(Math.floor(Math.random() * t.hand.length), 1)[0];
    opsEvents.push({ targetId: t.id, kind: 'destroy' });
    notifyOut(room, a.actor.id, 'ops', `손패 파괴: ${t.name}의 [${CARD_DEFS[card.defId].name}]을(를) 파괴했습니다.`);
    notify(room, t.id, 'ops', `누군가 당신의 손패 [${CARD_DEFS[card.defId].name}]을(를) 파괴했습니다.`);
    hud(room, a.actor.id, t.id, `${CARD_DEFS[card.defId].name} 파괴`);
    hud(room, t.id, t.id, `${CARD_DEFS[card.defId].name} 파괴됨`, 'bad');
  }
  for (const a of of('snatchCard')) {
    const t = room.players[a.targetId];
    room.history.push({ day, kind: 'snatchCard', from: a.actor.id, to: t.id });
    if (shielded(t.id)) { blocked(a, '손패 빼앗기'); opsEvents.push({ targetId: t.id, kind: 'snatch', blocked: true }); continue; }
    if (!t.hand.length) { notifyOut(room, a.actor.id, 'ops', `빼앗기: ${t.name}의 손패가 비어 있었습니다.`); continue; }
    const card = t.hand.splice(Math.floor(Math.random() * t.hand.length), 1)[0];
    a.actor.hand.push({ ...card, source: 'stolen', price: 0 });   // 빼앗은 카드는 판매가 0
    opsEvents.push({ targetId: t.id, kind: 'snatch' });
    notifyOut(room, a.actor.id, 'ops', `빼앗기: ${t.name}의 [${CARD_DEFS[card.defId].name}]을(를) 손에 넣었습니다.`);
    notify(room, t.id, 'ops', `누군가 당신의 손패 [${CARD_DEFS[card.defId].name}]을(를) 빼앗아갔습니다.`);
    hud(room, a.actor.id, t.id, `${CARD_DEFS[card.defId].name} 탈취`, 'good');
    hud(room, t.id, t.id, `${CARD_DEFS[card.defId].name} 빼앗김`, 'bad');
  }

  // 7) 회사 카드 (공격으로 죽은 사람의 회사 카드는 취소)
  for (const p of aliveAtStart) {
    const ca = room.turn.reservations[p.id] && room.turn.reservations[p.id].company;
    if (!ca || ca.type === 'special') continue;   // 특수능력은 위에서 처리, 수입 없음
    if (!p.alive) continue;
    // 송금 대상이 오늘 밤 죽었으면 송금 대신 자원 얻기로 처리
    if (ca.type === 'transfer' && !room.players[ca.targetId].alive) {
      notifyOut(room, p.id, 'transfer', `송금 대상 ${nameOf(room, ca.targetId)}이(가) 사망해 대신 자원을 얻었습니다.`);
      hud(room, p.id, ca.targetId, '송금 실패 (사망)', 'bad');
    }
    // 에스크로: 상대도 나에게 송금하지 않았으면 내 송금은 취소, 대신 자원
    let escrowFail = false;
    if (ca.type === 'transfer' && deceit[p.id] && deceit[p.id].escrow && room.players[ca.targetId].alive) {
      const back = room.turn.reservations[ca.targetId] && room.turn.reservations[ca.targetId].company;
      if (!(back && back.type === 'transfer' && back.targetId === p.id)) {
        escrowFail = true;
        notifyOut(room, p.id, 'transfer', `에스크로: ${nameOf(room, ca.targetId)}이(가) 송금하지 않아 내 송금을 취소하고 자원을 얻었습니다.`);
        hud(room, p.id, ca.targetId, '에스크로: 배신 감지', 'bad');
      } else hud(room, p.id, ca.targetId, '에스크로 성립', 'good');
    }
    if (ca.type === 'resource' || escrowFail || !room.players[ca.targetId].alive) {
      const gain = S.getResourceGain(p);
      p.pendingCredits += gain;
      notifyOut(room, p.id, 'income', `자원 얻기 +${won(gain)} (내일 아침부터 사용 가능)`);
      hud(room, p.id, p.id, `+₵${short(gain)} 자원`, 'money');
    } else if (ca.type === 'transfer') {
      const t = room.players[ca.targetId];
      const amount = S.getTransferGift(room, p, (deceit[p.id] && deceit[p.id].bribe) || 0);
      const anon = !!(deceit[p.id] && deceit[p.id].anon);
      t.pendingCredits += amount;
      room.history.push({ day, kind: 'transfer', from: p.id, to: t.id, amount, anon });
      notifyOut(room, p.id, 'transfer', `${t.name}에게 ${won(amount)} ${anon ? '익명 ' : ''}송금 완료`);
      notify(room, t.id, 'transfer', `${anon ? '익명의 누군가' : p.name}에게서 ${won(amount)} 받음 (내일 아침부터 사용 가능)`);
      hud(room, p.id, t.id, `₵${short(amount)} 보냄`, 'money');
      if (anon) hud(room, t.id, t.id, `익명 +₵${short(amount)}`, 'money');
      else hud(room, t.id, p.id, `₵${short(amount)} 보내줌`, 'money');
    }
  }

  // 8) 정치: 다음 날 아침 투표에 적용될 효과 등록
  const fx = room.voteFx;
  for (const a of live.filter((x) => CARD_DEFS[x.card.defId].family === 'politics')) {
    const ab = a.ability;
    const who = a.actor.id;
    if (ab.key === 'voteWeight') fx.weights[a.targetId] = (fx.weights[a.targetId] || 1) * ab.weight;   // 쌓인다 (2배 × 2배 = 4표)
    if (ab.key === 'voteBlock') fx.blocked.push(a.targetId);
    if (ab.key === 'voteWatch') fx.watchers.push({ who, target: a.targetId });
    if (ab.key === 'commission') fx.commissions.push({ who, rate: ab.rate });
    if (ab.key === 'embezzle') fx.embezzles.push({ who, rate: ab.rate });
    if (ab.key === 'tieBreak') fx.tieBreakers.push(who);
    room.history.push({ day, kind: ab.key, from: who, to: a.targetId });
    notifyOut(room, who, 'politics', `[${CARD_DEFS[a.card.defId].name}] ${ab.label} — 내일 아침 투표에 적용됩니다.`);
  }



  // 네온캐스트 가짜 밤 장면: 공개 결과에 진짜처럼 섞는다 (모두에게 보이는 체력·유사체력과 어긋나지 않는 것만)
  for (const a of of('fakeNews')) {
    if (!a.actor.alive) continue;
    const pool = S.alivePlayers(room).filter((p) => p.id !== a.actor.id);
    const kind = a.fakeKind;
    const free = pool.filter((p) => !attacks.some((x) => x.targetId === p.id));
    const t = shuffle(kind === 'attack' || kind === 'defend' ? (free.length ? free : pool) : pool)[0];
    if (!t) continue;
    if (kind === 'attack' && t.armor === 0) {
      attacks.push({ targetId: t.id, count: 1, damage: 1, hpBefore: t.hp, hpAfter: t.hp, armorBefore: 0, armorAfter: 0, result: 'card', lostCredits: 0, shielded: false });
    } else if (kind === 'attack' || kind === 'defend') {
      attacks.push({ targetId: t.id, count: 1, damage: 0, hpBefore: t.hp, hpAfter: t.hp, armorBefore: t.armor, armorAfter: t.armor, result: 'blocked', lostCredits: 0, shielded: true });
    } else if (kind === 'money') {
      opsEvents.push({ targetId: t.id, kind: 'steal', amount: 100 * (2 + Math.floor(Math.random() * 8)) });
    } else {
      opsEvents.push({ targetId: t.id, kind: 'scan' });
    }
    room.history.push({ day, kind: 'newsEdit', from: a.actor.id, to: t.id, text: { attack: '가짜 공격', defend: '가짜 방어', money: '가짜 도둑질', intel: '가짜 조사' }[kind] });
    notifyOut(room, a.actor.id, 'news', `방송망 침투: ${t.name}에게 가짜 장면을 송출합니다.`);
    hud(room, a.actor.id, t.id, '가짜 장면 송출', 'good');
  }

  // 내일 정보용: 오늘 밤 각자 쓴 인물 카드 (계열만, EMP로 취소된 것 포함)
  room.prevPlays = { day, by: {} };
  for (const p of aliveAtStart) room.prevPlays.by[p.id] = actions.filter((x) => x.actor.id === p.id && !x.isCompany).map((x) => CARD_DEFS[x.card.defId].family);
  return { day, shields: [...new Set(Object.keys(defense))], attacks, heals, armors, ops: opsEvents, deaths, glitch: intelActs.length > 0 };
}

// ---------------------------------------------------------------------
// 정보 카드 결과 만들기
// ---------------------------------------------------------------------
const shuffle = (arr) => arr.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
const coName = (c) => COMPANIES[c].name;
const coShort = (c) => COMPANIES[c].name.split(' ')[0];   // '헬리오스' 처럼 앞 단어만

function resolveIntel(room, act, deceit = {}, actions = []) {
  const actor = act.actor;
  const t = room.players[act.targetId];
  const ab = act.ability;
  const dec = deceit[t.id] || {};

  // 내가 이미 알아낸 것 (중복 정보 방지)
  const K = (actor.known ||= { absent: [], cards: [], facts: [] });
  const unknownAbsent = COMPANY_IDS.filter((c) => !room.activeCompanies.includes(c) && !K.absent.includes(c));
  const revealAbsent = () => {
    const c = shuffle(unknownAbsent)[0];
    if (!c) return null;
    K.absent.push(c); unknownAbsent.splice(unknownAbsent.indexOf(c), 1);
    return c;
  };
  const FAM_KO = { force: '무력', intel: '정보', deceit: '기만', ops: '공작', politics: '정치' };
  const prevFams = room.prevPlays && room.prevPlays.day === room.day - 1 ? room.prevPlays.by[t.id] : undefined;
  const prevKey = `prev:${t.id}:${room.day - 1}`;
  const prevTag = (f) => (f.length ? `어젯밤 ${f.length}장: ${f.map((x) => FAM_KO[x]).join('·')}` : '어젯밤 0장');

  if (ab.key === 'investigate') {
    const bonus = 0;
    const grade = Math.min(3, ab.grade);

    // 기만 판정: 위조 신분증(상급엔 뚫림)이 위장보다 우선
    let shown = t.company;
    if (dec.forgery && grade < 3) {
      shown = dec.forgery;
    } else if (dec.disguise && grade <= dec.disguise) {
      shown = shuffle(room.activeCompanies.filter((c) => c !== t.company))[0];
    }
    const faked = shown !== t.company;
    // 후보는 5개 회사 전체에서 (참가 기업이 새지 않게). 가짜일 때 목록에는 진짜 소속을 넣지 않는다
    const others = COMPANY_IDS.filter((c) => c !== shown && (!faked || c !== t.company));
    const tags = [];
    let text;
    if (grade === 1) {
      // 하급: (보여줄 소속) 포함 3개 중 하나 + 덤: 이번 판 불참 기업 1곳
      const picks = shuffle([shown, ...shuffle(others).slice(0, 2)]);
      text = `${t.name}은(는) ${picks.map(coName).join(' · ')} 중 하나`;
      tags.push(`${picks.map(coShort).join('/')} 중`);
      const ab2 = revealAbsent();
      if (ab2) { text += ` · ${coName(ab2)}은(는) 이번 판에 없다`; tags.push(`${coShort(ab2)} 불참`); }
    } else if (grade === 2) {
      // 중급: 70%는 진짜, 30%는 가짜를 "70% 확률로 X" 라고 말해준다
      const said = Math.random() < 0.7 ? shown : shuffle(others)[0];
      text = `${t.name}은(는) 70% 확률로 ${coName(said)}`;
      tags.push(`${coShort(said)}? (70%)`);
    } else {
      text = `${t.name}은(는) ${coName(shown)} (확정)`;
      tags.push(`${coShort(shown)} 확정`);
      if (ab.full) {
        const hand = t.hand.map((c) => CARD_DEFS[c.defId].name).join(', ') || '없음';
        text += ` · 손패: ${hand} · 크래딧 ${won(t.credits)}`;
        tags.push(`₵${short(t.credits)} · 손패 ${t.hand.length}`);
        t.hand.forEach((c) => { if (!K.cards.includes(c.uid)) K.cards.push(c.uid); });
      }
    }
    // 중급·상급: 덤으로 어젯밤 쓴 카드 수·계열
    if (grade >= 2 && prevFams && !K.facts.includes(prevKey)) {
      K.facts.push(prevKey); tags.push(prevTag(prevFams)); text += ` · ${prevTag(prevFams)}`;
    }
    act._tags = tags;
    return text;
  }

  if (ab.key === 'snoop') {
    // 정보 수집: 아래 중 무작위 (해커는 2개). 이미 알아낸 건 다시 안 나온다
    const freshHand = t.hand.filter((c) => !K.cards.includes(c.uid));
    const plays = actions.filter((x) => x.actor.id === t.id && !x.isCompany && !K.cards.includes(x.card.uid));
    const kinds = ['credits'];
    if (freshHand.length) kinds.push('hand');
    if (plays.length) kinds.push('play');
    if (prevFams && !K.facts.includes(prevKey)) kinds.push('prev');
    if (unknownAbsent.length) kinds.push('absent');
    const picks = shuffle(kinds).slice(0, ab.count || 1);
    const tags = []; const texts = [];
    for (const k of picks) {
      if (k === 'hand') {
        const c = freshHand[Math.floor(Math.random() * freshHand.length)];
        K.cards.push(c.uid);
        tags.push(`손패: ${CARD_DEFS[c.defId].name}`); texts.push(`손패에 「${CARD_DEFS[c.defId].name}」이(가) 있다.`);
      } else if (k === 'play') {
        const x = plays[Math.floor(Math.random() * plays.length)];
        K.cards.push(x.card.uid);
        const tn = x.targetId === t.id ? '자신' : nameOf(room, x.targetId);
        tags.push(`사용: ${CARD_DEFS[x.card.defId].name} → ${tn}`); texts.push(`오늘 밤 「${CARD_DEFS[x.card.defId].name}」을(를) ${tn}에게 썼다.`);
      } else if (k === 'prev') {
        K.facts.push(prevKey);
        tags.push(prevTag(prevFams)); texts.push(`${prevTag(prevFams)}.`);
      } else if (k === 'absent') {
        const c = revealAbsent();
        tags.push(`${coShort(c)} 불참`); texts.push(`${coName(c)}은(는) 이번 판에 없다.`);
      } else if (dec.cookBooks) {
        tags.push('크래딧: 장부 조작됨'); texts.push('크래딧을 확인하려 했지만 장부가 조작되어 있다.');
      } else {
        tags.push(`₵${short(t.credits)}`); texts.push(`크래딧 ${won(t.credits)}을 가지고 있다.`);
      }
    }
    act._tags = tags;
    return `${t.name}: ${texts.join(' ')}`;
  }

  if (ab.key === 'wiretap') {
    // 대상이 오늘 주고받은 귓속말 중 무작위 N줄 (시간 순). 도청꾼은 상대 이름을 가리고, 해커는 공개
    const today = [];
    for (const [key, list] of Object.entries(room.chat.whispers)) {
      if (!key.split('|').includes(t.id)) continue;
      for (const m of list) if (m.day === room.day) today.push(m);
    }
    const n = ab.lines || 2;
    const picked = today.map((m) => [Math.random(), m]).sort((a, b) => a[0] - b[0]).slice(0, n)
      .map(([, m]) => m).sort((a, b) => a.id - b.id);
    if (!picked.length) { act._tag = '귓속말 없음'; return `${t.name}은(는) 오늘 귓속말을 하지 않았다.`; }
    const who = (id) => (id === t.id ? t.name : ab.reveal ? nameOf(room, id) : '???');
    act._lines = picked.map((m) => ({ from: who(m.from), to: who(m.to), text: m.text }));
    act._tag = `감청 ${picked.length}줄`;
    return `${t.name}의 귓속말 감청:\n` + act._lines.map((l) => `${l.from} → ${l.to}: "${l.text}"`).join('\n');
  }

  if (ab.key === 'expose') {
    if (!room.exposeQueue.includes(t.id)) room.exposeQueue.push(t.id);
    act._tag = '내일 폭로';
    return `${t.name}의 소속을 내일 아침 전원에게 폭로합니다.`;
  }
  return '';
}

function afterNight(room) {
  const w = checkWinner(room);
  if (w) return endGame(room, w);
  if (room.day >= room.settings.maxDays) return endGame(room, timeLimitWinner(room));
  room.day += 1;
  enterMorning(room);
}

// ---------------------------------------------------------------------
// 승리 판정
// ---------------------------------------------------------------------
function checkWinner(room) {
  const companies = new Set(S.alivePlayers(room).map((p) => p.company));
  if (companies.size === 0) return { companyIds: [], reason: '모든 요원이 사망했습니다. 승자 없음.' };
  if (companies.size === 1) {
    const c = [...companies][0];
    return { companyIds: [c], reason: `${COMPANIES[c].name} 외의 모든 요원이 제거되었습니다.` };
  }
  return null;
}

function timeLimitWinner(room) {
  const all = Object.values(room.players);
  const stats = COMPANY_IDS.filter((c) => room.teamSizeAtStart[c] > 0).map((c) => {
    const members = all.filter((p) => p.company === c);
    const size = room.teamSizeAtStart[c];
    const alive = members.filter((p) => p.alive).length;
    const assets = members.filter((p) => p.alive).reduce((s, p) => s + p.credits + p.pendingCredits + p.lockedCredits, 0);   // 죽은 사람의 돈은 제외
    return { companyId: c, alive, size, ratio: alive / size, avgAssets: Math.round(assets / size) };
  });
  const bestRatio = Math.max(...stats.map((s) => s.ratio));
  let top = stats.filter((s) => s.ratio === bestRatio);
  let reason = `심사 종료 — 생존 비율 ${Math.round(bestRatio * 100)}%로 최고`;
  if (top.length > 1) {
    const bestAvg = Math.max(...top.map((s) => s.avgAssets));
    top = top.filter((s) => s.avgAssets === bestAvg);
    reason += `, 동률이라 1인당 평균 자산(생존자 자산 합 ÷ 처음 인원 = ${won(bestAvg)})으로 결정`;
  }
  return { companyIds: top.map((s) => s.companyId), reason, stats };
}

function endGame(room, winner) {
  room.winner = winner;
  (room.creditLog ||= []).push({ day: room.day + 1, final: true, by: Object.fromEntries(Object.values(room.players).map((p) => [p.id, p.credits + p.pendingCredits + p.lockedCredits])) });
  const names = winner.companyIds.map((c) => COMPANIES[c].name).join(', ') || '없음';
  announce(room, `심사 종료. 승리 기업: ${names}. ${winner.reason}`);
  setPhase(room, PHASES.ENDED, null, null);
  stopRoom(room);
}

// ---------------------------------------------------------------------
// 플레이어 행동 (검증 → 상태 변경). 문제가 있으면 에러 문자열을 돌려준다.
// ---------------------------------------------------------------------
function getRes(room, pid) {
  return (room.turn.reservations[pid] ||= { cards: [], company: null });
}

function validTarget(room, actor, targetType, targetId) {
  const t = room.players[targetId];
  if (!t || !t.alive) return '살아있는 대상을 골라야 합니다.';
  if (targetType === 'other' && targetId === actor.id) return '자신에게는 쓸 수 없습니다.';
  if (targetType === 'self' && targetId !== actor.id) return '자신에게만 쓸 수 있습니다.';
  return null;
}

const actionHandlers = {
  // 인물 카드 예약: { cardUid, ability, targetId, usePierce }
  reserveCard(room, p, d) {
    if (room.phase !== PHASES.DAY) return '낮에만 예약할 수 있습니다.';
    const limit = RULES.handLimit(room.day);
    if (p.hand.length > limit) return `손패 한도(${limit}장) 초과 — 먼저 카드를 팔거나 버리세요.`;
    const res = getRes(room, p.id);
    const card = p.hand.find((c) => c.uid === d.cardUid);
    if (!card) return '손패에 없는 카드입니다.';
    if (res.cards.some((c) => c.cardUid === d.cardUid)) return '이미 예약한 카드입니다.';
    const maxCards = S.cardCap(room, p);
    if (res.cards.length + (res.company ? 1 : 0) >= maxCards) return `오늘은 카드를 ${maxCards}장까지 쓸 수 있습니다. (회사 카드 포함)`;
    const ability = CARD_DEFS[card.defId].abilities.find((ab) => ab.key === d.ability);
    if (!ability) return '그 카드에 없는 능력입니다.';
    const err = validTarget(room, p, ability.target, d.targetId);
    if (err) return err;
    if (ability.minDay && room.day < ability.minDay) return `${ability.minDay}일차부터 쓸 수 있는 능력입니다.`;
    let usePierce = false;
    if (d.usePierce && ability.key === 'attack' && !ability.pierce) {
      const reserved = res.cards.filter((c) => c.usePierce).length;
      if ((p.passiveUses.pierce || 0) <= reserved) return '관통 횟수가 남아있지 않습니다.';
      usePierce = true;
    }
    let fakeCompany;
    if (ability.chooseCompany) {
      if (!COMPANY_IDS.includes(d.fakeCompany)) return '위조할 소속을 골라야 합니다.';
      fakeCompany = d.fakeCompany;
    }
    res.cards.push({ cardUid: card.uid, ability: ability.key, targetId: d.targetId, usePierce, fakeCompany });
    p.ready = false;
    return null;
  },

  cancelCard(room, p, d) {
    if (room.phase !== PHASES.DAY) return '낮에만 회수할 수 있습니다.';
    const res = getRes(room, p.id);
    const before = res.cards;
    res.cards = res.cards.filter((c) => c.cardUid !== d.cardUid);
    // 위조 허가증(+2)을 회수하면 한도를 넘게 되는 경우: 다른 카드부터 회수해야 한다
    if (res.cards.length + (res.company ? 1 : 0) > S.cardCap(room, p)) { res.cards = before; return '먼저 다른 카드를 회수하세요. (허가증을 빼면 한도 초과)'; }
    p.ready = false;
    return null;
  },

  // 회사 카드: { type: 'resource' } | { type: 'transfer', targetId }
  //   송금 = 내 자원 대신 상대가 2배(오리온 2.5배, 뇌물 3배)를 받는다. 금액 입력 없음, 내 돈은 안 빠져나감
  setCompany(room, p, d) {
    if (room.phase !== PHASES.DAY) return '낮에만 예약할 수 있습니다.';
    if (p.sabotagedDay === room.day) return '사보타주로 오늘은 회사 카드를 쓸 수 없습니다.';
    const res = getRes(room, p.id);
    const maxCards = S.cardCap(room, p);
    if (!res.company && res.cards.length >= maxCards) return `오늘은 카드를 ${maxCards}장까지 쓸 수 있습니다. (회사 카드 포함)`;
    res.company = null;

    if (d.type === 'resource') {
      res.company = { type: 'resource' };
    } else if (d.type === 'transfer') {
      const err = validTarget(room, p, 'other', d.targetId);
      if (err) return err;
      res.company = { type: 'transfer', targetId: d.targetId };
    } else if (d.type === 'special') {
      // 회사 특수능력 (무제한, 그날 수입 없음)
      const sp = COMPANIES[p.company].special;
      const targetId = sp.target === 'self' ? p.id : d.targetId;
      const err = validTarget(room, p, sp.target, targetId);
      if (err) return err;
      let fakeKind;
      if (sp.fake) {
        if (!['attack', 'defend', 'money', 'intel'].includes(d.fakeKind)) return '송출할 분야를 고르세요.';
        fakeKind = d.fakeKind;
      }
      res.company = { type: 'special', targetId, fakeKind };
    } else {
      return '알 수 없는 회사 카드 행동입니다.';
    }
    p.ready = false;
    return null;
  },

  clearCompany(room, p) {
    if (room.phase !== PHASES.DAY) return '낮에만 바꿀 수 있습니다.';
    getRes(room, p.id).company = null;
    p.ready = false;
    return null;
  },

  // ---- 카드 구매 턴 ----
  // 입찰: { slotId, amount } — amount 0 이면 입찰 취소. 입찰 총액만큼 lockedCredits 로 묶인다.
  bid(room, p, d) {
    if (room.phase !== PHASES.SHOP) return '카드 구매 턴이 아닙니다.';
    const slot = room.turn.auction.find((s) => s.id === d.slotId);
    if (!slot) return '없는 경매 카드입니다.';
    const amount = Math.max(0, Math.floor(Number(d.amount) || 0));
    const minBid = RULES.auctionMinBid(room.day);
    if (amount > 0 && amount < minBid) return `오늘 최저 입찰가는 ${won(minBid)}입니다.`;
    const myBids = (room.turn.bids[p.id] ||= {});
    const otherTotal = Object.entries(myBids)
      .filter(([id]) => id !== slot.id).reduce((s, [, v]) => s + v, 0);
    const available = p.credits + p.lockedCredits;          // 묶인 돈까지 합친 실제 보유액
    if (otherTotal + amount > available) return `입찰 총액은 보유 크래딧(${won(available)})을 넘을 수 없습니다.`;
    if (amount === 0) delete myBids[slot.id]; else myBids[slot.id] = amount;
    const total = otherTotal + amount;
    p.credits = available - total;
    p.lockedCredits = total;
    p.ready = false;
    return null;
  },

  buyRandom(room, p) {
    if (room.phase !== PHASES.SHOP) return '카드 구매 턴이 아닙니다.';
    const price = RULES.randomPrice(room.day);
    const bought = room.turn.randomBuys[p.id] || 0;
    if (bought >= RULES.randomBuyLimit) return `랜덤 카드는 하루 ${RULES.randomBuyLimit}장까지 살 수 있습니다.`;
    if (p.credits < price) return '크래딧이 부족합니다. (입찰로 묶인 돈은 쓸 수 없습니다)';
    const { defId } = S.rollCard(RULES.randomTierWeights);
    p.credits -= price;
    room.turn.randomBuys[p.id] = bought + 1;
    const card = S.createCard(defId, 'random', price);
    p.hand.push(card);
    notifyOut(room, p.id, 'buy', `랜덤 구매: ${CARD_DEFS[defId].name} (${'★'.repeat(CARD_DEFS[defId].tier)})`);
    p.ready = false;
    return null;
  },

  // 판매: 구매 턴에는 언제나, 낮에는 손패 한도를 넘었을 때만
  sellCard(room, p, d) {
    return removeCard(room, p, d.cardUid, true);
  },
  discardCard(room, p, d) {
    return removeCard(room, p, d.cardUid, false);
  },

  // 네온캐스트 패시브: 다음 아침 뉴스에 가짜 1줄. text 가 비어 있으면 취소.
  newsEdit(room, p, d) {
    if (room.phase !== PHASES.DAY) return '낮에만 예약할 수 있습니다.';
    if (!(p.passiveUses.newsEdit > 0)) return '뉴스 조작 권한이 없습니다.';
    const text = String(d.text || '').trim().slice(0, 80);
    if (!text) delete room.turn.newsEdits[p.id]; else room.turn.newsEdits[p.id] = text;
    return null;
  },

  ready(room, p, d) {
    if (![PHASES.DAY, PHASES.SHOP, PHASES.DISCUSS].includes(room.phase)) return '지금은 준비 완료할 수 없습니다.';
    // 구매 턴 마감 직전에 누른 "구매 완료"가 늦게 도착해 낮의 "준비 완료"로 처리되는 것 방지
    if (d && d.phase && d.phase !== room.phase) return '단계가 이미 바뀌었습니다. 다시 눌러주세요.';
    p.ready = d && d.value !== undefined ? !!d.value : !p.ready;
    hooks.broadcast(room);
    checkAllReady(room);
    return 'SKIP_BROADCAST';
  },

  vote(room, p, d) {
    if (room.phase !== PHASES.VOTE) return '지금은 투표 시간이 아닙니다.';
    const topic = RULES.voteTopics[room.turn.topic || 'subsidy'];
    if (topic.yesno) {
      if (!['yes', 'no'].includes(d.choice)) return '찬성 또는 반대를 고르세요.';
      room.turn.votes[p.id] = d.choice;
    } else {
      const err = validTarget(room, p, 'any', d.targetId);   // 자기 자신에게 투표 가능
      if (err) return err;
      if (room.turn.topic === 'subsidy' && d.targetId === S.voteBannedId(room)) return '어제 보조금을 받은 요원은 오늘 받을 수 없습니다.';
      room.turn.votes[p.id] = d.targetId;
    }
    // 생존자 전원이 투표하면 바로 마감
    if (S.alivePlayers(room).every((x) => room.turn.votes[x.id])) {
      resolveVote(room);
      return 'SKIP_BROADCAST';
    }
    return null;
  },
};

function removeCard(room, p, cardUid, sell) {
  const overLimit = p.hand.length > RULES.handLimit(room.day);
  if (room.phase !== PHASES.SHOP && !(room.phase === PHASES.DAY && overLimit)) {
    return '카드 구매 턴이나, 손패 한도를 넘었을 때만 정리할 수 있습니다.';
  }
  const card = p.hand.find((c) => c.uid === cardUid);
  if (!card) return '손패에 없는 카드입니다.';
  p.hand = p.hand.filter((c) => c.uid !== cardUid);
  const res = room.turn.reservations[p.id];
  if (res) res.cards = res.cards.filter((c) => c.cardUid !== cardUid);
  if (sell) {
    const price = S.sellPrice(card);
    p.credits += price;
    notifyOut(room, p.id, 'sell', `${CARD_DEFS[card.defId].name} 판매 +${won(price)}`);
  }
  return null;
}

function handleAction(room, playerId, type, data = {}) {
  const p = room.players[playerId];
  if (!p) return '플레이어를 찾을 수 없습니다.';
  if (!p.alive) return '탈락자는 행동할 수 없습니다.';
  const fn = actionHandlers[type];
  if (!fn) return '알 수 없는 행동입니다.';
  const result = fn(room, p, data);
  if (result === 'SKIP_BROADCAST') return null;   // 이미 내부에서 화면 갱신함
  if (!result) hooks.broadcast(room);
  return result;
}

// ---------------------------------------------------------------------
// 로비 설정 (방장만): { key, value }
// ---------------------------------------------------------------------
function updateSettings(room, playerId, d = {}) {
  if (room.phase !== PHASES.LOBBY) return '대기실에서만 바꿀 수 있습니다.';
  if (room.hostId !== playerId) return '방장만 바꿀 수 있습니다.';
  const opts = S.SETTING_OPTIONS[d.key];
  const value = Number(d.value);
  if (!opts || !opts.includes(value)) return '고를 수 없는 값입니다.';
  if (d.key === 'maxDays') room.settings.maxDays = value;
  else room.settings.durations[d.key] = value * 1000;
  hooks.broadcast(room);
  return null;
}

// 게임이 끝난 방을 같은 멤버로 대기실 상태로 되돌린다 (설정·방장·공개 채팅 유지)
function resetRoom(room) {
  if (room.phase !== PHASES.ENDED) return null;
  stopRoom(room);
  const fresh = S.createRoom({ code: room.code, hostId: room.hostId });
  fresh.settings = room.settings;
  fresh.chat.public = room.chat.public;
  for (const pid of room.seatOrder) {
    const old = room.players[pid];
    if (!old.connected) continue;                       // 나간 사람은 정리
    const p = S.createPlayer({ id: old.id, name: old.name, socketId: old.socketId });
    p.avatar = old.avatar;
    fresh.players[pid] = p;
    fresh.seatOrder.push(pid);
  }
  if (!fresh.players[fresh.hostId]) fresh.hostId = fresh.seatOrder[0] || null;
  Object.keys(room).forEach((k) => delete room[k]);
  Object.assign(room, fresh);                           // 같은 객체를 유지해야 rooms Map 이 그대로 동작
  announce(room, '심사가 초기화되었습니다. 대기실로 돌아왔습니다.');
  hooks.broadcast(room);
  return null;
}

// ---------------------------------------------------------------------
// 채팅: { channel: 'public' | 'whisper', to, text }
//  - 탈락자는 무엇을 보내든 유령 채팅으로
// ---------------------------------------------------------------------
function chat(room, playerId, d = {}) {
  const p = room.players[playerId];
  if (!p) return '플레이어를 찾을 수 없습니다.';
  const text = String(d.text || '').trim().slice(0, 300);
  if (!text) return '내용이 비어 있습니다.';
  const msg = { from: p.id, name: p.name, text };
  const open = room.phase === PHASES.LOBBY || room.phase === PHASES.ENDED;

  if (!open && !p.alive) {
    pushMsg(room.chat.ghost, msg);
  } else if (!open && d.channel === 'whisper') {
    const t = room.players[d.to];
    if (!t || !t.alive || t.id === p.id) return '귓속말 상대가 올바르지 않습니다.';
    const key = S.whisperKey(p.id, t.id);
    pushMsg((room.chat.whispers[key] ||= []), { ...msg, to: t.id, day: room.day });
    (room.turn.whisperLog[p.id] ||= new Set()).add(t.id);   // 나중에 '도청' 카드용
  } else {
    pushMsg(room.chat.public, msg);
  }
  hooks.broadcast(room);
  return null;
}

module.exports = {
  init, startGame, handleAction, chat, stopRoom, checkWinner, updateSettings, resetRoom,
  // 테스트용으로 노출
  resolveNight, enterMorning, enterVote, resolveVote, enterShop, resolveShop,
};
