// 테스트 봇: 이미 만든 방에 봇 N명을 넣어서 같이 플레이한다
//   사용법 (프로젝트 폴더에서):  node tools/bots.js <서버 주소> <방 코드> [봇 수]
//   예)  node tools/bots.js https://arbiter-0c0x.onrender.com KFWF 5
//   게임 시작은 방장(사람)이 누른다. 끝내려면 Ctrl + C
const { io } = require('socket.io-client');

const URL = process.argv[2] || 'http://localhost:3000';
const CODE = String(process.argv[3] || '').toUpperCase();
const N = Math.max(1, Math.min(11, Number(process.argv[4]) || 5));
if (!CODE) { console.log('사용법: node tools/bots.js <서버 주소> <방 코드> [봇 수]'); process.exit(1); }

const NAMES = ['봇알파', '봇브라보', '봇찰리', '봇델타', '봇에코', '봇폭스', '봇골프', '봇호텔', '봇인디고', '봇줄리엣', '봇킬로'];
const LINES = ['나 믿어도 돼', '오늘 송금 서로 할 사람?', '누가 어제 공격했지…', '난 그냥 돈 벌 거야', '조용히 있자', '저 사람 수상한데', '보조금 나 줘', 'ㅋㅋ', '오늘 밤 조심해'];
const COS = ['helios', 'blackice', 'redline', 'neoncast', 'orion'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const wait = (min, max) => new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
const run = Date.now().toString(36);

function makeBot(i) {
  const bot = { name: NAMES[i % NAMES.length], id: `bot${run}${i}`, st: null, key: '' };
  const s = io(URL, { transports: ['websocket'] });
  bot.s = s;
  const emit = (ev, data) => new Promise((r) => s.emit(ev, data, (res) => r(res || {})));
  bot.emit = emit;
  bot.act = (type, data) => emit('action', { type, data });
  // 처음 접속 + 끊겼다 다시 붙을 때마다 방에 (다시) 들어간다
  s.on('connect', async () => {
    const res = await emit('room:join', { code: CODE, name: bot.name, playerId: bot.id });
    console.log(res.ok ? `✔ ${bot.name} 입장` : `✖ ${bot.name} 입장 실패: ${res.error}`);
  });
  s.on('disconnect', () => console.log(`… ${bot.name} 연결 끊김 (자동 재접속 시도)`));
  s.on('state', (st) => { bot.st = st; onState(bot).catch((e) => console.log(bot.name, '오류', e.message)); });
  return bot;
}

async function onState(bot) {
  const st = bot.st;
  const key = `${st.code}|${st.phase}|${st.day}`;
  if (key === bot.key) return;            // 페이즈가 바뀔 때만 한 번 행동
  bot.key = key;
  if (st.phase === 'ended') { await wait(1000, 3000); bot.emit('chat', { channel: 'public', text: pick(['gg', '수고했어', '한 판 더?']) }); return; }
  if (!st.me || !st.me.alive) return;
  const others = st.players.filter((p) => p.alive && p.id !== bot.id);
  const ready = () => bot.act('ready', { value: true, phase: st.phase });

  if (st.phase === 'discuss') {
    await wait(2000, 6000);
    if (Math.random() < 0.6) bot.emit('chat', { channel: 'public', text: pick(LINES) });
    await wait(2000, 6000);
    ready();
  }

  if (st.phase === 'vote') {
    await wait(2000, 7000);
    if (st.topicInfo && st.topicInfo.yesno) {
      bot.act('vote', { choice: Math.random() < 0.55 ? 'yes' : 'no' });
    } else {
      const ok = st.players.filter((p) => p.alive && p.id !== st.voteBannedId);
      if (ok.length) bot.act('vote', { targetId: (Math.random() < 0.3 ? ok.find((p) => p.id === bot.id) : null)?.id || pick(ok).id });
    }
  }

  if (st.phase === 'shop') {
    await wait(1500, 4000);
    // 손패 한도 넘으면 무료 카드부터 정리
    let hand = st.me.hand.slice();
    while (hand.length > st.me.handLimit) {
      const c = hand.find((x) => x.uid === st.me.freeCard) || hand[0];
      await bot.act(c.sellPrice > 0 ? 'sellCard' : 'discardCard', { cardUid: c.uid });
      hand = hand.filter((x) => x.uid !== c.uid);
    }
    if (Math.random() < 0.5 && st.auction.length) {
      const slot = pick(st.auction);
      await bot.act('bid', { slotId: slot.id, amount: (st.auctionMinBid || 300) + 100 * Math.floor(Math.random() * 6) });
    }
    if (Math.random() < 0.3 && hand.length < st.me.handLimit) await bot.act('buyRandom');
    await wait(1000, 4000);
    ready();
  }

  if (st.phase === 'day') {
    await wait(3000, 8000);
    if (Math.random() < 0.5) bot.emit('chat', { channel: 'public', text: pick(LINES) });
    if (others.length && Math.random() < 0.5) bot.emit('chat', { channel: 'whisper', to: pick(others).id, text: pick(LINES) });
    let hand = st.me.hand.slice();
    while (hand.length > st.me.handLimit) {      // 한도 초과면 정리해야 카드를 쓸 수 있음
      const c = hand[0];
      await bot.act(c.sellPrice > 0 ? 'sellCard' : 'discardCard', { cardUid: c.uid });
      hand = hand.slice(1);
    }
    // 카드: 한도 - 1 (회사 카드 몫)까지
    const cap = Math.max(0, (st.maxCardsPerDay || 2) - 1);
    for (const c of hand.slice().sort(() => Math.random() - 0.5).slice(0, cap)) {
      const ab = pick(c.abilities.filter((a) => !a.minDay || st.day >= a.minDay).length ? c.abilities.filter((a) => !a.minDay || st.day >= a.minDay) : c.abilities);
      const target = ab.target === 'self' ? bot.id : ab.target === 'other' ? (others.length ? pick(others).id : bot.id) : (Math.random() < 0.5 ? bot.id : (others.length ? pick(others).id : bot.id));
      await bot.act('reserveCard', { cardUid: c.uid, ability: ab.key, targetId: target, fakeCompany: pick(COS) });
      await wait(300, 900);
    }
    // 회사 카드: 자원 / 송금 / 특수능력
    const r = Math.random();
    const info = st.companyInfo && st.companyInfo[st.me.company];
    if (r < 0.4 || !others.length) await bot.act('setCompany', { type: 'resource' });
    else if (r < 0.8) await bot.act('setCompany', { type: 'transfer', targetId: pick(others).id });
    else if (info) {
      const t = info.target === 'self' ? bot.id : info.target === 'other' ? pick(others).id : pick([bot.id, pick(others).id]);
      const res = await bot.act('setCompany', { type: 'special', targetId: t, fakeKind: pick(['attack', 'defend', 'money', 'intel']) });
      if (!res.ok) await bot.act('setCompany', { type: 'resource' });
    }
    await wait(2000, 6000);
    ready();
  }
}

console.log(`봇 ${N}명 → ${URL} 방 ${CODE}`);
(async () => {
  for (let i = 0; i < N; i++) { makeBot(i); await wait(300, 600); }
})();
process.on('SIGINT', () => { console.log('\n봇 종료'); process.exit(0); });
