// =====================================================================
//  아비터 — 클라이언트
//  서버가 보내주는 'state'(내 시야) 를 받아서 화면을 다시 그린다.
//  클라이언트는 아무것도 "결정"하지 않는다. 버튼은 서버에 요청만 보낸다.
// =====================================================================
const socket = io();
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = (n) => Number(n || 0).toLocaleString('ko-KR');

// 탭마다 다른 ID → 한 PC에서 탭 여러 개로 혼자 테스트 가능 (sessionStorage 는 탭별, 새로고침해도 유지)
function getMyId() {
  let id = sessionStorage.getItem('arbiter:id');
  if (!id) {
    id = 'p' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem('arbiter:id', id);
  }
  return id;
}
const myId = getMyId();

// 사망 표시: 해골 아이콘
const SKULL = '<svg class="skull" viewBox="0 0 64 64" aria-label="사망"><path fill="currentColor" d="M32 4C17.6 4 7 14.2 7 28c0 7.6 3.4 13.3 8 16.8V53a4 4 0 0 0 4 4h4v-6h4v6h10v-6h4v6h4a4 4 0 0 0 4-4v-8.2c4.6-3.5 8-9.2 8-16.8C57 14.2 46.4 4 32 4Zm-11 34a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm22 0a7 7 0 1 1 0-14 7 7 0 0 1 0 14ZM32 41l-4 7h8l-4-7Z"/></svg>';
const PHASE_LABEL = { lobby: '대기', morning: '아침', discuss: '토의', vote: '투표', voteResult: '개표', shop: '암시장', day: '낮', night: '밤', ended: '종료' };
const FAM_ICON = { force: ic('force'), intel: ic('intel'), deceit: ic('deceit'), ops: ic('ops'), politics: ic('politics') };
const CO_ICON = { helios: 'defend', blackice: 'snoop', redline: 'attack', neoncast: 'news', orion: 'shortSell' };
const FAMILY_LABEL = { force: '무력', intel: '정보', deceit: '기만', ops: '공작', politics: '정치' };
const CO_SHORT = { helios: '헬리오스', blackice: '블랙아이스', redline: '레드라인', neoncast: '네온캐스트', orion: '오리온' };
const CO_MARK = { helios: 'H', blackice: 'B', redline: 'R', neoncast: 'N', orion: 'O' };
// 회사 로고 이미지 (public/img/co/*.png, 배경 투명)
const coLogo = (c, cls = '') => c && CO_MARK[c] ? `<img class="co-img ${cls}" src="img/co/${c}.png" alt="${CO_MARK[c]}" draggable="false">` : '';
const COMPANY_FULL = { helios: '헬리오스 인더스트리', blackice: '블랙아이스 시큐리티', redline: '레드라인 PMC', neoncast: '네온캐스트 미디어', orion: '오리온 파이낸셜' };
const companyShort = (c) => CO_SHORT[c] || c;

// ---- 화면 전용 상태 (서버와 무관) ----
let S = null;              // 서버가 준 내 시야
let prevPhase = null;
let newsOpen = false;   // 네온캐스트 특수능력: 뉴스 입력칸 열림
let pick = null;           // 대상 고르는 중: { kind:'card', card, ability, usePierce } | { kind:'transfer' }
let transferTarget = null;  // 회사 카드를 끌어다 놓은 송금 대상
let newsOpenDay = null;    // 낮/투표 중 뉴스 상자를 다시 연 날
let popupMode = null;      // 'ability' | 'company' | null
let abilityCard = null;
let forgeryAbility = null;
let dropTarget = null;     // 드래그로 놓은 대상 (능력 선택 창이 뜬 동안 기억)
let drag = null;           // 드래그 중: { kind:'card', card, x0, y0, active, ghost } | { kind:'chip', uid, ... }
let drawerOpen = false;   // (예전 서랍 — 지금은 수첩 탭을 쓴다)
let seenNotes = 0;
let nbFilter = 'all';      // 수첩 필터: all | out | in | intel
const seenWhisper = {};    // { 상대ID: 내가 본 메시지 수 }
let hideSys = false;       // 공개 채팅에서 아비터 방송 숨기기
let armed = { key: null, until: 0 };   // 2단계 확인 버튼
let newsClosedDay = null;  // 아침 뉴스 상자를 닫은 날
let nightReplay = null;    // { day, start } 밤 장면 다시 보기
const nightArchive = {};   // { day: [{title, sub, kind}] } 지난 밤 요약 보관
let archiveOpen = null;    // 수첩에서 연 지난 밤 요약 day
let lastVoteShown = null;
let revealShown = null;
let centerClosedKey = null;
let chatTab = 'public';
let whisperTo = '';
const bidDrafts = {};      // 입찰칸에 쓰다 만 숫자 (다시 그려도 안 지워지게)
let knownHand = new Set(); // 새로 들어온 카드 뒤집기 연출용
let shopResultUntil = 0;   // 구매 턴 끝난 뒤 낙찰 결과를 잠깐 보여주는 시간
let lastAuction = [];

// ---------------------------------------------------------------------
// 소켓
// ---------------------------------------------------------------------
socket.on('connect', () => {
  const code = sessionStorage.getItem('arbiter:room');
  const name = sessionStorage.getItem('arbiter:name');
  if (code) {
    socket.emit('room:join', { code, name, playerId: myId, avatar: myAvatar() }, (res) => {
      if (!res.ok) { sessionStorage.removeItem('arbiter:room'); S = null; render(); }
    });
  }
});
socket.on('state', (s) => {
  const before = S;
  S = s;
  // 게임이 끝나면 보고서용으로 그 순간 상태를 따로 보관 (방이 대기실로 돌아가도 각자 버튼을 누를 때까지 유지)
  if (s.phase === 'ended' && s.winner && (!endSnap || endSnap.code !== s.code || endSnap.day !== s.day || !endSnap.winner)) {
    endSnap = JSON.parse(JSON.stringify(s));
    endView.day = 'all';
  }
  // 구매 턴 → 낮으로 넘어가는 순간: 낙찰 결과 4초 보여주기
  if (before && before.phase === 'shop' && s.phase !== 'shop' && s.auction.some((a) => a.sold)) {
    shopResultUntil = Date.now() + 4000;
    lastAuction = s.auction;
    setTimeout(render, 4100);
  }
  if (s.phase !== prevPhase) {
    pick = null; popupMode = null; prevPhase = s.phase; archiveOpen = null; transferTarget = null;
    if (s.phase !== 'night') nightReplay = null;
  }
  // 새 귓속말 알림 (지금 그 대화를 보고 있지 않을 때)
  if (before && before.chat && s.chat && s.phase !== 'lobby' && s.me && s.me.alive) {
    for (const [key, list] of Object.entries(s.chat.whispers)) {
      const prevLen = (before.chat.whispers[key] || []).length;
      const fresh = list.slice(prevLen).filter((m) => m.from !== myId);
      const viewing = chatTab === 'whisper' && key === [myId, whisperTo].sort().join('|');
      if (fresh.length && !viewing) toast(`💬 ${fresh[fresh.length - 1].name}`, 'whisper');
    }
  }
  // 페이즈 전환 배너 (밤은 자체 연출이 있으므로 제외)
  const phaseChanged = before && before.phase !== s.phase && s.me && s.me.alive;
  if (phaseChanged && PHASE_FLASH[s.phase]) { flash(PHASE_FLASH[s.phase](s), s.phase === 'discuss' ? 4200 : 2600, 'phase'); Sound.sfx('phase'); }
  if (before && before.phase !== s.phase) phaseSweep(s.phase, before.phase);
  // 암시장 시작: 오늘의 무료 카드
  if (before && before.phase !== 'shop' && s.phase === 'shop' && s.me && s.me.freeCard) {
    const fc = s.me.hand.find((c) => c.uid === s.me.freeCard);
    if (fc) setTimeout(() => { flash(`<div class="fl-big">${ic('gift')} 무료 카드</div><div class="fl-sub">${FAM_ICON[fc.family]} ${esc(fc.name)} ${'★'.repeat(fc.tier)}</div>`, 2600, 'phase'); Sound.sfx('flip'); }, 2700);
  }
  // 내 돈 변화: 금액이 떠오르고, 이유를 붙인다
  if (before && before.me && s.me && before.code === s.code && s.phase !== 'lobby' && before.phase !== 'lobby') {
    const d = s.me.credits - before.me.credits;
    const reason = before.phase === 'night' && s.phase === 'morning' ? 'night'
      : before.phase === 'vote' && s.phase !== 'vote' ? 'vote'
      : before.phase === 'shop' && s.phase !== 'shop' ? 'shop' : '';
    if (d && !(s.phase === 'day' && before.phase === 'day')) moneyPop(d, reason);
    if (s.me.hp < before.me.hp && s.phase !== 'night') hpPop(s.me.hp - before.me.hp);
  }
  // 투표 결과 배너
  if (s.lastVote && s.lastVote.day === s.day && lastVoteShown !== `${s.code}-${s.day}` && s.phase !== 'lobby') {
    lastVoteShown = `${s.code}-${s.day}`;
    const lv = s.lastVote;
    const nm = (s.players.find((p) => p.id === lv.winnerId) || {}).name;
    // 득표 막대 → 동전 이동 연출이 끝날 즈음 결과 배너
    const got = lv.pot - (lv.cut || 0);
    const topic = lv.topic || 'subsidy';
    const fail = lv.noMajority ? '과반 미달 — 무효' : lv.tie ? '동률 — 무효' : '투표 없음 — 무효';
    const msg = topic === 'subsidy' ? (lv.winnerId ? `<div class="fl-big">₵${won(got)} → <b>${esc(nm)}</b></div>${lv.cut ? `<div class="fl-sub">브로커 커미션 ₵${won(lv.cut)} 빠짐${lv.myCut ? ` · <b class="tone-money">내 몫 +₵${won(lv.myCut)}</b>` : ''}</div>` : ''}` : '<div class="fl-big">동률 — 아무도 못 받음</div>')
      : topic === 'damage' ? (lv.winnerId ? `<div class="fl-big">${ic('attack')} <b>${esc(nm)}</b> ${lv.result === 'armor' ? '◈ −1' : '♥ −1'}${lv.died ? ' · 사망' : ''}</div>` : `<div class="fl-big">${fail}</div>`)
      : topic === 'fine' ? (lv.winnerId ? `<div class="fl-big"><b>${esc(nm)}</b> 벌금 −₵${won(lv.amount || 0)}</div><div class="fl-sub">다음 보조금에 적립</div>` : `<div class="fl-big">${fail}</div>`)
      : topic === 'cards' ? (lv.winnerId ? `<div class="fl-big">${ic('card')} 카드 ${lv.count || 3}장 → <b>${esc(nm)}</b></div>` : `<div class="fl-big">${fail}</div>`)
      : topic === 'revealTop' ? (lv.passed ? `<div class="fl-sub">자본 1위</div><div class="fl-big">${(lv.revealed || []).map((x) => `<b>${esc(nameOf(x.id))}</b> ₵${won(x.credits)}`).join(' · ')}</div>` : '<div class="fl-big">부결</div>')
      : topic === 'equalize' ? (lv.passed ? `<div class="fl-big">${ic('tieBreak')} 전원 ₵${won(lv.each || 0)}</div>` : '<div class="fl-big">부결</div>') : '';
    const showFlash = () => flash(msg, 3000, 'vote');
    if (s.phase === 'voteResult') { setTimeout(() => playVoteFx(lv), 50); setTimeout(showFlash, 2900); } else showFlash();
  }
  render();
});
socket.on('notice', (n) => { if (n.kind === 'death') toast(n.text, n.kind); else Sound.sfx('notify'); });   // 결과는 화면 태그·수첩으로 (글자 알림 최소화)

function send(event, payload, quiet = false) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (res) => {
      if (res && !res.ok && res.error && !quiet) toast(res.error, 'error');
      resolve(res || {});
    });
  });
}
const act = (type, data) => send('action', { type, data }, ['reserveCard', 'setCompany'].includes(type));   // 예약 실패는 자리 위 ✕ 로 표시

// 카드 예약 + 확인 토스트
async function reserve(card, abilityKey, targetId, extra = {}) {
  const res = await act('reserveCard', { cardUid: card.uid, ability: abilityKey, targetId, ...extra });
  if (res.ok) {
    const ab = card.abilities.find((a) => a.key === abilityKey);
    const tname = targetId === myId ? '나' : nameOf(targetId);
    const pierce = extra.usePierce ? ' + 레드라인 관통' : '';
    Sound.sfx('lock');
    if (targetId === myId) selfFx(FAM_ICON[card.family], FAM_COLOR[card.family], card.name);
    else stampAt(targetId, card.name, FAM_COLOR[card.family]);
  } else failAt(targetId, res.error);
  return res;
}
// 예약 확정 도장: 대상 자리 위에 "LOCKED" 가 쾅 찍힌다
const FAM_COLOR = { force: '#FF3B4E', intel: '#5CE1FF', deceit: '#B98CFF', ops: '#FFB627', politics: '#6CFFA8' };
function stampAt(targetId, label, color) {
  const el = targetId === myId ? $('#meSeat') : document.querySelector(`.seat[data-id="${targetId}"]`);
  if (!el) return;
  const r = el.getBoundingClientRect();
  const st = document.createElement('div');
  st.className = 'lock-stamp';
  st.style.left = (r.left + r.width / 2) + 'px';
  st.style.top = (r.top + Math.min(r.height / 2, 50)) + 'px';
  if (color) st.style.setProperty('--c', color);
  st.innerHTML = `LOCKED<small>${String(label).startsWith('<svg') ? label : esc(label)}</small>`;
  document.body.appendChild(st);
  setTimeout(() => st.remove(), 1600);
}
// 나에게 쓴 카드·투표: 내 자리에서 고리가 터지고 아이콘이 크게 솟는다
function selfFx(icon, color = '#3DF5E0', label = '') {
  const el = $('#meSeat'); if (!el) return;
  const r = el.getBoundingClientRect();
  const fx = document.createElement('div');
  fx.className = 'self-fx';
  fx.style.left = (r.left + r.width / 2) + 'px';
  fx.style.top = (r.top + 46) + 'px';
  fx.style.setProperty('--c', color);
  fx.innerHTML = `<i class="sf-ring"></i><i class="sf-ring r2"></i><b class="sf-icon">${icon}</b>${label ? `<small>${esc(label)}</small>` : ''}`;
  document.body.appendChild(fx);
  el.classList.remove('self-pulse'); void el.offsetWidth; el.classList.add('self-pulse');
  Sound.sfx('lock');
  setTimeout(() => fx.remove(), 1500);
}
// 예약 실패: 대상 자리에 빨간 ✕ + 이유 (카드는 손패로 돌아감)
function failAt(targetId, why) {
  const el = targetId === myId ? $('#meSeat') : document.querySelector(`.seat[data-id="${targetId}"]`);
  if (!el) return;
  const r = el.getBoundingClientRect();
  const st = document.createElement('div');
  st.className = 'fail-stamp';
  st.style.left = (r.left + r.width / 2) + 'px';
  st.style.top = (r.top + Math.min(r.height / 2, 50)) + 'px';
  st.innerHTML = `${ic('x')}<small>${esc(why || '실패')}</small>`;
  document.body.appendChild(st);
  Sound.sfx('error');
  setTimeout(() => st.remove(), 2200);
}
async function cancelReserve(cardUid) {
  const res = await act('cancelCard', { cardUid });
  if (res.ok) Sound.sfx('cancel');
  return res;
}

// 되돌릴 수 없는 행동은 두 번 눌러야 실행 (첫 클릭: "한 번 더 눌러 확인")
const isArmed = (key) => armed.key === key && Date.now() < armed.until;
function confirmThen(key, fn) {
  if (isArmed(key)) { armed = { key: null, until: 0 }; fn(); return; }
  armed = { key, until: Date.now() + 6000 };
  render();
  setTimeout(render, 6100);
}

// 화면 가운데 위에 잠깐 뜨는 배너
let flashTimer = null;
const PHASE_FLASH = {
  morning: (s) => `<div class="fl-big">${ic('day')} ${s.day}일차</div>`,
  discuss: (s) => `<div class="fl-sub">${s.day}일차 · 이번 회의 주제는…</div><div class="fl-big">${ic((TOPIC[s.topic] || TOPIC.subsidy).icon)} ${esc(s.topicInfo ? s.topicInfo.label : '지원금')}</div><div class="fl-sub">${s.topicInfo && s.topicInfo.yesno ? '찬성 / 반대 표를 던져주세요' : '누구에게 투표할지 토의하세요'}</div>`,
  vote: () => `<div class="fl-big">${ic('vote')} 투표</div>`,
  shop: () => `<div class="fl-big">${ic('shop')} 암시장</div>`,
  day: () => `<div class="fl-big">${ic('day')} 낮</div>`,
};
function moneyPop(d, reason) {
  Sound.sfx(d > 0 ? 'coinUp' : 'coinDown');
  const el = document.createElement('div');
  el.className = `money-pop ${d > 0 ? 'up' : 'down'}`;
  el.innerHTML = `${d > 0 ? '+' : '−'}₵${won(Math.abs(d))}${reason ? `<small>${ic(reason)}</small>` : ''}`;
  $('#wallet').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}
function hpPop(d) {
  const el = document.createElement('div');
  el.className = 'hp-pop';
  el.textContent = `체력 ${d}`;
  $('#meSeat').appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
function flash(html, ms = 3200, kind = '') {
  eyeSpeak();
  const f = $('#flash');
  f.className = `flash fl-${kind}`;
  f.innerHTML = html;
  f.classList.remove('hidden');
  f.style.animation = 'none'; void f.offsetWidth; f.style.animation = '';
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => f.classList.add('hidden'), ms);
}

// ---------------------------------------------------------------------
// 입장 / 로비
// ---------------------------------------------------------------------
$('#nameInput').value = sessionStorage.getItem('arbiter:name') || '';

async function enter(event, code) {
  const name = $('#nameInput').value.trim();
  if (!name) { $('#entryError').textContent = '이름을 입력하세요.'; return; }
  const res = await send(event, { name, code, playerId: myId, avatar: myAvatar(name) });
  if (res.ok) {
    sessionStorage.setItem('arbiter:name', name);
    sessionStorage.setItem('arbiter:room', res.code);
    $('#entryError').textContent = '';
  } else {
    $('#entryError').textContent = res.error;
  }
}
$('#btnCreate').onclick = () => enter('room:create');
$('#btnJoin').onclick = () => enter('room:join', $('#codeInput').value);
$('#codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnJoin').click(); });
$('#btnStart').onclick = () => send('game:start');
$('#btnLeave').onclick = async () => {
  await send('room:leave');
  sessionStorage.removeItem('arbiter:room');
  S = null;
  render();
};

function renderLobby() {
  document.body.dataset.co = '';
  if (!renderLobby.artChecked) { renderLobby.artChecked = true; loadCardArt(); }
  $('#lobbyCode').textContent = S.code;
  $('#lobbyCount').textContent = `(${S.players.length}/${S.maxPlayers}명, 최소 ${S.minPlayers}명)`;
  $('#lobbyPlayers').innerHTML = S.players.map((p) => `
    <li class="${p.connected ? '' : 'off'} ${p.id === myId ? 'me' : ''}"><span class="lp-ava">${Avatar.svg(Avatar.of(p))}</span>
      <span>${p.id === S.hostId ? '<span title="방장">👑</span> ' : ''}${esc(p.name)}
      ${p.id === myId ? '<span class="tag">나</span>' : ''}
      ${!p.connected ? '<span class="tag">연결 끊김</span>' : ''}</span></li>`).join('');
  renderAvatarEditor();
  const enough = S.players.length >= S.minPlayers;
  $('#btnStart').classList.toggle('hidden', !S.isHost);
  $('#btnStart').disabled = !enough;
  $('#lobbyHint').textContent = S.isHost
    ? (enough ? '준비되면 시작하세요.' : `${S.minPlayers - S.players.length}명 더 필요합니다.`)
    : '방장이 시작하기를 기다리는 중...';
  renderLobbySettings();
}

// ---------------------------------------------------------------------
// 요원 외형 (대기실에서 꾸미기) — 이 브라우저에 저장, 방에 들어갈 때 서버로 보냄
// ---------------------------------------------------------------------
const AV_KEY = 'arbiter:avatar';
function myAvatar(name) {
  try { const v = JSON.parse(localStorage.getItem(AV_KEY) || 'null'); if (Avatar.valid(v)) return v; } catch {}
  return Avatar.fromName(name || sessionStorage.getItem('arbiter:name') || $('#nameInput').value || '?');
}
let avSendTimer = null;
function setMyAvatar(av) {
  try { localStorage.setItem(AV_KEY, JSON.stringify(av)); } catch {}
  renderAvatarEditor(av);
  clearTimeout(avSendTimer);
  avSendTimer = setTimeout(() => send('room:avatar', av), 150);
}
// 요원 신분증 카드 한 장 (게임 자리 + 대기실 미리보기 공용)
function idCardHtml({ name, avatar, barLeft, flags = '', hp, armor = 0, led = true }) {
  const max = (S && S.startHp) || 3;
  const segs = Array.from({ length: max }, (_, i) => `<i class="${i < hp ? '' : 'e'}"></i>`).join('')
    + (armor > 0 ? '<i class="ar" title="유사체력"></i>'.repeat(armor) : '');
  return `<div class="seat-card">
    <div class="seat-bar"><span class="seat-id">${barLeft}</span><span class="seat-flags">${flags}<i class="led ${led ? 'on' : 'off'}"></i></span></div>
    <div class="seat-ava">${Avatar.svg(avatar)}</div>
    <div class="seat-name">${esc(name)}</div>
    <div class="seat-hpbar">${segs}</div>
  </div>`;
}
const AV_LABEL = { hat: '모자', eyes: '눈', mouth: '입', neck: '목', body: '몸 색', accent: '빛 색' };
function renderAvatarEditor(avIn) {
  const box = $('#avatarEditor');
  if (!box || !S || S.phase !== 'lobby') return;
  const me = S.players.find((p) => p.id === myId);
  const av = avIn || (me && Avatar.valid(me.avatar) ? me.avatar : myAvatar());
  const seatNo = String(S.players.findIndex((p) => p.id === myId) + 1).padStart(2, '0');
  const partRow = (k) => `<div class="ae-row"><span class="ae-k">${AV_LABEL[k]}</span>
      <button class="ae-arrow" data-k="${k}" data-d="-1" aria-label="이전">◀</button>
      <b class="ae-v">${Avatar.PARTS[k][av[k]]}</b>
      <button class="ae-arrow" data-k="${k}" data-d="1" aria-label="다음">▶</button></div>`;
  const colorRow = (k) => `<div class="ae-row"><span class="ae-k">${AV_LABEL[k]}</span><div class="ae-swatches">
      ${Avatar.COLORS.map((c, i) => `<button class="ae-sw ${av[k] === i ? 'on' : ''}" data-k="${k}" data-v="${i}" title="${c.n}"
        style="--sw:hsl(${c.h} ${c.s}% 60%)"></button>`).join('')}</div></div>`;
  box.innerHTML = `<h3>요원 외형</h3>
    <div class="ae-preview">${idCardHtml({ name: S.me ? S.me.name : '나', avatar: av, barLeft: `AGENT-${seatNo}`, hp: (S.startHp || 3) })}</div>
    ${['hat', 'eyes', 'mouth', 'neck'].map(partRow).join('')}
    ${['body', 'accent'].map(colorRow).join('')}
    <div class="ae-actions"><button id="aeRandom">🎲 무작위</button><button id="aeReset" class="ghost-btn">이름으로 되돌리기</button></div>
`;
  box.querySelectorAll('.ae-arrow').forEach((b) => { b.onclick = () => {
    const k = b.dataset.k; const n = Avatar.LIMITS[k];
    setMyAvatar({ ...av, [k]: (av[k] + Number(b.dataset.d) + n) % n });
  }; });
  box.querySelectorAll('.ae-sw').forEach((b) => { b.onclick = () => setMyAvatar({ ...av, [b.dataset.k]: Number(b.dataset.v) }); });
  $('#aeRandom').onclick = () => setMyAvatar(Avatar.random());
  $('#aeReset').onclick = () => { try { localStorage.removeItem(AV_KEY); } catch {} setMyAvatar(Avatar.fromName(S.me ? S.me.name : '?')); try { localStorage.removeItem(AV_KEY); } catch {} };
}

const SETTING_LABEL = {
  maxDays: ['심사 기간', (v) => `${v}일`],
  morning: ['아침 뉴스', (v) => `${v}초`],
  discuss: ['아침 토의', (v) => (v < 60 ? `${v}초` : v % 60 ? `${Math.floor(v / 60)}분 ${v % 60}초` : `${v / 60}분`)],
  vote: ['지원금 투표', (v) => `${v}초`],
  shop: ['암시장', (v) => `${v}초`],
  day: ['낮 (협상·예약)', (v) => (v % 60 ? `${Math.floor(v / 60)}분 ${v % 60}초` : `${v / 60}분`)],
};
function renderLobbySettings() {
  const box = $('#lobbySettings');
  // 방장이 고르는 중에 다시 그려서 드롭다운이 닫히지 않도록, 값만 바뀌었으면 값만 갱신
  const sig = JSON.stringify([S.isHost, S.settings]);
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  box.innerHTML = `<h3>게임 설정 ${S.isHost ? '<span class="muted small">방장만 바꿀 수 있어요</span>' : ''}</h3>
    <div class="set-grid">${Object.keys(SETTING_LABEL).map((k) => {
      const [label, fmt] = SETTING_LABEL[k];
      const v = S.settings[k];
      return `<label>${label}${S.isHost
        ? `<select data-k="${k}">${S.settingOptions[k].map((o) => `<option value="${o}" ${o === v ? 'selected' : ''}>${fmt(o)}</option>`).join('')}</select>`
        : `<b>${fmt(v)}</b>`}</label>`;
    }).join('')}</div>
`;
  box.querySelectorAll('select').forEach((sel) => {
    sel.onchange = () => send('room:settings', { key: sel.dataset.k, value: Number(sel.value) });
  });
}

// 위쪽 정보 줄 오른쪽: 회사 5종. 참가 여부는 비밀 — 내가 알아낸 만큼만 표시
//   ✔ 참가 확인 (내 소속 · 죽은 사람 · 폭로된 사람)  ✕ 불참 확인 (정보로 알아냄)  나머지 = ?
function renderCoBar() {
  let bar = $('#coBar');
  const home = $('#game');
  if (!bar) { bar = document.createElement('div'); bar.id = 'coBar'; }
  if (bar.parentElement !== home) home.appendChild(bar);
  const present = new Set([S.me.company, ...S.players.filter((p) => p.company && (!p.alive || p.exposed)).map((p) => p.company)]);
  if (S.activeCompanies) S.activeCompanies.forEach((c) => present.add(c));
  const absent = new Set(S.activeCompanies ? Object.keys(CO_SHORT).filter((c) => !S.activeCompanies.includes(c)) : (S.knownAbsent || []));
  const sig = [...present].sort().join(',') + '|' + [...absent].sort().join(',') + (S.companyInfo ? 1 : 0);
  if (bar.dataset.sig === sig) return;
  bar.dataset.sig = sig;
  bar.innerHTML = Object.keys(CO_SHORT).map((c) => {
    const ci = coInfo(c);
    const st = absent.has(c) ? 'off' : present.has(c) ? 'on' : 'unk';
    return `<div class="cob ${st}" style="--cc:${TAG_COLOR[c]}">${coLogo(c)}<i class="cob-mark">${st === 'off' ? ic('x') : st === 'on' ? ic('ready') : '?'}</i>
      <div class="cob-tip"><b>${esc(COMPANY_FULL[c])}</b>${ci.icon} ${esc(ci.special)}<br><span class="muted">${st === 'off' ? '이번 판 불참' : st === 'on' ? '참가 확인' : '참가 여부 모름'}</span></div></div>`;
  }).join('');
}

// 토의·투표 중: 화면 위에 오늘의 주제를 크게. 지원금이면 유리 저금통 (오징어게임처럼 목표를 눈으로)
function renderPot() {
  let el = $('#potBig');
  if (!el) { el = document.createElement('div'); el.id = 'potBig'; $('#stage').appendChild(el); }
  const show = ['discuss', 'vote'].includes(S.phase) && !!S.topic;
  el.classList.toggle('hidden', !show);
  if (!show) { el.dataset.sig = ''; renderYesNo(); return; }
  const sig = `${S.topic}|${S.votePot}`;
  if (el.dataset.sig !== sig) {
    el.dataset.sig = sig;
    const tp = TOPIC[S.topic] || TOPIC.subsidy;
    if (S.topic === 'subsidy') {
      const fill = Math.min(1, S.votePot / 8000);
      const coins = Math.round(6 + fill * 22);
      el.className = 'pot-subsidy';
      el.innerHTML = `<div class="pot-glass"><div class="pot-fill" style="height:${18 + fill * 70}%">${Array.from({ length: coins }, (_, i) => `<i style="left:${(i * 37) % 92}%;bottom:${Math.floor(i / 6) * 9}%;animation-delay:${i * 40}ms"></i>`).join('')}</div><i class="pot-shine"></i></div>
        <div class="pot-text"><small>오늘의 주제 · 지원금</small><b>₵${won(S.votePot)}</b></div>`;
    } else {
      el.className = `pot-topic t-${S.topic}`;
      el.innerHTML = `<div class="tp-icon">${ic(tp.icon)}</div><div class="pot-text"><small>오늘의 주제</small><b class="tp-title">${esc(S.topicInfo.label)}</b><span class="tp-desc">${esc(tp.desc())}</span></div>`;
    }
  }
  renderYesNo();
}
// 찬반 주제: 찬성 / 반대 버튼
function renderYesNo() {
  let el = $('#yesNo');
  if (!el) {
    el = document.createElement('div'); el.id = 'yesNo'; $('#stage').appendChild(el);
    el.onclick = (e) => {
      const b = e.target.closest('[data-yn]'); if (!b) return;
      act('vote', { choice: b.dataset.yn }).then((r) => { if (r.ok) { Sound.sfx('lock'); selfFx(ic(b.dataset.yn === 'yes' ? 'ready' : 'x'), b.dataset.yn === 'yes' ? '#6CFFA8' : '#FF4D6A'); } });
    };
  }
  const show = S.phase === 'vote' && isYesNo() && S.me.alive;
  el.classList.toggle('hidden', !show);
  if (!show) return;
  const mv = S.me.myVote;
  el.innerHTML = `<button data-yn="yes" class="yn-yes ${mv === 'yes' ? 'on' : ''}">${ic('ready')} 찬성</button><button data-yn="no" class="yn-no ${mv === 'no' ? 'on' : ''}">${ic('x')} 반대</button>`;
}

// ---------------------------------------------------------------------
// 전체 렌더
// ---------------------------------------------------------------------
function render() {
  const screen = !S ? 'entry' : S.phase === 'lobby' ? 'lobby' : 'game';
  for (const id of ['entry', 'lobby', 'game']) $('#' + id).classList.toggle('hidden', id !== screen);
  updateSound(screen);
  if (screen === 'entry') {
    $('#chatPanel').classList.add('hidden');
    $('#endOverlay').classList.add('hidden');
    return;
  }
  const slot = screen === 'lobby' ? $('#lobbyChatSlot') : $('#chatAside');
  if ($('#chatPanel').parentElement !== slot) slot.appendChild($('#chatPanel'));
  $('#chatPanel').classList.remove('hidden');
  renderChat();
  if (screen === 'lobby') { renderLobby(); return renderEndOnce(); }

  if (!S.me.alive) { pick = null; popupMode = null; }
  renderInfo();
  renderMoney();
  renderBanner();
  renderSeats();
  renderMe();
  renderNight();
  renderCenterBox();
  renderHud();
  renderCoBar();
  renderPot();
  updateAmbient();
  renderReveal();
  renderFan();
  renderPopup();
  renderShop();
  renderCleanup();
  renderEndOnce();
  tick();
  if (prevHandPhase === S.phase && S.me.hand.some((c) => !knownHand.has(c.uid))) Sound.sfx('flip');   // 같은 페이즈 안에서 새 카드가 들어옴 (구매 등)
  prevHandPhase = S.phase;
  knownHand = new Set(S.me.hand.map((c) => c.uid));
}
let prevHandPhase = null;

// ---------------------------------------------------------------------
// 소리: 장면별 배경음악 + 볼륨 조절 (audio.js)
// ---------------------------------------------------------------------
const endWon = () => !!(endSnap && endSnap.me && endSnap.winner && endSnap.winner.companyIds.includes(endSnap.me.company));
function updateSound(screen) {
  const endOpen = endSnap && !$('#endOverlay').classList.contains('hidden');
  const scene = (endOpen || (S && S.phase === 'ended')) ? (endWon() ? 'win' : 'lose')
    : screen === 'game' ? (S.phase === 'discuss' ? 'morning' : S.phase) : 'lobby';
  Sound.scene(scene);
  Sound.muffle(screen === 'game' && S.me && !S.me.alive && S.phase !== 'ended');
  // 볼륨 버튼: 게임 중엔 오른쪽 위 규칙 버튼 옆, 그 외엔 화면 오른쪽 위에 떠 있음
  const ctl = $('#soundCtl');
  const home = screen === 'game' ? $('.money-wrap') : document.body;
  if (ctl.parentElement !== home) home.insertBefore(ctl, home.firstChild);
  ctl.classList.toggle('floating', screen !== 'game');
}
function renderSoundCtl() {
  const st = Sound.settings;
  $('#soundBtn').textContent = st.muted ? '🔇' : '🔊';
  $('#volMusic').value = Math.round(st.music * 100);
  $('#volSfx').value = Math.round(st.sfx * 100);
  $('#soundMute').checked = st.muted;
}
$('#soundBtn').onclick = (e) => { e.stopPropagation(); $('#soundPanel').classList.toggle('hidden'); renderSoundCtl(); };
$('#volMusic').oninput = (e) => Sound.set('music', e.target.value / 100);
$('#volSfx').oninput = (e) => Sound.set('sfx', e.target.value / 100);
$('#volSfx').onchange = () => Sound.sfx('lock');
$('#soundMute').onchange = (e) => { Sound.set('muted', e.target.checked); renderSoundCtl(); };
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#soundCtl')) $('#soundPanel').classList.add('hidden'); });
renderSoundCtl();
// 버튼 누르는 소리 / 손패 카드에 마우스 올리는 소리
document.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) Sound.sfx('click'); }, true);
document.addEventListener('pointerover', (e) => {
  const c = e.target.closest('#fan .card, .slot, .seat.targetable');
  if (c && !c.contains(e.relatedTarget)) Sound.sfx('hover');
});

const nameOf = (id) => (S.players.find((p) => p.id === id) || {}).name || '???';
// 체력 ♥ + 유사체력 ◈ (체력 대신 먼저 깎이는 장갑)
const hearts = (hp, armor = 0) => '<span class="hp">' + '♥'.repeat(hp) + '<span class="empty">' + '♡'.repeat(Math.max(0, ((S && S.startHp) || 3) - hp)) + '</span>'
  + (armor > 0 ? `<span class="armor" title="유사체력: 체력이 깎일 때 대신 소모됩니다">${'◈'.repeat(armor)}</span>` : '') + '</span>';
const overLimit = () => S.me.hand.length > S.me.handLimit;
const canPlayCards = () => S.phase === 'day' && S.me.alive && !overLimit();

// ---------------------------------------------------------------------
// 왼쪽 위 정보 바 / 오른쪽 위 돈
// ---------------------------------------------------------------------
function renderInfo() {
  const m = S.me;
  const logo = $('#coLogo');
  logo.innerHTML = coLogo(m.company) || '?';
  logo.className = `co-logo co-${m.company}`;
  document.body.dataset.co = m.company || '';
  $('#infoText').innerHTML = `
    <span class="info-co co-${m.company}">${esc(m.companyName)}</span>
    <span>${S.day}일차 / ${S.maxDays}</span>
    <b class="ph-${S.phase}">${PHASE_LABEL[S.phase]}</b>
    <span>${(() => { const me = S.players.find((p) => p.id === myId); const sh = me ? shownState(me) : m; return sh.alive ? hearts(sh.hp, sh.armor) : '<span class="ph-vote">유령</span>'; })()}</span>
    <span class="muted small">📒 수첩</span>`;
  const unread = m.notebook.length - seenNotes;
  $('#nbBadge').textContent = unread;
  $('#nbBadge').classList.toggle('hidden', unread <= 0 || chatTab === 'notebook');
}
$('#infoBar').onclick = () => { chatTab = 'notebook'; renderChat(); renderInfo(); };

function renderMoney() {
  const m = S.me;
  $('#moneyBar').innerHTML = `<div class="w-label">CREDITS</div><div class="w-main">₵<span class="num" id="creditNum">${won(shownCredits ?? m.credits)}</span></div>
    <div class="w-sub">${m.pendingCredits ? `<span title="내일 아침에 들어올 돈">+${won(m.pendingCredits)} 내일</span>` : ''}${m.lockedCredits ? `<span title="송금·입찰로 묶인 돈">🔒${won(m.lockedCredits)}</span>` : ''}</div>`;
  countCredits(m.credits);
}
// 크래딧 숫자가 바로 바뀌지 않고 0.7초 동안 올라가거나 내려간다
let shownCredits = null; let creditAnim = null;
function countCredits(target) {
  if (shownCredits === null || shownCredits === target) { shownCredits = target; return; }
  const from = shownCredits; const t0 = performance.now(); const D = 700;
  cancelAnimationFrame(creditAnim);
  const step = (now) => {
    const k = Math.min(1, (now - t0) / D); const e = 1 - Math.pow(1 - k, 3);
    shownCredits = Math.round(from + (target - from) * e);
    const el = $('#creditNum'); if (el) el.textContent = won(shownCredits);
    if (k < 1) creditAnim = requestAnimationFrame(step);
  };
  creditAnim = requestAnimationFrame(step);
}


// ---------------------------------------------------------------------
// 위쪽 안내 띠
// ---------------------------------------------------------------------
function renderBanner() {
  const alive = S.players.filter((p) => p.alive);
  const readyN = alive.filter((p) => p.ready).length;
  let html = '';
  if (pick) {
    html = pick.kind === 'card'
      ? `<span class="pick">「${esc(pick.card.name)}」 → ${ic('target')}</span> <span class="muted">Esc</span>`
      : pick.kind === 'special' ? `<span class="pick">${coInfo(S.me.company).icon} → ${ic('target')}</span> <span class="muted">Esc</span>`
      : `<span class="pick">${ic('transfer')} → ${ic('target')}</span> <span class="muted">Esc</span>`;
  } else if (S.phase === 'morning') html = '';
  else if (S.phase === 'discuss') html = `${ic('discuss')} ${isYesNo() ? '찬성할지 반대할지' : '누구에게 투표할지'} 토의하세요 · 토의 끝 ${readyN}/${alive.length}`;
  else if (S.phase === 'vote') {
    const mv = S.me.myVote;
    html = isYesNo()
      ? `${ic('vote')} ${mv ? `<b>${mv === 'yes' ? '찬성' : '반대'}</b>에 투표함 · 바꿀 수 있어요` : '찬성 또는 반대를 누르세요'} · ${S.votedCount}/${alive.length}`
      : `${ic('vote')} ${mv ? `<b>${mv === myId ? '나' : esc(nameOf(mv))}</b>에게 투표함 · 바꾸려면 다른 사람 클릭` : '대상을 클릭하세요 (나도 가능)'} · ${S.votedCount}/${alive.length}`;
  } else if (S.phase === 'shop') html = `${ic('shop')} ${readyN}/${alive.length}`;
  else if (S.phase === 'day') {
    const lv = S.lastVote && S.lastVote.day === S.day ? S.lastVote : null;
    html = (drag && drag.active
      ? (drag.kind === 'card' ? `<span class="pick">「${esc(drag.card.name)}」 → ${ic('target')}</span>`
        : drag.kind === 'company' ? `<span class="pick">${ic('target')} 놓고 고르기</span>`
        : '<span class="pick">↩ 손패</span>')
      : `<span title="카드 = 대상에게 끌어다 놓기 · 클릭 = 귓속말 · 우클릭 = 추리 태그">${ic('ready')} ${readyN}/${alive.length}</span>`);
  } else if (S.phase === 'night' || S.phase === 'voteResult') html = '';
  else if (S.phase === 'ended') html = '심사 종료';
  if (!S.me.alive && S.phase !== 'ended') html += ' · <span class="ph-vote">유령 모드</span>';
  $('#banner').innerHTML = html;
}

// ---------------------------------------------------------------------
// 타이머 다이얼 + 경매 시간 바 (0.25초마다)
// ---------------------------------------------------------------------
const ARC = 2 * Math.PI * 86;
let lastTickSec = null;
function tick() {
  if (!S || S.phase === 'lobby') return;
  const left = S.phaseEndsAt ? Math.max(0, S.phaseEndsAt - Date.now()) : 0;
  const frac = S.phaseDuration ? Math.min(1, left / S.phaseDuration) : 0;
  const sec = Math.ceil(left / 1000);
  const txt = S.phaseEndsAt ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : '—';
  // 남은 시간에 따라 링 색: 여유(페이즈 색) → 절반 이하 노랑 → 15초/20% 이하 빨강
  const urgency = !S.phaseEndsAt || S.phase === 'night' ? '' : (sec <= 15 || frac <= 0.2) ? ' urgent' : frac <= 0.5 ? ' half' : '';
  $('#dial').className = `dial ph-${S.phase}${urgency}`;
  // 소리: 마지막 10초 째깍 소리, 낮 음악은 남은 시간이 줄수록 긴장도↑
  if (S.phaseEndsAt && S.phase !== 'night' && S.phase !== 'ended' && sec !== lastTickSec) {
    if (sec > 0 && sec <= 10 && S.me && S.me.alive) Sound.sfx(sec <= 3 ? 'tickHi' : 'tick');
  }
  lastTickSec = sec;
  Sound.intensity(S.phase !== 'day' ? 0 : (sec <= 15 || frac <= 0.2) ? 1 : frac <= 0.5 ? 0.5 : 0);
  const cbt = $('#cbTime'); if (cbt) cbt.textContent = `⏱ ${txt}`;
  $('#dialPhase').textContent = PHASE_LABEL[S.phase];
  $('#dialTime').textContent = txt;
  $('#dialArc').style.strokeDasharray = ARC;
  $('#dialArc').style.strokeDashoffset = ARC * (1 - frac);
  $('#shopTimeFill').style.width = (frac * 100) + '%';
  $('#shopTime').textContent = txt;
}
setInterval(tick, 250);

// ---------------------------------------------------------------------
// 원탁: 다른 플레이어는 다이얼 둘레(아래쪽 비움), 나는 아래 가운데 반원
// ---------------------------------------------------------------------
// 이 능력을 이 사람에게 쓸 수 있나?
function abilityOk(ab, p) {
  if (!p || !p.alive) return false;
  if (ab.target === 'other') return p.id !== myId;
  if (ab.target === 'self') return p.id === myId;
  return true;
}
// 이 카드를 이 사람에게 놓을 수 있나? (능력 중 하나라도 되면 OK)
const cardOk = (card, p) => card.abilities.some((ab) => abilityOk(ab, p));

function companyDropOk(p) {
  return !!p && p.alive && S.phase === 'day' && S.me.alive && !S.me.sabotaged;
}
function canTarget(p) {
  if (drag && drag.active && drag.kind === 'card') return cardOk(drag.card, p);
  if (drag && drag.active && drag.kind === 'company') return companyDropOk(p);
  if (!pick) return S.phase === 'vote' && !isYesNo() ? (S.me.alive && p.alive && p.id !== S.voteBannedId) : false;
  if (pick.kind === 'transfer') return p.alive && p.id !== myId;
  if (pick.kind === 'special') return p.alive && (coInfo(S.me.company).target !== 'other' || p.id !== myId);
  return abilityOk(pick.ability, p);
}

function seatExtras(p) {
  const res = S.phase === 'day' ? S.me.reservations : { cards: [], company: null };
  const handByUid = Object.fromEntries(S.me.hand.map((c) => [c.uid, c]));
  const chips = res.cards.filter((c) => c.targetId === p.id).map((c) => {
    const card = handByUid[c.cardUid];
    const ab = card && card.abilities.find((a) => a.key === c.ability);
    const tip = card ? `${card.name} · ${ab ? ab.label : ''}${c.usePierce ? ' · 관통' : ''}\n나에게만 보이는 표시 · 클릭하거나 손패로 끌어오면 회수` : '';
    return `<span class="chip ${card ? `fam-${card.family}` : ''}" data-uid="${c.cardUid}" title="${esc(tip)}">${card ? FAM_ICON[card.family] : ''}${c.usePierce ? ic('emp') : ''}</span>`;
  });
  if (res.company && res.company.type === 'transfer' && res.company.targetId === p.id) {
    chips.push(`<span class="chip money" data-money="1" title="클릭 = 취소">${ic('transfer')}</span>`);
  }
  if (res.company && res.company.type === 'special' && res.company.targetId === p.id) {
    chips.push(`<span class="chip money" data-money="1" title="클릭 = 취소" style="--cc:${TAG_COLOR[S.me.company]}">${coInfo(S.me.company).icon}</span>`);
  }
  return `<div class="chips">${chips.join('')}</div>`;
}

// 유령 전용: 산 사람의 크래딧 · 손패 · 오늘 놓은 카드 · 송금 · 투표
function ghostViewHtml(g) {
  const plays = g.plays.map((x) => `<div class="gv-play fam-${x.family}" title="${esc(x.label)}">${FAM_ICON[x.family]} ${esc(x.name)} → ${esc(x.targetId ? nameOf(x.targetId) : '')}</div>`).join('');
  const co = g.company ? `<div class="gv-play money">${g.company.type === 'transfer' ? `⇄ → ${esc(nameOf(g.company.targetId))}` : g.company.type === 'special' ? `★ 특수${g.company.targetId ? ` → ${esc(nameOf(g.company.targetId))}` : ''}${g.company.text ? ` "${esc(g.company.text)}"` : ''}` : '₵ 자원'}</div>` : '';
  const vote = g.vote ? `<div class="gv-play">🗳 → ${esc(nameOf(g.vote))}</div>` : '';
  return `<div class="ghost-view"><div class="gv-cr">₵${won(g.credits)}</div>
    <div class="gv-hand">${g.hand.map((c) => `<span class="fam-${c.family}" title="${esc(c.name)} ${'★'.repeat(c.tier)}">${FAM_ICON[c.family]}${esc(c.name)}</span>`).join('') || '<span class="muted">손패 없음</span>'}</div>
    ${plays}${co}${vote}</div>`;
}
function renderSeats() {
  const others = S.players.filter((p) => p.id !== myId);
  const myIdx = S.players.findIndex((p) => p.id === myId);
  // 원탁 순서 유지: 내 다음 사람부터 시계 방향
  const ordered = S.players.slice(myIdx + 1).concat(S.players.slice(0, myIdx)).filter((p) => p.id !== myId);
  const n = ordered.length;
  // 위(270°)를 중심으로 펼친다. 사람이 적으면 좁게, 많으면 왼쪽 아래(160°)~오른쪽 아래(380°)까지
  const SPAN = Math.min(220, 55 * (n - 1));
  const START = 270 - SPAN / 2;
  const html = ordered.map((p, i) => {
    const deg = n === 1 ? 270 : START + (SPAN * i) / (n - 1);
    const r = (deg * Math.PI) / 180;
    const x = 50 + 38 * Math.cos(r);
    const y = 50 + 31 * Math.sin(r);          // 신분증 카드가 커서 위쪽 띠와 겹치지 않게 조금 아래로
    const tag = getTags()[p.id];
    const shown = shownState(p);
    const cls = ['seat', n > 7 && 'compact', !shown.alive && 'dead', canTarget(p) && 'targetable', tag && 'tagged', nightFocusClass(p.id),
      S.phase === 'vote' && S.me.myVote === p.id && 'voted', !p.connected && 'off',
      S.phase === 'vote' && p.id === S.voteBannedId && 'vote-ban'].filter(Boolean).join(' ');
    const seatNo = String(S.players.findIndex((q) => q.id === p.id) + 1).padStart(2, '0');
    const barLeft = p.company
      ? `${p.exposed && S.me.alive ? '⚠' : ''}${coLogo(p.company, 'tiny')}<span class="co-${p.company}">${esc(companyShort(p.company))}</span>`
      : `AGENT-${seatNo}`;
    const flags = `${p.id === S.hostId ? '<span class="crown" title="방장">👑</span>' : ''}${p.ready && p.alive ? '<span class="ready" title="준비 완료">✔</span>' : ''}${whisperUnread(p.id) ? '<span class="wbadge" title="안 읽은 귓속말">💬</span>' : ''}`;
    return `<div class="${cls}" data-id="${p.id}" style="left:${x}%;top:${y}%;${tag ? `--tag:${TAG_COLOR[tag]}` : ''}">
      ${idCardHtml({ name: p.name, avatar: Avatar.of(p), barLeft, flags, hp: shown.alive ? shown.hp : 0, armor: shown.alive ? shown.armor : 0, led: p.connected })}
      ${tag ? `<div class="seat-tag">${coLogo(tag, 'tiny')}${esc(companyShort(tag))}?</div>` : ''}
      ${!shown.alive ? `<div class="seat-skull">${SKULL}</div>` : ''}
      ${p.ghostView ? ghostViewHtml(p.ghostView) : ''}
      ${!p.connected ? '<div class="seat-sub">연결 끊김</div>' : ''}
      ${S.phase === 'vote' && p.id === S.voteBannedId ? '<div class="ban-tag" title="어제 보조금을 받아 오늘은 받을 수 없습니다">연속 수령 금지</div>' : ''}
      ${seatExtras(p)}
    </div>`;
  }).join('');
  $('#seats').innerHTML = html;
  $('#seats').querySelectorAll('.seat').forEach((el) => {
    el.onclick = (e) => onSeatClick(S.players.find((p) => p.id === el.dataset.id), e);
    el.oncontextmenu = (e) => { e.preventDefault(); openTagMenu(el.dataset.id, e.clientX, e.clientY); };
  });
  bindChipDrag($('#seats'));
  if (!others.length) $('#seats').innerHTML = '';
}

function renderMe() {
  const me = S.players.find((p) => p.id === myId);
  const el = $('#meSeat');
  const meShown = me ? shownState(me) : { alive: S.me.alive, hp: S.me.hp, armor: S.me.armor };
  el.className = ['me-seat', !meShown.alive && 'dead', me && canTarget(me) && 'targetable', S.phase === 'vote' && S.me.myVote === myId && 'voted', S.phase === 'vote' && myId === S.voteBannedId && 'vote-ban', nightFocusClass(myId)].filter(Boolean).join(' ');
  el.dataset.id = myId;
  const showReady = (S.phase === 'day' || S.phase === 'discuss') && S.me.alive;
  const isTalk = S.phase === 'discuss';
  el.innerHTML = `
    <div class="me-ava">${me ? Avatar.svg(Avatar.of(me)) : ''}</div>
    <div class="me-name">${esc(S.me.name)} <span class="small co-${S.me.company}">${esc(companyShort(S.me.company))}</span></div>
    <div class="me-hp">${meShown.alive ? hearts(meShown.hp, meShown.armor) : '<span class="ph-vote">유령</span>'}</div>
    ${showReady ? `<button id="btnReady" class="${me.ready ? 'on' : 'primary'}" title="전원이 누르면 바로 ${isTalk ? '투표' : '밤'}">${isTalk ? (me.ready ? '✔ 토의 끝' : '토의 끝') : (me.ready ? '✔ 준비됨' : '준비')}</button>` : ''}
    ${me ? seatExtras(me) : ''}`;
  el.onclick = (e) => {
    if (e.target.id === 'btnReady') return act('ready', { phase: S.phase });
    if (me) onSeatClick(me, e);
  };
  bindChipDrag(el);
}

async function onSeatClick(p, e) {
  // 내가 놓은 카드(엎어진 카드)를 누르면 손패로 회수
  const chip = e.target.closest('.chip');
  if (chip && S.phase === 'day') {
    e.stopPropagation();
    if (chip.dataset.money) { act('clearCompany').then((r) => r.ok && Sound.sfx('cancel')); return; }
    return cancelReserve(chip.dataset.uid);
  }
  if (pick && pick.kind === 'card') {
    if (!canTarget(p)) return toast('그 대상에게는 쓸 수 없습니다.', 'error');
    const res = await reserve(pick.card, pick.ability.key, p.id, { usePierce: pick.usePierce });
    if (res.ok) { pick = null; render(); }
    return;
  }
  if (pick && pick.kind === 'special') {
    if (!canTarget(p)) return toast('그 대상에게는 쓸 수 없습니다.', 'error');
    const ci = coInfo(S.me.company);
    const res = await act('setCompany', { type: 'special', targetId: p.id });
    if (!res.ok) return failAt(p.id, res.error);
    if (res.ok) { pick = null; Sound.sfx('lock'); render(); if (p.id === myId) selfFx(ci.icon, TAG_COLOR[S.me.company]); else stampAt(p.id, ci.icon, TAG_COLOR[S.me.company]); }
    return;
  }
  if (pick && pick.kind === 'transfer') {
    if (!canTarget(p)) return toast('자신에게는 송금할 수 없습니다.', 'error');
    const res = await act('setCompany', { type: 'transfer', targetId: p.id });
    if (!res.ok) return failAt(p.id, res.error);
    if (res.ok) { pick = null; Sound.sfx('lock'); render(); stampAt(p.id, `⇄ ₵${won(S.me.transferGift)}`, '#FFB627'); }
    return;
  }
  if (S.phase === 'vote' && !isYesNo()) {
    if (!S.me.alive) return toast('탈락자는 투표할 수 없습니다.', 'error');
    if (!p.alive) return toast('살아있는 사람에게만 투표할 수 있습니다.', 'error');
    if (p.id === S.voteBannedId) return toast(`${p.name}은(는) 어제 보조금을 받아 오늘은 받을 수 없습니다.`, 'error');
    act('vote', { targetId: p.id }).then((r) => { if (!r.ok) return; Sound.sfx('lock'); if (p.id === myId) selfFx(ic('vote'), '#FFB627'); else stampAt(p.id, ic('vote'), '#FFB627'); });
    return;
  }
  if (p.id !== myId && p.alive && S.me.alive) {      // 그 외: 귓속말 상대로
    chatTab = 'whisper';
    whisperTo = p.id;
    renderChat();
    $('#chatInput').focus();
  }
}

// ---------------------------------------------------------------------
// 추리 태그: 아바타 우클릭 → "이 사람은 OO 같다" 색을 칠해둔다 (나만 보임, 이 브라우저에 저장)
// ---------------------------------------------------------------------
const TAG_COLOR = { helios: '#FF9A2E', blackice: '#5CE1FF', redline: '#FF3355', neoncast: '#FF3DD8', orion: '#B57BFF' };   // 로고 색과 맞춤
let tagCache = null;
const tagKey = () => `arbiter:tags:${S.code}:${myId}`;
function getTags() {
  if (tagCache && tagCache.key === tagKey()) return tagCache.tags;
  let tags = {};
  try { tags = JSON.parse(localStorage.getItem(tagKey()) || '{}'); } catch (e) { tags = {}; }
  tagCache = { key: tagKey(), tags };
  return tags;
}
function setTag(pid, company) {
  const tags = getTags();
  if (company) tags[pid] = company; else delete tags[pid];
  try { localStorage.setItem(tagKey(), JSON.stringify(tags)); } catch (e) { /* 저장 못 해도 이번 화면에서는 유지 */ }
  renderSeats();
}
function openTagMenu(pid, x, y) {
  closeTagMenu();
  const p = S.players.find((q) => q.id === pid);
  const m = document.createElement('div');
  m.id = 'tagMenu';
  m.className = 'tag-menu';
  m.style.left = '0px';
  m.style.top = '0px';
  m.innerHTML = `<div class="muted small">${esc(p.name)} — 추리 태그</div>`
    + (S.activeCompanies && S.activeCompanies.length ? S.activeCompanies : Object.keys(TAG_COLOR)).map((c) => `<button data-co="${c}">${coLogo(c, 'tiny')}${CO_SHORT[c]}</button>`).join('')
    + '<button data-co="" class="ghost-btn">지우기</button>';
  m.querySelectorAll('button').forEach((b) => { b.onclick = () => { setTag(pid, b.dataset.co); closeTagMenu(); }; });
  document.body.appendChild(m);
  // 아바타를 가리지 않게: 자리 오른쪽(넘치면 왼쪽)에 붙이고 화면 안으로
  const seat = document.querySelector(`.seat[data-id="${pid}"]`);
  const r = seat ? seat.getBoundingClientRect() : { right: x, left: x, top: y };
  const mw = m.offsetWidth; const mh = m.offsetHeight;
  let left = r.right + 10;
  if (left + mw > window.innerWidth - 8) left = r.left - mw - 10;
  const top = Math.min(Math.max(8, r.top), window.innerHeight - mh - 8);
  m.style.left = left + 'px';
  m.style.top = top + 'px';
}
function closeTagMenu() { const m = $('#tagMenu'); if (m) m.remove(); }
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#tagMenu')) closeTagMenu(); });

// ---------------------------------------------------------------------
// 가운데 상자: 아침 뉴스 / 밤 결과
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// 밤 연출: 사건 하나당 한 장면씩 천천히 보여준다
//   사이렌 → 방패 → 공격(대상별) → 사망(사람별) → 글리치 → 요약(+내 개인 결과)
//   서버가 정해준 beatMs 간격으로 진행. 페이즈 시작 시각으로 현재 장면을 계산하므로
//   중간에 화면을 다시 그려도(채팅 등) 처음부터 다시 시작하지 않는다.
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// 밤 연출: 무슨 일이 일어난 사람만, 한 명씩 천천히 애니메이션으로
//   한 장면 = 한 사람: (회복·장갑) → 공격이 날아옴 → 방어 → 결과(♥ / ◈ / 카드 / 돈) → (사망 도장)
//   결과(체력 숫자)는 장면 중간(RESULT_AT)에 바뀐다
// ---------------------------------------------------------------------
const RESULT_AT = 0.42;     // 장면의 이 지점에서 결과가 보인다
function buildNightBeats(N) {
  const heals = N.heals || []; const armors = N.armors || [];
  const ops = N.ops || [];
  const ids = [...new Set([...N.attacks.map((a) => a.targetId), ...heals.map((h) => h.targetId), ...armors, ...ops.map((o) => o.targetId)])];
  const order = S.players.map((p) => p.id);
  ids.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const beats = ids.map((id) => ({
    kind: 'person', ids: [id], id,
    attack: N.attacks.find((a) => a.targetId === id) || null,
    heal: heals.find((h) => h.targetId === id) || null,
    armor: armors.includes(id),
    ops: ops.filter((o) => o.targetId === id),
    death: N.deaths.includes(id),
    ms: (N.beatPlan && N.beatPlan[id]) || N.beatMs,
  }));
  if (!beats.length) beats.push({ kind: 'quiet', ms: N.beatMs });
  beats.push({ kind: 'summary', ms: N.summaryMs || N.beatMs });
  return beats;
}
// 한 사람의 결과를 아이콘 목록으로 (태그·캡션 공용)
function personResults(b) {
  const out = [];
  if (b.heal) out.push({ t: `♥ +${b.heal.hpAfter - b.heal.hpBefore}`, tone: 'good' });
  if (b.armor) out.push({ t: '◈ +1', tone: 'good' });
  const a = b.attack;
  if (a) {
    const r = a.result || '';
    if (a.damage === 0) out.push({ t: '🛡 방어 성공', tone: 'good' });
    if (r.includes('hp')) out.push({ t: '♥ −1', tone: 'bad' });
    if (r.includes('armor')) out.push({ t: '◈ −1', tone: 'bad' });
    if (r.includes('card')) out.push({ t: '🃏 −1', tone: 'bad' });
    if (r.includes('credits')) out.push({ t: `₵ −${won(a.lostCredits || 0)}`, tone: 'bad' });
  }
  for (const o of b.ops || []) {
    if (o.kind === 'scan') out.push({ t: '조사당함', tone: 'intel' });
    else if (o.kind === 'firewall') out.push({ t: '방화벽 차단', tone: 'good' });
    else if (o.blocked) out.push({ t: o.kind === 'steal' ? '도둑질 막음' : '탈취 막음', tone: 'good' });
    else if (o.kind === 'destroy') out.push({ t: '🃏 파괴', tone: 'bad' });
    else if (o.kind === 'snatch') out.push({ t: '🃏 빼앗김', tone: 'bad' });
    else if (o.kind === 'steal') out.push({ t: `₵ −${won(o.amount || 0)} 도둑`, tone: 'bad' });
  }
  if (b.death) out.push({ t: '☠ 사망', tone: 'bad' });
  return out;
}

let nightCache = null;   // { day, beats }
// 지금 밤 연출이 어디까지 진행됐는지. 밤이 아니면 null
function nightView() {
  if (!S || S.phase !== 'night' || !S.lastNight || S.lastNight.day !== S.day) return null;
  const N = S.lastNight;
  if (!nightCache || nightCache.day !== N.day) {
    nightCache = { day: N.day, beats: buildNightBeats(N) };
    nightArchive[N.day] = nightCache.beats.filter((b) => b.kind === 'person');
  }
  const beats = nightCache.beats;
  const start = nightStart(N);
  const t = Math.max(0, Date.now() - start);
  // 장면마다 길이가 다르다 (결과가 많은 사람은 길게)
  let idx = 0; let beatStart = start;
  while (idx < beats.length - 1 && t >= beatStart - start + beats[idx].ms) { beatStart += beats[idx].ms; idx += 1; }
  const ms = beats[idx].ms;
  const inBeat = (Date.now() - beatStart) / ms;
  const resultMs = N.beatMs * RESULT_AT;
  const shown = new Set();     // 결과가 이미 보인 사람
  beats.forEach((b, i) => { if (b.kind === 'person' && (i < idx || (i === idx && Date.now() - beatStart >= resultMs))) shown.add(b.id); });
  return { N, beats, idx, beat: beats[idx], inBeat, shown, start, beatStart, ms };
}

// 밤 연출 시작 시각 (다시 보기 중이면 다시 보기를 누른 시각)
function nightStart(N) {
  return nightReplay && nightReplay.day === N.day ? nightReplay.start : S.phaseEndsAt - S.phaseDuration;
}

// 연출 중에는 아직 결과가 안 나온 사람을 "밤 전 상태"로 보여준다
function shownState(p) {
  const nv = nightView();
  if (!nv) return { alive: p.alive, hp: p.hp, armor: p.armor };
  if (nv.shown.has(p.id)) return { alive: p.alive, hp: p.hp, armor: p.armor };
  const a = nv.N.attacks.find((x) => x.targetId === p.id);
  const h = (nv.N.heals || []).find((x) => x.targetId === p.id);
  const gotArmor = (nv.N.armors || []).includes(p.id);
  let hp = h ? h.hpBefore : a ? a.hpBefore : p.hp;
  let armor = a && a.armorBefore != null ? a.armorBefore : p.armor;
  if (gotArmor) armor = Math.max(0, armor - 1);
  const alive = p.alive || nv.N.deaths.includes(p.id);
  return { alive, hp, armor };
}

function nightFocusClass(id) {
  const nv = nightView();
  if (!nv || !nv.beat.ids || !nv.beat.ids.includes(id)) return '';
  return 'nfocus';
}

let nightTimer = null;
let lastBeatKey = '';
function scheduleNightTick() {
  clearTimeout(nightTimer);
  const nv = nightView();
  if (!nv) return;
  const beatStart = nv.beatStart;
  const resultAt = beatStart + nv.N.beatMs * RESULT_AT;
  const next = Date.now() < resultAt ? resultAt : beatStart + nv.ms;
  if (nv.idx < nv.beats.length - 1 || Date.now() < resultAt) nightTimer = setTimeout(render, Math.max(50, next - Date.now() + 20));
}

// 장면 하나의 애니메이션을 그 사람 자리 위에 띄운다 (CSS 애니메이션, 시간은 beatMs 비율)
function seatEl(id) { return id === myId ? $('#meSeat') : document.querySelector(`.seat[data-id="${id}"]`); }
function playPersonFx(b, beatMs, totalMs = beatMs) {
  const el = seatEl(b.id);
  const stage = $('#stage');
  if (!el) return;
  const sr = stage.getBoundingClientRect(); const r = el.getBoundingClientRect();
  const fx = document.createElement('div');
  fx.className = 'nfx';
  fx.style.left = (r.left - sr.left + r.width / 2) + 'px';
  fx.style.top = (r.top - sr.top + Math.min(r.height / 2, 60)) + 'px';
  fx.style.setProperty('--beat', beatMs + 'ms');
  const T = (f) => `${Math.round(beatMs * f)}ms`;     // 장면 길이의 몇 % 지점
  let h = '';
  const a = b.attack;
  // 1) 날아오는 것들 (공격 번개 · 방패 · 공작 아이콘 · 스캔)
  if (b.heal) h += `<div class="nfx-heal" style="animation-delay:${T(0.02)}">✚</div>`;
  if (b.armor) h += `<div class="nfx-armorup" style="animation-delay:${T(0.06)}">◈</div>`;
  if (a) {
    const n = Math.min(4, a.count);
    for (let i = 0; i < n; i++) h += `<div class="nfx-bolt" style="--i:${i};--n:${n};animation-delay:${T(0.12 + i * 0.05)}"></div>`;
    if (a.shielded || a.damage === 0) h += `<div class="nfx-shield ${a.damage === 0 ? 'hold' : 'crack'}" style="animation-delay:${T(0.28)}"></div>`;
  }
  const opIcon = { destroy: 'destroyCard', snatch: 'snatchCard', steal: 'steal', scan: 'investigate', firewall: 'firewall' };
  for (const o of b.ops || []) {
    if (o.kind === 'scan') { h += `<div class="nfx-scan" style="animation-delay:${T(0.08)}"></div>`; continue; }
    if (o.blocked) { h += `<div class="nfx-shield hold" style="animation-delay:${T(0.3)}"></div>`; continue; }
    h += `<div class="nfx-op ${o.kind}" style="animation-delay:${T(0.12)}">${ic(opIcon[o.kind])}</div>`;
  }
  // 2) 결과: 같은 자리에서 하나씩 차례로 (겹치지 않게)
  const results = [];
  if (a) {
    const r2 = a.result || '';
    if (a.damage === 0) results.push(['blocked', 'BLOCKED']);
    if (r2.includes('armor')) results.push(['armor', '<span class="shard">◈</span><b>−1</b>']);
    if (r2.includes('hp')) results.push(['heart', '<span class="hl">♥</span><span class="hr">♥</span><b>−1</b>']);
    if (r2.includes('card')) results.push(['cardx', '<span class="cl"></span><span class="cr"></span><b>−1</b>']);
    if (r2.includes('credits')) results.push(['coins', `<i></i><i></i><i></i><i></i><b>−₵${won(a.lostCredits || 0)}</b>`]);
  }
  for (const o of b.ops || []) {
    if (o.kind === 'scan') results.push(['scanned', `${ic('investigate')}<b>조사당함</b>`]);
    else if (o.blocked) results.push(['blocked', o.kind === 'firewall' ? `${ic('firewall')}<b>방화벽</b>` : 'BLOCKED']);
    else if (o.kind === 'destroy') results.push(['cardx', '<span class="cl"></span><span class="cr"></span><b>−1</b>']);
    else if (o.kind === 'snatch') results.push(['snatch', '<span class="sc"></span><b>−1</b>']);
    else if (o.kind === 'steal') results.push(['coins', `<i></i><i></i><i></i><i></i><b>−₵${won(o.amount || 0)}</b>`]);
  }
  if (b.heal) results.push(['healed', `<b>♥ +${b.heal.hpAfter - b.heal.hpBefore}</b>`]);
  if (b.armor && !(a && (a.result || '').includes('armor'))) results.push(['armorup', '<b>◈ +1</b>']);
  const n = results.length + (b.death ? 1 : 0);
  const start0 = beatMs * RESULT_AT;
  const slot = n ? Math.max(500, (totalMs - start0 - beatMs * 0.08) / n) : 0;
  results.forEach(([cls, inner], i) => {
    h += `<div class="nfx-res ${cls}" style="--k:0;--rd:${Math.round(n > 1 ? slot * 1.05 : beatMs * 0.5)}ms;animation-delay:${Math.round(start0 + i * slot)}ms">${inner}</div>`;
  });
  if (b.death) h += `<div class="nfx-dead" style="animation-delay:${Math.round(start0 + results.length * slot)}ms">${SKULL}</div>`;
  fx.innerHTML = h;
  stage.appendChild(fx);
  setTimeout(() => fx.remove(), totalMs + 200);
  // 소리: 결과마다
  results.forEach(([cls], i) => setTimeout(() => Sound.sfx(cls === 'blocked' ? 'block' : ['healed', 'armorup'].includes(cls) ? 'shield' : cls === 'scanned' ? 'tick' : 'hit'), start0 + i * slot));
  if (b.death) setTimeout(() => Sound.sfx('death'), start0 + results.length * slot);
  if (a && a.damage > 0 && b.id === myId) setTimeout(hurtFlash, start0);
}

function renderNight() {
  const nv = nightView();
  const cap = $('#nightCaption');
  $('#stage').classList.toggle('night-dim', !!nv && nv.beat.kind !== 'summary');
  $('#stage').classList.toggle('glitch', false);
  $('#stage').classList.toggle('siren', false);
  $('#stage').classList.toggle('captioning', !!nv && nv.beat.kind === 'quiet');
  if (!nv || nv.beat.kind === 'summary') { cap.classList.add('hidden'); scheduleNightTick(); return; }
  const key = `${nv.N.day}-${nv.idx}-${nightReplay ? nightReplay.start : 0}`;
  if (key !== lastBeatKey) {                      // 장면이 바뀔 때만: 캡션 + 애니메이션 한 번
    lastBeatKey = key;
    const b = nv.beat;
    if (b.kind === 'quiet') {
      cap.className = 'night-caption k-quiet';
      cap.innerHTML = '<div class="nc-title">특이사항 없음</div>';
    } else {
      const total = nv.beats.filter((x) => x.kind === 'person').length;
      cap.className = 'night-caption k-person';
      cap.innerHTML = `<div class="nc-step">${nv.idx + 1}/${total}</div><div class="nc-title">${esc(nameOf(b.id))}${b.id === myId ? ' (나)' : ''}</div>`;
      // 장면 시작이 이미 지났으면(새로고침 등) 애니메이션은 생략
      if (Date.now() - nv.beatStart < nv.N.beatMs * 0.3) playPersonFx(b, nv.N.beatMs, nv.ms);
    }
  }
  scheduleNightTick();
}

// 지난 밤 다시 보기용 짧은 목록
function nightLogHtml(beats) {
  return `<ul class="night-log">${beats.map((b) => `<li><b>${esc(nameOf(b.id))}</b><span>${personResults(b).map((r) => `<em class="tone-${r.tone}">${r.t}</em>`).join(' ')}</span></li>`).join('')}</ul>`;
}

// ---------------------------------------------------------------------
// 낮·밤 조명: 무대 밑에 페이즈별 빛(아침 앰버 / 낮 시안 / 밤 남색) + 전환 순간의 막
// ---------------------------------------------------------------------
function ensureAmbient() {
  let a = $('#ambient');
  if (!a) {
    a = document.createElement('div'); a.id = 'ambient';
    a.innerHTML = '<i class="amb amb-morning"></i><i class="amb amb-day"></i><i class="amb amb-night"></i><i class="amb amb-shop"></i>';
    $('#stage').prepend(a);
  }
  return a;
}
function updateAmbient() {
  if (!S || S.phase === 'lobby') return;
  const a = ensureAmbient();
  const ph = ['voteResult', 'vote', 'discuss'].includes(S.phase) ? 'morning' : S.phase === 'ended' ? 'night' : S.phase;
  a.dataset.ph = ph;
  document.body.dataset.phase = S.phase;
}
function phaseSweep(to, from) {
  if (!S || to === 'lobby') return;
  // 암시장: 화면이 어두워졌다가 초록 네온이 지지직 켜짐 / 암시장 → 낮: 어둠이 위로 걷히며 시안빛
  const kind = to === 'night' ? 'to-night' : to === 'morning' ? 'to-morning' : to === 'shop' ? 'to-shop'
    : to === 'day' ? (from === 'shop' ? 'to-day from-shop' : 'to-day') : '';
  if (!kind) return;
  const el = document.createElement('div');
  el.className = `sweep ${kind}`;
  if (to === 'shop') el.innerHTML = '<i class="neon-line"></i><i class="neon-line l2"></i>';
  $('#stage').appendChild(el);
  if (to === 'shop') { Sound.sfx('shutter'); setTimeout(() => Sound.sfx('neon'), 900); }
  if (to === 'day' && from === 'shop') Sound.sfx('lightsUp');
  setTimeout(() => el.remove(), 3000);
}

// ---------------------------------------------------------------------
// 개표 연출: 후보 자리 위로 득표 막대가 차오르고 → 가운데 보조금 동전이 당선자에게 날아감 (동률이면 흩어짐)
// ---------------------------------------------------------------------
function playVoteFx(lv) {
  const topic = lv.topic || 'subsidy';
  if (topic === 'revealTop' || topic === 'equalize') return playYesNoFx(lv);
  if (topic !== 'subsidy') return playWhoFx(lv);
  const stage = $('#stage'); const sr = stage.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = 'vfx';
  const tally = lv.tally || {};
  const max = Math.max(1, ...Object.values(tally));
  let h = '';
  for (const [id, n] of Object.entries(tally)) {
    const el = seatEl(id); if (!el) continue;
    const r = el.getBoundingClientRect();
    const x = r.left - sr.left + r.width / 2; const y = r.top - sr.top;
    h += `<div class="vfx-bar ${id === lv.winnerId ? 'win' : ''}" style="left:${x}px;top:${y - 8}px;--h:${18 + (n / max) * 62}px"><b>${n}</b></div>`;
  }
  // 가운데 보조금 동전 무더기
  const cx = sr.width / 2; const cy = sr.height * 0.48;
  const w = lv.winnerId && seatEl(lv.winnerId);
  let tx = cx; let ty = cy;
  if (w) { const r = w.getBoundingClientRect(); tx = r.left - sr.left + r.width / 2; ty = r.top - sr.top + r.height / 2; }
  h += `<div class="vfx-pot" style="left:${cx}px;top:${cy}px">₵${won(lv.pot)}</div>`;
  // 브로커 커미션: 동전 일부가 갈라져 나간다 — 내가 받은 몫이면 내 자리로, 아니면 화면 밖 어딘가로 (누군지는 비밀)
  const cutN = w && lv.cut ? Math.max(2, Math.round(14 * lv.cut / lv.pot)) : 0;
  let kx = cx; let ky = -40;
  if (lv.myCut) { const me = $('#meSeat').getBoundingClientRect(); kx = me.left - sr.left + me.width / 2; ky = me.top - sr.top + me.height / 2; }
  for (let i = 0; i < 14; i++) {
    const isCut = i >= 14 - cutN;
    const ex = isCut ? kx : tx; const ey = isCut ? ky : ty;
    const dx = (w ? ex - cx : (Math.random() - 0.5) * 520) + (Math.random() - 0.5) * 30;
    const dy = (w ? ey - cy : (Math.random() - 0.3) * 360) + (Math.random() - 0.5) * 30;
    h += `<i class="vfx-coin ${w ? '' : 'lost'} ${isCut ? 'cut' : ''}" style="left:${cx}px;top:${cy}px;--dx:${dx}px;--dy:${dy}px;animation-delay:${1700 + i * 55}ms"></i>`;
  }
  if (cutN) {
    const lx = lv.myCut ? kx : cx + 140; const ly = lv.myCut ? ky - 60 : cy - 70;
    h += `<div class="vfx-cut ${lv.myCut ? 'mine' : ''}" style="left:${lx}px;top:${ly}px">${lv.myCut ? `커미션 +₵${won(lv.myCut)}` : `커미션 −₵${won(lv.cut)}`}</div>`;
  }
  layer.innerHTML = h;
  stage.appendChild(layer);
  Sound.sfx('tick');
  setTimeout(() => Sound.sfx(w ? 'coinUp' : 'cancel'), 1900);
  setTimeout(() => Sound.sfx('vote'), 2700);
  setTimeout(() => layer.remove(), 5400);
}

// 찬반 개표: 가운데 찬성/반대 막대 → 통과/부결 도장
function playYesNoFx(lv) {
  const stage = $('#stage');
  const layer = document.createElement('div');
  layer.className = 'vfx yn';
  const max = Math.max(1, lv.yes || 0, lv.no || 0);
  layer.innerHTML = `<div class="yn-bars"><div class="yn-col yes"><i style="--h:${((lv.yes || 0) / max) * 160}px"></i><b>${lv.yes || 0}</b><span>찬성</span></div>
    <div class="yn-col no"><i style="--h:${((lv.no || 0) / max) * 160}px"></i><b>${lv.no || 0}</b><span>반대</span></div></div>
    <div class="yn-stamp ${lv.passed ? 'pass' : 'fail'}">${lv.passed ? '통과' : '부결'}</div>`;
  stage.appendChild(layer);
  Sound.sfx('tick');
  setTimeout(() => Sound.sfx(lv.passed ? 'vote' : 'cancel'), 1700);
  // 자본 1위 공개: 그 사람 자리에 금색 표시
  if (lv.passed && lv.revealed) setTimeout(() => lv.revealed.forEach((x) => stampAt(x.id, `₵${won(x.credits)}`, '#FFB627')), 2300);
  setTimeout(() => layer.remove(), 5400);
}
// 누구 투표 (피해·벌금·카드): 득표 막대 → 당선자에게 효과
function playWhoFx(lv) {
  const stage = $('#stage'); const sr = stage.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = 'vfx';
  const tally = lv.tally || {};
  const max = Math.max(1, ...Object.values(tally));
  let h = '';
  for (const [id, n] of Object.entries(tally)) {
    const el = seatEl(id); if (!el) continue;
    const r = el.getBoundingClientRect();
    h += `<div class="vfx-bar ${id === lv.winnerId ? 'win' : ''}" style="left:${r.left - sr.left + r.width / 2}px;top:${r.top - sr.top - 8}px;--h:${18 + (n / max) * 62}px"><b>${n}</b></div>`;
  }
  layer.innerHTML = h;
  stage.appendChild(layer);
  Sound.sfx('tick');
  const w = lv.winnerId && seatEl(lv.winnerId);
  if (w) {
    setTimeout(() => {
      const r = w.getBoundingClientRect();
      const fx = document.createElement('div');
      fx.className = `vfx-hit t-${lv.topic}`;
      fx.style.left = (r.left - sr.left + r.width / 2) + 'px'; fx.style.top = (r.top - sr.top + r.height / 2) + 'px';
      fx.innerHTML = lv.topic === 'damage' ? `<span class="vh-big">${lv.result === 'armor' ? '◈' : '♥'}</span><b>−1</b>`
        : lv.topic === 'fine' ? `${ic('steal')}<b>−₵${won(lv.amount || 0)}</b>`
        : `${'<i class="vh-card"></i>'.repeat(lv.count || 3)}<b>+${lv.count || 3}</b>`;
      layer.appendChild(fx);
      Sound.sfx(lv.topic === 'cards' ? 'flip' : lv.topic === 'fine' ? 'coinDown' : 'hit');
      if (lv.topic === 'damage' && lv.winnerId === myId) hurtFlash();
    }, 1700);
  } else setTimeout(() => Sound.sfx('cancel'), 1700);
  setTimeout(() => layer.remove(), 5400);
}

// ---------------------------------------------------------------------
// HUD 태그: 사람 자리 옆에 선을 뽑아 짧은 정보를 붙인다 (다음 밤 정산 전까지 유지)
//   공개(모두에게): 어젯밤 피해·방어·회복 / 비공개(나만): 내가 캐낸 정보, 나에게 일어난 일
//   한 사람당 최대 3줄. 선은 무대 바깥쪽으로 뻗는다
// ---------------------------------------------------------------------
const HUD_MAX = 3;
function hudTagsFor(id) {
  const tags = [];
  const N = S.lastNight;
  const nv = nightView();
  const showPublic = N && (!nv || nv.beat.kind === 'summary');
  if (showPublic) {
    const b = { id, attack: N.attacks.find((a) => a.targetId === id), heal: (N.heals || []).find((h) => h.targetId === id),
      armor: (N.armors || []).includes(id), ops: (N.ops || []).filter((o) => o.targetId === id), death: N.deaths.includes(id) };
    for (const r of personResults(b)) tags.push({ text: r.t, tone: r.tone });
  }
  if (!nv || nv.beat.kind === 'summary') {
    for (const h of (S.me.hud || []).filter((x) => x.targetId === id)) tags.push({ text: h.text, tone: h.tone, lines: h.lines });
  }
  // 같은 줄은 한 번만, 비공개 정보(내가 알아낸 것) 우선으로 3줄까지
  const seen = new Set();
  const uniq = tags.filter((t) => (seen.has(t.text) ? false : seen.add(t.text)));
  const pri = { intel: 0, money: 1, bad: 2, good: 3 };
  return uniq.sort((a, b) => (pri[a.tone] ?? 4) - (pri[b.tone] ?? 4)).slice(0, HUD_MAX + 1);
}
// 도청 결과: 실제 귓속말 몇 줄을 감청 기록처럼
function tapHtml(lines) {
  return `<div class="hud-tap">${lines.map((l) => `<div title="${esc(l.text)}"><i>${esc(l.from)} → ${esc(l.to)}</i>“${esc(l.text.length > 46 ? l.text.slice(0, 45) + '…' : l.text)}”</div>`).join('')}</div>`;
}
function renderHud() {
  let layer = $('#hudLayer');
  if (!layer) { layer = document.createElement('div'); layer.id = 'hudLayer'; $('#stage').appendChild(layer); }
  if (!S || S.phase === 'lobby' || S.phase === 'ended' || !S.me) { layer.innerHTML = ''; layer.dataset.sig = ''; return; }
  const stage = $('#stage'); const sr = stage.getBoundingClientRect();
  const cx = sr.width / 2; const cy = sr.height * 0.48;
  let svg = ''; let html = '';
  for (const p of S.players) {
    const el = seatEl(p.id);
    if (!el) continue;
    const tags = hudTagsFor(p.id);
    if (!tags.length) continue;
    const r = el.getBoundingClientRect();
    const x = r.left - sr.left + r.width / 2; const y = r.top - sr.top + r.height / 2;
    const isMe = p.id === myId;
    // 바깥쪽 방향 (나는 오른쪽 위로)
    let ux = x - cx; let uy = y - cy;
    if (isMe) { ux = 1; uy = -0.35; }
    const len = Math.hypot(ux, uy) || 1; ux /= len; uy /= len;
    const side = ux >= 0 ? 'r' : 'l';
    // 자리 가장자리에서 출발
    const ex = x + ux * (r.width / 2) ; const ey = y + uy * (r.height / 2);
    const ax = ex + ux * 26 + (side === 'r' ? 10 : -10); const ay = ey + uy * 26;
    const shownTags = tags.slice(0, HUD_MAX);
    const more = tags.length > HUD_MAX ? tags.length - HUD_MAX : 0;
    html += `<div class="hud-block side-${side} ${isMe ? 'me' : ''}" data-hud="${p.id}" style="${side === 'r' ? 'left' : 'right'}:${side === 'r' ? ax : sr.width - ax}px;top:${ay}px">
      ${shownTags.map((t) => `<div class="hud-row tone-${t.tone}"><span>${esc(t.text)}</span></div>${t.lines ? tapHtml(t.lines) : ''}`).join('')}${more ? '<div class="hud-row tone-more"><span>…</span></div>' : ''}</div>`;
    svg += `<polyline data-hud="${p.id}" points="${ex},${ey} ${ax},${ay}" />`;
  }
  const out = `<svg class="hud-lines" width="${sr.width}" height="${sr.height}">${svg}</svg>${html}`;
  if (layer.dataset.sig === out) return;      // 바뀐 게 없으면 다시 그리지 않음 (등장 애니메이션 반복 방지)
  layer.dataset.sig = out;
  layer.innerHTML = out;
  // 블록이 무대 밖으로 나가면 안쪽으로 밀고, 선 끝도 맞춘다
  layer.querySelectorAll('.hud-block').forEach((b) => {
    const br = b.getBoundingClientRect();
    let dy = 0;
    if (br.top < sr.top + 4) dy = sr.top + 4 - br.top;
    if (br.bottom > sr.bottom - 4) dy = sr.bottom - 4 - br.bottom;
    let dx = 0;
    if (br.left < sr.left + 4) dx = sr.left + 4 - br.left;
    if (br.right > sr.right - 4) dx = sr.right - 4 - br.right;
    if (dx || dy) b.style.transform = `translate(${dx}px, calc(-100% + ${dy}px))`;
  });
}
// 자리에 마우스를 올리면 그 사람 태그만 진하게
document.addEventListener('pointerover', (e) => {
  const seat = e.target.closest && e.target.closest('.seat, .me-seat, .hud-block');
  const id = seat ? (seat.dataset.id || seat.dataset.hud) : null;
  document.querySelectorAll('#hudLayer [data-hud]').forEach((n) => {
    n.classList.toggle('hl', !!id && n.dataset.hud === id);
    n.classList.toggle('dim', !!id && n.dataset.hud !== id);
  });
});
window.addEventListener('resize', () => { if (S && S.phase !== 'lobby') renderHud(); });

// ---------------------------------------------------------------------
// 가운데 상자: 아침 뉴스 / 밤 요약
// ---------------------------------------------------------------------
function renderCenterBox() {
  const box = $('#centerBox');
  let html = '';
  let onClose = null;
  if (archiveOpen) {
    const beats = nightArchive[archiveOpen] || [];
    html = `<h3>🌙 ${archiveOpen}일차 밤</h3>${beats.length ? nightLogHtml(beats) : '<p class="muted">특이사항 없음</p>'}`;
    onClose = () => { archiveOpen = null; };
  } else if (S.phase === 'morning' && newsClosedDay !== S.day) {   // 뉴스는 아침에 한 번만
    // 아침에는 자동으로 펼치고, 투표·낮에는 접어서 "📡 오늘 뉴스" 버튼으로만 다시 연다 (다이얼을 가리지 않게)
    // 아침 뉴스는 직접 닫을 때까지 유지 + 어젯밤 내 정보 결과 고정
    const news = S.news.find((n) => n.day === S.day);
    if (news) {
      html = `<h3>📡 ${S.day}일차 뉴스 <span class="cb-time" id="cbTime"></span></h3>${news.lines.slice(1).map((l) => `<p>${esc(l)}</p>`).join('')}`;
      onClose = () => { newsClosedDay = S.day; newsOpenDay = null; };
    }
  }
  box.classList.toggle('hidden', !html);
  // 접힌 뉴스 다시 열기 버튼
  const hasNews = false;   // 다시 여는 버튼 없음
  const pill = $('#newsPill');
  pill.classList.toggle('hidden', !!html || !hasNews);
  pill.onclick = () => { newsOpenDay = S.day; newsClosedDay = null; render(); };
  box.classList.toggle('wide', !!html && (S.phase === 'night' || !!archiveOpen || html.includes('night-mine')));
  if (!html) return;
  box.innerHTML = (onClose ? '<button class="box-x" id="btnBoxClose" title="닫기">✕ 닫기</button>' : '') + html;
  if (onClose) $('#btnBoxClose').onclick = (e) => { e.stopPropagation(); onClose(); render(); };
  const rp = $('#btnReplay');
  if (rp) rp.onclick = (e) => { e.stopPropagation(); nightReplay = { day: S.lastNight.day, start: Date.now() }; lastBeatKey = ''; render(); };
  box.querySelectorAll('[data-decrypt]').forEach((el) => {
    if (decryptSeen.has(el.dataset.decrypt)) return;
    decryptSeen.add(el.dataset.decrypt);
    decrypt(el, 900 + Math.random() * 400);
  });
}

// ---------------------------------------------------------------------
// 연출: 복호화 글자 / 피격 번쩍임 / 아비터의 눈 / 카드 기울기
// ---------------------------------------------------------------------
const decryptSeen = new Set();
const GLYPHS = '01#$%&*+<>?/\\|=ABCDEFXYZ아비터에덴';
// 글자가 무작위 기호로 뒤섞였다가 앞에서부터 차례로 제 글자로 풀린다 (태그 없는 텍스트 요소에만)
function decrypt(el, ms = 700) {
  if (!el || el.children.length) return;
  const final = el.textContent;
  const t0 = performance.now();
  el.classList.add('decrypting');
  const step = (now) => {
    if (!el.isConnected) return;
    const k = Math.min(1, (now - t0) / ms);
    const n = Math.floor(final.length * k);
    let out = final.slice(0, n);
    for (let i = n; i < final.length; i++) out += final[i] === ' ' ? ' ' : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
    el.textContent = out;
    if (k < 1) requestAnimationFrame(step); else { el.textContent = final; el.classList.remove('decrypting'); }
  };
  requestAnimationFrame(step);
}
function hurtFlash() {
  document.body.classList.remove('hurt'); void document.body.offsetWidth;
  document.body.classList.add('hurt');
  setTimeout(() => document.body.classList.remove('hurt'), 1200);
}

// 아비터의 눈: 남은 시간에 맞춰 숨 쉬는 속도, 마우스(밤에는 사건 대상)를 바라봄, 가끔 깜빡임, 방송할 때 떨림
const eye = { mx: null, my: null };
document.addEventListener('pointermove', (e) => { eye.mx = e.clientX; eye.my = e.clientY; });
function eyeLook() {
  const dial = $('#dial'); const iris = $('#eyeIris');
  if (!dial || !iris || !S || S.phase === 'lobby') return;
  const r = dial.getBoundingClientRect();
  const cx = r.left + r.width / 2; const cy = r.top + r.height / 2;
  let tx = eye.mx; let ty = eye.my;
  const nv = nightView();
  if (nv && nv.beat.ids && nv.beat.ids.length) {                 // 밤: 지금 장면의 대상 쪽을 본다
    const id = nv.beat.ids[0];
    const el = id === myId ? $('#meSeat') : document.querySelector(`.seat[data-id="${id}"]`);
    if (el) { const b = el.getBoundingClientRect(); tx = b.left + b.width / 2; ty = b.top + b.height / 2; }
  }
  if (tx == null) { iris.setAttribute('transform', ''); return; }
  const dx = tx - cx; const dy = ty - cy; const d = Math.hypot(dx, dy) || 1;
  const k = Math.min(1, d / 400) * 7;                              // 최대 7px (SVG 단위)
  iris.setAttribute('transform', `translate(${(dx / d) * k} ${(dy / d) * k})`);
}
setInterval(eyeLook, 120);
function eyeBreath() {
  const dial = $('#dial'); if (!dial || !S) return;
  const b = dial.classList.contains('urgent') ? '0.8s' : dial.classList.contains('half') ? '2s' : S.phase === 'night' ? '5s' : '4s';
  if (dial.style.getPropertyValue('--breath') !== b) dial.style.setProperty('--breath', b);
}
setInterval(eyeBreath, 500);
(function blinkLoop() {
  setTimeout(() => {
    const e = $('#eye'); const dial = $('#dial');
    if (e && S && S.phase !== 'lobby' && !document.hidden) {
      e.classList.add('blink'); dial.classList.add('blinking');
      setTimeout(() => { e.classList.remove('blink'); dial.classList.remove('blinking'); }, 140);
    }
    blinkLoop();
  }, 4000 + Math.random() * 5000);
})();
function eyeSpeak() {
  const dial = $('#dial'); if (!dial) return;
  dial.classList.remove('speak'); void dial.offsetWidth; dial.classList.add('speak');
  setTimeout(() => dial.classList.remove('speak'), 1500);
}

// 손패 카드: 마우스 위치에 따라 3D로 기울고 광택이 따라온다
document.addEventListener('pointermove', (e) => {
  if (drag && drag.active) return;
  const c = e.target.closest && e.target.closest('#fan .card');
  if (!c) return;
  const r = c.getBoundingClientRect();   // 떠오른 뒤의 카드 기준
  const x = (e.clientX - r.left) / r.width; const y = (e.clientY - r.top) / r.height;
  c.style.setProperty('--ry', `${(x - 0.5) * 18}deg`);
  c.style.setProperty('--rx', `${(0.5 - y) * 18}deg`);
  c.style.setProperty('--mx', `${x * 100}%`);
  c.style.setProperty('--my', `${y * 100}%`);
});

// ---------------------------------------------------------------------
// 왼쪽 아래: 손패 부채꼴 (회사 카드 + 예약 안 한 인물 카드)
// ---------------------------------------------------------------------
// 카드 그림 (public/img/cards/<카드id>.webp 등). 서버가 있는 파일 목록을 알려준다
let cardArt = {};
const loadCardArt = () => fetch('card-art.json').then((r) => r.json()).then((m) => { cardArt = m || {}; if (S) render(); }).catch(() => {});
loadCardArt();
const artUrl = (defId) => (cardArt[defId] ? `img/cards/${cardArt[defId]}` : null);
// 카드 위에는 짧은 아이콘 표기, 자세한 설명은 마우스를 올렸을 때 (title)
function abShort(a) {
  const pct = (r) => `${Math.round(r * 100)}%`;
  switch (a.key) {
    case 'attack': return `${a.power}${a.pierce ? ' 관통' : ''}${a.overwhelm ? ' 압도' : ''}`;
    case 'defend': return `${a.power}`;
    case 'heal': return `+${a.power}`;
    case 'armor': return '+1';
    case 'investigate': return a.full ? '전부' : ['', '조사', '조사+', '조사++'][a.grade] || '조사';
    case 'firewall': return '방화벽';
    case 'snoop': return `정보×${a.count || 1}`;
    case 'marketPeek': return '경매';
    case 'wiretap': return `${a.lines || 2}줄`;
    case 'expose': return '폭로';
    case 'disguise': return `위장${a.level >= 3 ? ' 상' : ''}`;
    case 'escrow': return '에스크로';
    case 'bribe': return `×${a.mult}`;
    case 'forgery': return '위조';
    case 'cookBooks': return '장부';
    case 'counterTrace': return '역추적';
    case 'extraUses': return `+${a.bonus}`;
    case 'sabotage': return '회사';
    case 'emp': return 'EMP';
    case 'destroyCard': return '카드';
    case 'steal': return pct(a.rate);
    case 'snatchCard': return '카드';
    case 'voteWeight': return `×${a.weight}`;
    case 'voteBlock': return '무효';
    case 'voteWatch': return '감시';
    case 'commission': return pct(a.rate);
    case 'embezzle': return pct(a.rate);
    case 'tieBreak': return '동률';
    default: return a.label;
  }
}
const abHtml = (a) => `${ic(a.key)}<b>${esc(abShort(a))}</b>`;

function cardHtml(c, extraCls = '') {
  const art = artUrl(c.defId);
  const tip = esc(c.abilities.map((a) => a.label).join('\n'));
  const abs = `<div class="card-ab short">${c.abilities.map((a) => `<span>${abHtml(a)}</span>`).join('')}</div>`;
  if (art) {
    return `<div class="card has-art fam-${c.family} t${c.tier} ${extraCls}" data-uid="${c.uid}" style="--a:${c._a}" title="${tip}">
    <div class="card-art" style="background-image:url('${art}')"><div class="card-top">${FAM_ICON[c.family]} ${'★'.repeat(c.tier)}</div></div>
    <div class="card-name">${esc(c.name)}</div>
    ${abs}
  </div>`;
  }
  return `<div class="card fam-${c.family} t${c.tier} ${extraCls}" data-uid="${c.uid}" style="--a:${c._a}" title="${tip}">
    <div class="card-top">${FAM_ICON[c.family]} ${'★'.repeat(c.tier)}</div>
    <div class="card-name">${esc(c.name)}</div>
    ${abs}
  </div>`;
}

function renderFan() {
  const reserved = new Set(S.me.reservations.cards.map((c) => c.cardUid));
  const cards = S.me.hand.filter((c) => !reserved.has(c.uid) || S.phase !== 'day');
  // 인물 카드가 4장을 넘으면 5번째부터 뒷줄 (위로 올려서 그림·이름이 보이게)
  const FRONT = 2;   // 앞줄 = 회사 카드 + 인물 카드 2장, 나머지는 뒷줄
  const front = cards.slice(0, FRONT); const back = cards.slice(FRONT);
  const total = front.length + 1;                      // +1 = 회사 카드
  const spread = Math.min(56, 13 * (total - 1));
  const angle = (i) => (total === 1 ? 0 : -4 + (spread * i) / (total - 1));   // 펼쳐도 왼쪽 화면 밖으로 안 나가게
  const bspread = Math.min(44, 12 * Math.max(0, back.length - 1));
  const bangle = (i) => (back.length <= 1 ? 6 : 2 + (bspread * i) / (back.length - 1));
  const c = S.me.reservations.company;

  const ci = coInfo(S.me.company);
  const companyCard = `<div class="card company" data-company="1" style="--a:${angle(0)};--cc:${TAG_COLOR[S.me.company]}" title="사람에게 끌어다 놓기 — 자원 · 송금 · ${esc(ci.special)}">
    <div class="card-top">${esc(companyShort(S.me.company))}</div>
    <div class="co-big">${coLogo(S.me.company)}</div>
    <div class="co-acts"><span>${ic('credit')}</span><span>${ic('transfer')}</span><span>${ci.icon}</span></div>
    <div class="card-foot">${S.phase === 'day' ? (S.me.sabotaged ? '<span class="sab">⛔</span>' : !c ? '' : c.type === 'resource' ? `${ic('credit')} ₵${won(S.me.resourceGain)}` : c.type === 'transfer' ? `${ic('transfer')} ${esc(nameOf(c.targetId))}` : `${ci.icon}${c.targetId && c.targetId !== myId ? ` ${esc(nameOf(c.targetId))}` : ''}`) : ''}</div>
  </div>`;
  const slot = (a, html, cls = '') => `<div class="fan-slot ${cls}" style="--a:${a}">${html}</div>`;
  const cardSlot = (card, a, cls) => {
    card._a = a;
    const picked = pick && pick.kind === 'card' && pick.card.uid === card.uid;
    return slot(a, cardHtml(card, picked ? 'picked' : ''), cls);
  };
  // 오늘 카드 사용 수 (예약한 수 / 오늘 최대)
  const used = S.me.reservations.cards.length + (S.me.reservations.company ? 1 : 0); const max = S.maxCardsPerDay || 2;
  const uses = S.phase === 'day' && S.me.alive
    ? `<div class="fan-uses" title="오늘 쓸 수 있는 카드 수 (회사 카드 포함)">${ic('card')} ${'●'.repeat(Math.min(used, max))}${'○'.repeat(Math.max(0, max - used))}</div>` : '';
  $('#fan').classList.toggle('two-rows', back.length > 0);
  $('#fan').innerHTML = uses + back.map((c, i) => cardSlot(c, bangle(i), 'back')).join('')
    + slot(angle(0), companyCard) + front.map((c, i) => cardSlot(c, angle(i + 1), '')).join('');

  $('#fan').querySelectorAll('.card').forEach((el) => {
    el.onclick = () => {
      if (justDragged) return;                 // 드래그 직후의 클릭은 무시
      el.dataset.company ? onCompanyCardClick() : onCardClick(el.dataset.uid);
    };
    if (el.dataset.company) {
      el.onpointerdown = (e) => {
        if (e.button !== 0) return;
        drag = { kind: 'company', x0: e.clientX, y0: e.clientY, active: false, srcEl: el };
      };
    } else {
      el.onpointerdown = (e) => {
        if (e.button !== 0) return;
        const card = S.me.hand.find((c) => c.uid === el.dataset.uid);
        if (card) drag = { kind: 'card', card, x0: e.clientX, y0: e.clientY, active: false, srcEl: el };
      };
    }
  });
}

// ---------------------------------------------------------------------
// 드래그: 손패 카드 → 대상 자리 / 엎어둔 카드 → 손패(회수)
//   pointerdown 에서 "잡을 준비", 6px 이상 움직이면 드래그 시작, pointerup 에서 놓은 곳 판정
// ---------------------------------------------------------------------
let justDragged = false;

function bindChipDrag(root) {
  root.querySelectorAll('.chip[data-uid]').forEach((chip) => {
    chip.onpointerdown = (e) => {
      if (e.button !== 0 || S.phase !== 'day') return;
      e.stopPropagation();
      drag = { kind: 'chip', uid: chip.dataset.uid, x0: e.clientX, y0: e.clientY, active: false, srcEl: chip };
    };
  });
}

function makeGhost(html) {
  const g = document.createElement('div');
  g.className = 'drag-ghost';
  g.innerHTML = html;
  document.body.appendChild(g);
  return g;
}

function seatUnder(x, y) {
  const el = document.elementFromPoint(x, y);
  const seat = el && el.closest('.seat, .me-seat');
  return seat ? S.players.find((p) => p.id === seat.dataset.id) : null;
}

document.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.active) {
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
    if (drag.kind === 'card' && !canPlayCards()) {
      toast(overLimit() ? '손패 한도 초과 — 먼저 정리하세요.' : '카드는 낮에만 쓸 수 있습니다.', 'error');
      drag = null;
      return;
    }
    if (drag.kind === 'company' && !companyDropOk(S.me)) {
      toast(S.me.sabotaged ? '사보타주로 오늘은 회사 카드를 쓸 수 없습니다.' : '회사 카드는 낮에 사용합니다.', 'error');
      drag = null;
      return;
    }
    drag.active = true;
    Sound.sfx('pickup');
    pick = null; popupMode = null; dropTarget = null;
    drag.srcEl.classList.add('drag-src');
    drag.ghost = makeGhost(drag.kind === 'card'
      ? cardHtml({ ...drag.card, _a: 0 })
      : drag.kind === 'company' ? drag.srcEl.outerHTML.replace('style="', 'style="--a:0;')
      : '<div class="chip big"></div>');
    document.body.classList.add('dragging');
    $('#fan').classList.toggle('drop-zone', drag.kind === 'chip');
    renderSeats(); renderMe(); renderBanner();
  }
  drag.ghost.style.left = e.clientX + 'px';
  drag.ghost.style.top = e.clientY + 'px';
  // 놓을 수 있는 자리 위에 있으면 강조
  document.querySelectorAll('.drop-hover').forEach((el) => el.classList.remove('drop-hover'));
  if (drag.kind === 'card' || drag.kind === 'company') {
    const p = seatUnder(e.clientX, e.clientY);
    if (p && (drag.kind === 'card' ? cardOk(drag.card, p) : companyDropOk(p))) {
      const el = p.id === myId ? $('#meSeat') : document.querySelector(`.seat[data-id="${p.id}"]`);
      if (el) el.classList.add('drop-hover');
    }
  }
});

document.addEventListener('pointerup', (e) => {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (!d.active) return;                       // 거의 안 움직였으면 클릭으로 처리
  justDragged = true;
  setTimeout(() => { justDragged = false; }, 0);
  d.ghost.remove();
  document.body.classList.remove('dragging');
  $('#fan').classList.remove('drop-zone');
  document.querySelectorAll('.drop-hover').forEach((el) => el.classList.remove('drop-hover'));

  if (d.kind === 'chip') {
    const overFan = document.elementFromPoint(e.clientX, e.clientY)?.closest('#fan');
    if (overFan) cancelReserve(d.uid);
    return render();
  }
  const p = seatUnder(e.clientX, e.clientY);
  if (d.kind === 'company') {
    if (!companyDropOk(p)) return render();
    // 놓은 자리 옆에 선택지: 나 = 자원 / 능력, 다른 사람 = 송금 / 능력
    dropTarget = p.id; popupMode = 'company'; newsOpen = false; pick = null;
    Sound.sfx('drop');
    return render();
  }
  if (!p || !cardOk(d.card, p)) { Sound.sfx('drop'); return render(); }   // 엉뚱한 곳에 놓으면 손패로 돌아감
  dropCardOn(d.card, p);
});

function dropCardOn(card, p) {
  // 나에게 놓았을 때도 "다른 사람에게 쓰는 능력"을 보여준다 (고르면 대상 고르기로)
  const usable = card.abilities.filter((ab) => abilityOk(ab, p) || (p.id === myId && ab.target === 'other'));
  const canPierce = S.me.passiveUses.pierce !== undefined && usable.some((a) => a.key === 'attack' && !a.pierce);
  dropTarget = p.id;
  if (usable.length > 1 || canPierce) {        // 고를 게 있으면 능력 선택 창
    popupMode = 'ability';
    abilityCard = card;
    $('#pierceCheck').checked = false;
    return render();
  }
  chooseAbility(card, usable[0]);
}

function onCompanyCardClick() {
  if (S.phase !== 'day' || !S.me.alive) return toast('회사 카드는 낮에 사용합니다.', 'error');
  // 클릭으로는 열지 않는다: 사람에게 끌어다 놓아야 함
  const el = document.querySelector('#fan .card.company');
  if (el) { el.classList.remove('nudge'); void el.offsetWidth; el.classList.add('nudge'); }
  toast('회사 카드를 사람에게 끌어다 놓으세요', 'info');
  return;
  render();
}

function onCardClick(uid) {
  if (!canPlayCards()) {
    return toast(overLimit() ? '손패 한도 초과 — 먼저 정리하세요.' : '카드는 낮에만 예약할 수 있습니다.', 'error');
  }
  const card = S.me.hand.find((c) => c.uid === uid);
  if (pick && pick.kind === 'card' && pick.card.uid === uid) { pick = null; return render(); }
  const canPierce = S.me.passiveUses.pierce !== undefined && card.abilities.some((a) => a.key === 'attack' && !a.pierce);
  if (card.abilities.length > 1 || canPierce) {
    popupMode = 'ability';
    abilityCard = card;
    $('#pierceCheck').checked = false;
    return render();
  }
  chooseAbility(card, card.abilities[0]);
}

function chooseAbility(card, ability) {
  const usePierce = popupMode === 'ability' && ability.key === 'attack' && !ability.pierce && $('#pierceCheck').checked;
  popupMode = null;
  if (ability.chooseCompany) {               // 위조 신분증: 어느 소속으로 위조할지 먼저 고른다
    popupMode = 'forgery';
    abilityCard = card;
    forgeryAbility = ability;
    return render();
  }
  if (ability.target === 'self') {
    dropTarget = null;
    reserve(card, ability.key, myId);
    return render();
  }
  if (dropTarget === myId && ability.target === 'other') dropTarget = null;   // 나에게 놓고 공격을 고름 → 대상 고르기
  if (dropTarget) {                          // 드래그로 이미 대상을 정했으면 바로 예약
    const targetId = dropTarget;
    dropTarget = null;
    reserve(card, ability.key, targetId, { usePierce });
    return render();
  }
  pick = { kind: 'card', card, ability, usePierce };
  render();
}

// ---------------------------------------------------------------------
// 카드 사용 창 (능력 선택 / 회사 카드)
// ---------------------------------------------------------------------
function renderPopup() {
  const show = popupMode && S.phase === 'day' && S.me.alive;
  $('#popup').classList.toggle('hidden', !show);
  if (!show) return;
  $('#abilityBox').classList.toggle('hidden', popupMode !== 'ability' && popupMode !== 'forgery');
  $('#companyBox').classList.toggle('hidden', popupMode !== 'company');

  if (popupMode === 'forgery') {
    const card = abilityCard;
    $('#abilityTitle').textContent = `${card.name} → ?`;
    $('#abilityBtns').innerHTML = (S.activeCompanies || Object.keys(CO_SHORT)).map((c) =>
      `<button data-co="${c}" class="co-${c}">${coLogo(c, 'tiny')} ${CO_SHORT[c]}${c === S.me.company ? ' ✔' : ''}</button>`).join('');
    $('#abilityBtns').querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        reserve(card, forgeryAbility.key, myId, { fakeCompany: b.dataset.co });
        popupMode = null;
        render();
      };
    });
    $('#pierceRow').classList.add('hidden');
  } else if (popupMode === 'ability') {
    const card = abilityCard;
    const tgt = dropTarget && S.players.find((x) => x.id === dropTarget);
    $('#abilityTitle').textContent = tgt ? `${card.name} → ${tgt.id === myId ? '나' : tgt.name}` : card.name;
    $('#abilityBtns').innerHTML = card.abilities.map((a, i) => (tgt && !abilityOk(a, tgt) && !(tgt.id === myId && a.target === 'other') ? '' :
      `<button data-i="${i}">${a.target === 'self' ? '👤 ' : ''}${esc(a.label)}</button>`)).join('');
    $('#abilityBtns').querySelectorAll('button').forEach((b) => {
      b.onclick = () => chooseAbility(card, card.abilities[Number(b.dataset.i)]);
    });
    const left = S.me.passiveUses.pierce;
    const showPierce = left !== undefined && card.abilities.some((a) => a.key === 'attack' && !a.pierce);
    $('#pierceRow').classList.toggle('hidden', !showPierce);
    $('#pierceLabel').textContent = `레드라인 방어 관통 사용 (남은 ${left ?? 0}회, 공격에만 적용)`;
  } else {
    const m = S.me;
    const c = m.reservations.company;
    const ci = coInfo(m.company);
    const toMe = dropTarget === myId;
    const tgt = S.players.find((x) => x.id === dropTarget);
    $('#coBoxTitle').innerHTML = `${coLogo(m.company, 'tiny')} → ${toMe ? '나' : esc(tgt ? tgt.name : '?')}${m.sabotaged ? ' <span class="sab">⛔ 정지</span>' : ''}`;
    const spOk = toMe ? ci.target !== 'other' : ci.target !== 'self';
    $('#btnResource').classList.toggle('hidden', !toMe);
    $('#btnTransferPick').classList.toggle('hidden', toMe);
    $('#btnSpecial').classList.toggle('hidden', !spOk);
    const on = (t) => (c && c.type === t ? ' on' : '');
    $('#btnResource').className = 'co-btn' + on('resource') + (toMe ? '' : ' hidden');
    $('#btnTransferPick').className = 'co-btn' + on('transfer') + (toMe ? ' hidden' : '');
    $('#btnSpecial').className = 'co-btn special' + on('special') + (spOk ? '' : ' hidden');
    $('#btnResource').innerHTML = `<b>${ic('credit')}</b><span>자원 +${won(m.resourceGain)}</span>`;
    $('#btnTransferPick').innerHTML = `<b>${ic('transfer')}</b><span>송금 +${won(m.transferGift)}</span>`;
    $('#btnSpecial').innerHTML = `<b>${ci.icon}</b><span>${esc(ci.special)}</span>`;
    $('#btnSpecial').title = '특수능력 · 오늘 수입 없음';
    $('#btnCompanyClear').classList.toggle('hidden', !c);
    ['#btnResource', '#btnTransferPick', '#btnSpecial'].forEach((id) => { $(id).disabled = m.sabotaged; });
    $('#newsBox').classList.toggle('hidden', !(ci.fake && newsOpen));
    const FK = { attack: ['attack', '공격'], defend: ['defend', '방어'], money: ['credit', '돈'], intel: ['investigate', '정보'] };
    $('#newsBox').querySelectorAll('[data-fake]').forEach((b) => { b.innerHTML = `${ic(FK[b.dataset.fake][0])} ${FK[b.dataset.fake][1]}`; });
  }
  placePopup();
}

// 카드 사용 창 위치: 놓은 대상 옆에, 없으면 무대 가운데 (왼쪽 아바타를 가리지 않게)
function placePopup() {
  const pop = $('#popup');
  const stage = $('#stage').getBoundingClientRect();
  const anchor = dropTarget && (dropTarget === myId ? $('#meSeat') : document.querySelector(`.seat[data-id="${dropTarget}"]`));
  const w = pop.offsetWidth, h = pop.offsetHeight;
  let x, y;
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    x = r.right + 14 - stage.left;
    if (x + w > stage.width - 8) x = r.left - 14 - w - stage.left;     // 오른쪽 자리가 없으면 왼쪽
    y = r.top + r.height / 2 - h / 2 - stage.top;
  } else {
    x = stage.width / 2 - w / 2;
    y = stage.height * 0.46 - h / 2;
  }
  pop.style.left = Math.max(8, Math.min(stage.width - w - 8, x)) + 'px';
  pop.style.top = Math.max(8, Math.min(stage.height - h - 8, y)) + 'px';
  pop.style.bottom = 'auto';
}
$('#btnPopupClose').onclick = () => { newsOpen = false; popupMode = null; dropTarget = null; transferTarget = null; render(); };
$('#btnResource').onclick = async () => {
  const r = await act('setCompany', { type: 'resource' });
  if (!r.ok) { popupMode = null; dropTarget = null; render(); return failAt(myId, r.error); }
  if (r.ok) { popupMode = null; dropTarget = null; selfFx(ic('credit'), '#FFB627'); render(); }
};
$('#btnCompanyClear').onclick = () => act('clearCompany');
// 회사 특수능력: 대상이 필요하면 고르기, 나에게만이면 바로, 네온캐스트는 문장 입력
$('#btnSpecial').onclick = async () => {
  const ci = coInfo(S.me.company);
  if (ci.fake) { newsOpen = true; render(); return; }
  const tid = ci.target === 'self' ? myId : dropTarget;
  const r = await act('setCompany', { type: 'special', targetId: tid });
  if (!r.ok) { popupMode = null; dropTarget = null; render(); return failAt(tid, r.error); }
  popupMode = null; dropTarget = null; Sound.sfx('lock'); render();
  if (tid === myId) selfFx(ci.icon, TAG_COLOR[S.me.company]); else stampAt(tid, ci.icon, TAG_COLOR[S.me.company]);
};
// 네온캐스트: 가짜 밤 장면 분야 고르기
document.querySelectorAll('#newsBox [data-fake]').forEach((b) => {
  b.onclick = async () => {
    const r = await act('setCompany', { type: 'special', fakeKind: b.dataset.fake });
    if (!r.ok) return failAt(myId, r.error);
    newsOpen = false; popupMode = null; dropTarget = null; selfFx(ic('news'), TAG_COLOR[S.me.company]); render();
  };
});
$('#btnTransferPick').onclick = async () => {
  const tid = dropTarget;
  if (!tid || tid === myId) return;
  const r = await act('setCompany', { type: 'transfer', targetId: tid });
  if (!r.ok) { popupMode = null; dropTarget = null; render(); return failAt(tid, r.error); }
  if (r.ok) { popupMode = null; dropTarget = null; Sound.sfx('lock'); render(); stampAt(tid, ic('transfer'), '#FFB627'); }
};

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !S) return;
  pick = null; popupMode = null; drawerOpen = false; dropTarget = null; transferTarget = null;
  $('#rulesOverlay').classList.add('hidden');
  closeTagMenu();
  render();
});

// ---------------------------------------------------------------------
// 카드 구매 턴 (스케치 2)
// ---------------------------------------------------------------------
function slotHtml(s, result) {
  const myBid = S.me.myBids[s.id] || 0;
  const draft = bidDrafts[s.id] ?? myBid;
  const front = s.card ? `<div class="card-top">${FAMILY_LABEL[s.card.family]} ${'★'.repeat(s.card.tier)}</div>
      <div class="card-name">${esc(s.card.name)}</div>
      <div class="card-ab">${s.card.abilities.map((a) => esc(a.label)).join('<br>')}</div>
      <div class="card-foot">낙찰 ${won(s.price)}</div>` : '';
  const flipped = s.wonByMe && result;
  return `<div class="slot fam-${s.family} ${s.tier ? `t${s.tier}` : ''} ${s.sold ? 'sold' : ''} ${flipped ? 'flipped' : ''}">
    <div class="slot-card">
      ${s.sold && !s.wonByMe ? `<div class="slot-sold">팔림 ${won(s.price)}</div>` : ''}
      ${!s.sold && result ? '<div class="slot-sold">유찰</div>' : ''}
      <div class="slot-inner">
        <div class="slot-face slot-back">
          <div class="slot-icon fam-${s.family}">${FAM_ICON[s.family]}</div>
          <div class="slot-family fam-${s.family}">${FAMILY_LABEL[s.family]}</div>
          ${s.peek ? `<div class="slot-peek" title="${esc(s.peek.abilities.join(' / '))}">👁 ${esc(s.peek.name)}${s.tier ? ` ${'★'.repeat(s.tier)}` : ''}</div>` : ''}
        </div>
        <div class="slot-face slot-front ${s.card ? `fam-${s.card.family}` : ''}">${front}</div>
      </div>
    </div>
    ${result ? `<div class="bid-mine">${s.wonByMe ? '🎉 낙찰!' : ''}</div>` : `
    <div class="bid-step ${draft ? 'on' : ''}" title="▲▼ 100 · Shift 1,000">
      <button class="bs-btn" data-step="${s.id}" data-d="-1" ${draft ? '' : 'disabled'} aria-label="100 내리기">▼</button>
      <b class="bs-val">${draft ? `₵${won(draft)}` : `<small>₵${won(S.auctionMinBid || 0)}~</small>`}</b>
      <button class="bs-btn" data-step="${s.id}" data-d="1" aria-label="100 올리기">▲</button>
    </div>`}
    ${slotTip(s)}
  </div>`;
}

function renderShop() {
  const result = Date.now() < shopResultUntil && S.phase === 'day';   // 낙찰 결과는 낮 시작 직후에만
  const show = (S.phase === 'shop' && S.me.alive) || result;
  $('#shop').classList.toggle('hidden', !show);
  if (!show) return;
  const m = S.me;
  const auction = result ? lastAuction : S.auction;
  $('#shopLogo').innerHTML = coLogo(m.company) || '?';
  $('#shopLogo').className = `co-logo co-${m.company}`;
  $('#shopDay').textContent = result ? '— 경매 결과' : `— ${S.day}일차`;
  document.querySelector('.time-bar').classList.toggle('hidden', result);

  $('#auctionRow').innerHTML = auction.map((s) => slotHtml(s, result)).join('');
  $('#auctionRow').querySelectorAll('button[data-step]').forEach((b) => {
    b.onclick = (e) => stepBid(b.dataset.step, Number(b.dataset.d) * (e.shiftKey ? 1000 : 100));
  });

  const rLeft = (S.randomBuyLimit || 3) - (m.randomBuys || 0);
  $('#randomPrice').innerHTML = `${isArmed('random') ? '✔ ' : ''}₵${won(S.randomPrice)}<small>${Math.max(0, rLeft)}/${S.randomBuyLimit || 3}</small>`;
  $('#btnRandom').classList.toggle('armed', isArmed('random'));
  $('#btnRandom').disabled = result || m.credits < S.randomPrice || rLeft <= 0;

  const over = m.hand.length > m.handLimit;
  $('#shopHandInfo').innerHTML = `🂠 ${m.hand.length}/${m.handLimit}${over ? `<span class="over"> ⚠ ${m.hand.length - m.handLimit}장 초과</span>` : ''}`;
  $('#shopHand').innerHTML = m.hand.map((c) => `<div class="mini-card fam-${c.family} t${c.tier} ${knownHand.has(c.uid) ? '' : 'new'}">
      <span class="muted">${FAM_ICON[c.family]} ${'★'.repeat(c.tier)}</span>
      <b title="${esc(c.abilities.map((a) => a.label).join('\n'))}">${esc(c.name)}</b>
      ${result ? '' : sellBtn(c)}
    </div>`).join('') || '<span class="muted">손패 없음</span>';
  bindSellButtons($('#shopHand'));

  $('#shopMoney').innerHTML = `₵${won(m.credits)}${m.lockedCredits ? `<span class="muted">🔒 ₵${won(m.lockedCredits)}</span>` : ''}`;
  const me = S.players.find((p) => p.id === myId);
  const alive = S.players.filter((p) => p.alive);
  const btn = $('#btnShopReady');
  btn.classList.toggle('hidden', result);
  btn.textContent = me && me.ready
    ? `✔ ${alive.filter((p) => p.ready).length}/${alive.length}`
    : '완료';
  btn.className = me && me.ready ? 'on' : 'primary';
}

// 판매/버리기 버튼: 판매가 0이면 "버리기"로 표시. 둘 다 두 번 눌러야 실행
function sellBtn(c, withDiscard = false) {
  const sk = `sell:${c.uid}`; const dk = `discard:${c.uid}`;
  const sell = c.sellPrice > 0
    ? `<button data-sell="${c.uid}" class="${isArmed(sk) ? 'armed' : ''}" title="판매 (두 번 누르기)">${isArmed(sk) ? '한 번 더' : `판매 ₵${won(c.sellPrice)}`}</button>`
    : `<button data-discard="${c.uid}" class="ghost-btn ${isArmed(dk) ? 'armed' : ''}" title="판매가 0 · 두 번 누르기">${isArmed(dk) ? '한 번 더' : '버리기'}</button>`;
  const discard = withDiscard && c.sellPrice > 0
    ? `<button data-discard="${c.uid}" class="ghost-btn ${isArmed(dk) ? 'armed' : ''}" title="두 번 누르기">${isArmed(dk) ? '한 번 더' : '버리기'}</button>` : '';
  return sell + discard;
}
function bindSellButtons(root) {
  root.querySelectorAll('button[data-sell]').forEach((b) => {
    b.onclick = () => confirmThen(`sell:${b.dataset.sell}`, () => act('sellCard', { cardUid: b.dataset.sell }));
  });
  root.querySelectorAll('button[data-discard]').forEach((b) => {
    b.onclick = () => confirmThen(`discard:${b.dataset.discard}`, () => act('discardCard', { cardUid: b.dataset.discard }).then((r) => r.ok && Sound.sfx('cancel')));
  });
}

// 경매 카드 호버: 이 계열·등급에서 나올 수 있는 카드 후보 (정체는 비밀)
function slotTip(s) {
  if (s.peek) return `<div class="slot-tip"><b>👁 ${esc(s.peek.name)}</b><div>${s.peek.abilities.map(esc).join('<br>')}</div></div>`;
  const cands = (S.cardCatalog || []).filter((c) => c.family === s.family);
  if (!cands.length) return '';
  return `<div class="slot-tip"><b>${FAM_ICON[s.family]} ${FAMILY_LABEL[s.family]} ?</b>
    ${cands.map((c) => `<div><i>${esc(c.name)}</i></div>`).join('')}</div>`;
}

// ▲▼로 입찰액 조절: 화면에는 바로 반영, 서버에는 잠깐(0.3초) 멈춘 뒤 보냄 → 연타해도 한 번만 전송
// 보낸 금액이 곧 입찰 (마감 때 그대로 적용). 돈이 모자라면 서버가 거절 → 원래 금액으로 되돌림
const bidTimers = {};
function stepBid(slotId, delta) {
  const cur = bidDrafts[slotId] ?? (S.me.myBids[slotId] || 0);
  const others = Object.entries(S.me.myBids).filter(([id]) => id !== slotId).reduce((a, [, v]) => a + v, 0);
  const max = Math.floor((S.me.credits + S.me.lockedCredits - others) / 100) * 100;
  const minBid = S.auctionMinBid || 0;
  let next = Math.max(0, Math.min(max, cur + delta));
  if (next > 0 && next < minBid) next = delta > 0 ? minBid : 0;     // 최저가 아래로는 0(입찰 안 함)으로
  if (next > max) next = cur;
  if (next === cur) { if (delta > 0) { toast('크래딧이 부족합니다', 'error'); } return; }
  bidDrafts[slotId] = next;
  Sound.sfx(delta > 0 ? 'tick' : 'cancel');
  renderShop();
  clearTimeout(bidTimers[slotId]);
  bidTimers[slotId] = setTimeout(async () => {
    const res = await act('bid', { slotId, amount: bidDrafts[slotId] });
    delete bidDrafts[slotId];
    if (S && S.phase === 'shop') renderShop();
    if (!res.ok) render();
  }, 300);
}
$('#btnRandom').onclick = () => confirmThen('random', () => act('buyRandom'));
$('#btnShopReady').onclick = () => act('ready', { phase: S.phase });

// ---------------------------------------------------------------------
// 손패 한도 초과 정리 (낮)
// ---------------------------------------------------------------------
function renderCleanup() {
  const show = S.phase === 'day' && S.me.alive && overLimit() && Date.now() >= shopResultUntil;
  $('#cleanup').classList.toggle('hidden', !show);
  if (!show) return;
  const m = S.me;
  $('#cleanup').innerHTML = `<div class="cleanup-box">
    <h3>손패 한도 초과 — ${m.hand.length - m.handLimit}장 정리</h3>
    <p class="muted small">오늘 한도는 ${m.handLimit}장입니다. 팔거나 버려야 카드를 쓸 수 있습니다. (채팅은 계속 가능)</p>
    <div class="shop-hand">${m.hand.map((c) => `<div class="mini-card t${c.tier}">
      <span class="muted">${FAMILY_LABEL[c.family]} ${'★'.repeat(c.tier)}</span><b>${esc(c.name)}</b>
      ${c.abilities.map((a) => esc(a.label)).join(' / ')}
      ${sellBtn(c, true)}</div>`).join('')}</div>
  </div>`;
  bindSellButtons($('#cleanup'));
}

// ---------------------------------------------------------------------
// 토스트
// ---------------------------------------------------------------------
function toast(text, kind = '') {
  Sound.sfx(kind === 'error' ? 'error' : kind === 'whisper' ? 'ping'
    : kind === 'ok' ? (/^[↩🗑]/u.test(text) ? 'cancel' : /^✔/.test(text) ? 'lock' : 'notify') : 'notify');
  const el = document.createElement('div');
  el.className = `toast t-${kind}`;
  el.textContent = text;
  $('#toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), 4200);
  setTimeout(() => el.remove(), 4800);
}

// ---------------------------------------------------------------------
// 채팅
// ---------------------------------------------------------------------
function whisperUnread(id) {
  const list = S.chat.whispers[[myId, id].sort().join('|')] || [];
  return list.slice(seenWhisper[id] || 0).filter((m) => m.from !== myId).length;
}
const NB_ICON = { out: '▶', in: '◀' };
const INTEL_KINDS = ['intel', 'deceit'];

function notebookHtml() {
  const notes = S.me.notebook.filter((n) => {
    if (nbFilter === 'out') return n.dir === 'out';
    if (nbFilter === 'in') return n.dir !== 'out' && !['company', 'perk'].includes(n.kind);
    if (nbFilter === 'intel') return INTEL_KINDS.includes(n.kind) || (n.kind === 'politics' && n.text.startsWith('개표'));
    return true;
  });
  const days = [...new Set(notes.map((n) => n.day))].sort((a, b) => b - a);
  const chips = [['all', '전체'], ['out', '▶ 내가 한 일'], ['in', '◀ 나에게 온 일'], ['intel', '정보 결과']]
    .map(([k, l]) => `<button class="nbchip ${nbFilter === k ? 'on' : ''}" data-nb="${k}">${l}</button>`).join('');
  const archives = Object.keys(nightArchive).map(Number).sort((a, b) => b - a)
    .map((d) => `<button class="nbchip night" data-arch="${d}">🌙 ${d}일차 밤 다시 보기</button>`).join('');
  return `<li class="nb-head">${chips}${archives ? `<div class="nb-arch">${archives}</div>` : ''}</li>`
    + (days.map((d) => `<li class="nb-day">${d}일차</li>` + notes.filter((n) => n.day === d).reverse().map((n) =>
      `<li class="nb-item nb-${n.kind} dir-${n.dir || 'in'}"><span class="nb-dir">${NB_ICON[n.dir] || '◀'}</span>${esc(n.text)}</li>`).join('')).join('')
      || '<li class="muted">아직 기록이 없습니다.</li>');
}

function renderChat() {
  const inGame = S.phase !== 'lobby' && S.phase !== 'ended';
  const ghost = inGame && !S.me.alive;
  const others = S.players.filter((p) => p.id !== myId && p.alive);
  if (inGame && !ghost) {
    if (!others.some((p) => p.id === whisperTo)) {
      const withUnread = others.find((p) => whisperUnread(p.id));
      whisperTo = withUnread ? withUnread.id : (others[0] ? others[0].id : '');
    }
    // 지금 보고 있는 대화는 배지를 세기 전에 먼저 읽음 처리 (안 그러면 "새 메시지"가 남는다)
    if (chatTab === 'whisper' && whisperTo) seenWhisper[whisperTo] = (S.chat.whispers[[myId, whisperTo].sort().join('|')] || []).length;
  }
  const wUnread = others.reduce((n, p) => n + whisperUnread(p.id), 0);
  const nbUnread = S.me ? S.me.notebook.length - seenNotes : 0;
  const tabs = ghost ? [['ghost', '유령'], ['public', '공개'], ['allWhisper', '귓속말 전체'], ['notebook', '수첩']]
    : inGame ? [['public', '공개'], ['whisper', '귓속말'], ['notebook', '수첩']] : [['public', '공개']];
  if (!tabs.some(([k]) => k === chatTab)) chatTab = tabs[0][0];
  const badge = (k) => (k === 'whisper' && wUnread ? `<i class="tbadge">${wUnread}</i>`
    : k === 'notebook' && nbUnread > 0 && chatTab !== 'notebook' ? `<i class="tbadge">${nbUnread}</i>` : '');

  $('#chatTabs').innerHTML = tabs.map(([k, label]) =>
    `<button class="tab ${k === chatTab ? 'on' : ''}" data-tab="${k}">${label}${badge(k)}</button>`).join('');
  $('#chatTabs').querySelectorAll('.tab').forEach((b) => {
    b.onclick = () => { chatTab = b.dataset.tab; renderChat(); if (S.phase !== 'lobby') { renderInfo(); renderSeats(); } };
  });

  $('#whisperBar').classList.toggle('hidden', chatTab !== 'whisper');
  $('#chatForm').classList.toggle('hidden', chatTab === 'notebook' || chatTab === 'allWhisper' || (ghost && chatTab === 'public'));
  $('#sysToggle')?.classList.toggle('hidden', chatTab !== 'public');
  if (chatTab === 'whisper') {
    // 받는 사람: 드롭다운 대신 이름 버튼. 고른 사람은 금색으로 계속 표시된다.
    $('#whisperChips').innerHTML = others.map((p) => {
      const u = p.id === whisperTo ? 0 : whisperUnread(p.id);
      return `<button type="button" class="wchip ${p.id === whisperTo ? 'on' : ''}" data-wto="${p.id}">${esc(p.name)}${u ? `<i class="tbadge">${u}</i>` : ''}</button>`;
    }).join('') || '<span class="muted small">귓속말할 상대가 없습니다</span>';
    $('#whisperChips').querySelectorAll('[data-wto]').forEach((b) => {
      b.onclick = () => { whisperTo = b.dataset.wto; renderChat(); renderSeats(); $('#chatInput').focus(); };
    });
  }

  const log = $('#chatLog');
  if (chatTab === 'notebook') {
    seenNotes = S.me.notebook.length;
    log.classList.add('nb');
    log.innerHTML = notebookHtml();
    log.querySelectorAll('[data-nb]').forEach((b) => { b.onclick = () => { nbFilter = b.dataset.nb; renderChat(); }; });
    log.querySelectorAll('[data-arch]').forEach((b) => { b.onclick = () => { archiveOpen = Number(b.dataset.arch); renderCenterBox(); }; });
    $('#nbBadge') && $('#nbBadge').classList.add('hidden');
    return;
  }
  log.classList.remove('nb');
  let msgs = [];
  if (chatTab === 'public') msgs = hideSys ? S.chat.public.filter((m) => !m.system) : S.chat.public;
  else if (chatTab === 'ghost') msgs = S.chat.ghost;
  else if (chatTab === 'allWhisper') {
    // 유령: 모든 귓속말을 시간 순으로 "보낸 사람 → 받는 사람"
    msgs = Object.values(S.chat.whispers).flat().sort((a, b) => a.id - b.id)
      .map((m) => ({ ...m, name: `${m.name} → ${nameOf(m.to)}` }));
  }
  else if (whisperTo) {
    msgs = S.chat.whispers[[myId, whisperTo].sort().join('|')] || [];
    seenWhisper[whisperTo] = msgs.length;           // 지금 보고 있으니 읽음 처리
  }
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.innerHTML = (chatTab === 'public' ? `<li class="sys-toggle"><label><input type="checkbox" id="sysCheck" ${hideSys ? 'checked' : ''}> 아비터 방송 숨기기</label></li>` : '')
    + msgs.map((m) => `<li class="${m.system ? 'sys' : ''} ${m.from === myId ? 'mine' : ''}">
      ${m.system ? '' : `<b>${esc(m.name)}</b> `}${esc(m.text)}</li>`).join('');
  const sc = $('#sysCheck');
  if (sc) sc.onchange = () => { hideSys = sc.checked; renderChat(); };
  if (atBottom) log.scrollTop = log.scrollHeight;
  const wName = (S.players.find((p) => p.id === whisperTo) || {}).name;
  $('#chatSend').textContent = chatTab === 'whisper' && wName ? `→ ${wName}` : '전송';
  $('#chatInput').placeholder = chatTab === 'whisper' ? (wName ? `${wName}에게 귓속말 (둘만 보임)` : '받는 사람을 고르세요') : chatTab === 'ghost' ? '유령끼리만 보입니다' : '공개 메시지';
}
$('#chatForm').onsubmit = async (e) => {
  e.preventDefault();
  const text = $('#chatInput').value.trim();
  if (!text) return;
  const res = await send('chat', { channel: chatTab, to: whisperTo, text });
  if (res.ok) $('#chatInput').value = '';
};

// ---------------------------------------------------------------------
// ❔ 규칙 요약 (언제든 열기)
// ---------------------------------------------------------------------
// 투표 주제: 아이콘 · 한 줄 설명
const TOPIC = {
  subsidy:   { icon: 'credit', desc: () => `₵${won(S.votePot)} → 최다 득표자` },
  damage:    { icon: 'attack', desc: () => '최다 득표자 체력 −1 · 생존자 과반 필요 · 방어 불가' },
  fine:      { icon: 'steal', desc: () => `최다 득표자 −₵${won((S.topicInfo && S.topicInfo.amount) || 2000)} → 다음 보조금에 적립` },
  cards:     { icon: 'card', desc: () => `최다 득표자에게 랜덤 카드 ${(S.topicInfo && S.topicInfo.count) || 3}장` },
  revealTop: { icon: 'investigate', desc: () => '찬성이 많으면 크래딧 1위의 이름·금액 공개' },
  equalize:  { icon: 'tieBreak', desc: () => '찬성이 많으면 생존자 크래딧을 똑같이 나눔' },
};
const isYesNo = () => !!(S && S.topicInfo && S.topicInfo.yesno);
const coInfo = (c) => ({ name: COMPANY_FULL[c] || '', special: '', target: 'other', ...((S && S.companyInfo && S.companyInfo[c]) || {}), icon: ic(CO_ICON[c] || 'special') });
function openRules() {
  const cat = (S && S.cardCatalog) || [];
  const fams = ['force', 'intel', 'deceit', 'ops', 'politics'];
  const days = S && S.settings ? S.settings.maxDays : 10;
  const rankDays = [3, 6, 9].filter((d) => d <= days);
  const actCos = S && S.activeCompanies && S.activeCompanies.length ? S.activeCompanies : null;
  $('#rulesOverlay').innerHTML = `<div class="rules-box">
    <button class="box-x" id="btnRulesClose">✕ 닫기</button>
    <h2>규칙 요약</h2>
    <div class="rules-grid">
      <section><h3>목표</h3>
        <p>모두 기업 하나에 <b>비밀 소속</b>됩니다. 같은 회사 동료가 누구인지, 몇 명인지는 모릅니다.</p>
        <p>참가 기업 수는 인원에 따라(4~5명 3곳 · 6~8명 4곳 · 9명 이상 5곳) 5개 중 무작위. <b>어느 회사가 참가했는지는 비밀</b> — 정보 카드로 불참 회사를 알아내면 위쪽 회사 줄에 ✕, 죽거나 폭로된 사람의 회사는 ✔로 표시됩니다.</p>
        <p><b>${days}일째 밤이 끝났을 때 생존 비율(생존자 ÷ 처음 인원)이 가장 높은 기업</b>이 승리. 그 전에 다른 회사 요원이 전부 죽으면 즉시 승리. 동률이면 1인당 평균 자산 = <b>살아있는 요원의 자산 합 ÷ 처음 인원</b> (죽은 사람의 돈은 제외).</p>
        <p>내가 죽어도 우리 회사가 이기면 함께 승리합니다. 크래딧은 카드를 사는 수단입니다.</p></section>
      <section><h3>하루 흐름</h3>
        <p>아침 뉴스 → 토의 → 지원금 투표(토의·투표는 2일차부터) → 암시장 → 낮(협상·예약) → 밤(예약한 행동이 한꺼번에 실행)</p>
        <p>${rankDays.length ? `${rankDays.join('·')}일차 아침에는 크래딧 상위 3명이 공개됩니다.` : ''}</p>
        <p><b>회의 투표</b>(2일차부터): 아침마다 주제가 무작위로 정해집니다 (같은 주제 이틀 연속 없음).<br>
          <b>지원금</b>(가장 자주) 최다 득표자가 보조금 · 어제 받은 사람 제외 · 동률이면 사라짐<br>
          <b>피해 1</b>(3일차부터) 최다 득표자 체력 −1 · <b>생존자 과반</b> 득표 필요 · 방어 불가 (유사체력은 먼저 깨짐)<br>
          <b>벌금</b> 최다 득표자 −₵2,000 → 다음 보조금에 적립 · <b>랜덤 카드 3장</b> 최다 득표자에게<br>
          <b>자본 1위 공개</b>(찬반) · <b>부의 균일화</b>(찬반, 드물게) 생존자 크래딧을 똑같이 나눔 — 찬성이 반대보다 많아야 통과<br>
          나에게 투표해도 됩니다. 누구 투표는 동률이면 무효. 표 배수·블랙리스트·개표 감시·동률 결정권은 모든 주제에, 커미션·횡령은 지원금에만 적용.</p></section>
      <section><h3>체력과 전투</h3>
        <p>체력 ${S.startHp || 3}칸. 0이 되면 사망 — <b>죽은 사람의 소속은 모두에게 공개</b>됩니다. 유령은 유령끼리만 대화하고, 산 사람의 소속·손패·크래딧·놓은 카드·귓속말을 전부 볼 수 있습니다. <b>유령은 산 사람에게 정보를 알려주면 안 됩니다</b> (음성 채팅 포함).</p>
        <p>같은 사람에게 온 공격은 합산하고, 방어만큼 뺀 것이 <b>남은 피해</b>입니다. 관통 공격은 방어를 무시합니다.</p>
        <p><b>남은 피해 1</b> → 손패 1장이 무작위로 파괴 (손패가 없으면 ₵${won(S.noCardPenalty || 1000)} 손실)<br>
           <b>남은 피해 2 이상</b> → 체력 1 감소. 하룻밤에 잃는 건 <b>체력 1 또는 카드 1</b>뿐입니다.<br>
           그래서 체력을 깎으려면 보통 <b>두 명 이상이 같은 사람을 함께</b> 공격해야 합니다.</p>
        <p>예외: 사이보그 용병의 <b>압도</b>가 섞이면 체력 1과 카드 1을 함께 잃습니다.<br>
           <b>◈ 유사체력</b>(장갑 시술사): 가장 먼저 깨집니다. 피해 1이든 2 이상이든 그날 공격을 통째로 막고 사라집니다. 최대 1.</p></section>
      <section><h3>회사 카드 (하루 1회, 셋 중 하나)</h3>
        <p><b>₵ 자원</b> 내가 +₵1,500 · <b>⇄ 송금</b> 상대가 +₵3,000 · <b>★ 특수능력</b> 회사별 (그날 수입 없음, 무제한)</p>
        <p>서로 송금하면 둘 다 ₵3,000. 상대가 배신하면 나는 0. 받은 돈은 다음 날 아침부터. 로비스트 뇌물 = 송금 3배.</p>
        <p>암시장: 경매 5장은 계열별 1장(등급 비공개). 랜덤 카드 하루 3장, ₵1,000 + 매일 250. 경매 최저가 ₵300 + 매일 100.</p></section>
      <section><h3>인물 카드</h3>
        <p>1회용. 대상에게 끌어다 놓기 → 밤에 실행. <b>하루 사용 수 = 회사 카드 포함 2장, 2일마다 +1 (최대 5)</b>. 손패 한도 3장, 매일 +1 (최대 8).</p>
        <p>밤 결과는 사람 옆에 <b>짧은 태그</b>로 붙어 다음 밤까지 남습니다. <span style="color:#5CE1FF">하늘색</span> = 내가 알아낸 정보(나만 보임) · <span style="color:#FF4D6A">빨강</span> = 피해 · <span style="color:#6CFFA8">초록</span> = 방어·회복 · <span style="color:#FFB627">노랑</span> = 돈. 자세한 기록은 오른쪽 "수첩" 탭.</p>
        <p>암시장 경매는 ▲▼로 금액(100 단위, Shift = 1,000)을 정해두면 마감 때 그대로 입찰됩니다.</p></section>
      <section><h3>회사 특수능력</h3>
        ${(actCos || Object.keys(CO_SHORT)).map((c) => `<p class="perk-row">${coLogo(c, 'small')}<span><b style="color:${TAG_COLOR[c]}">${COMPANY_FULL[c]}</b> ${coInfo(c).icon} ${esc(coInfo(c).special)}</span></p>`).join('')}</section>
    </div>
    <h3>카드 목록</h3>
    <div class="rules-cards">${fams.map((f) => `<div class="rc-col"><h4 class="fam-${f}"><span class="card-top">${FAMILY_LABEL[f]}</span></h4>
      ${cat.filter((c) => c.family === f).sort((a, b) => a.tier - b.tier).map((c) => `<div class="rc ${artUrl(c.id) ? 'has-art' : ''}">${artUrl(c.id) ? `<i class="rc-art" style="background-image:url('${artUrl(c.id)}')"></i>` : ''}<div><b>${esc(c.name)}</b> ${'★'.repeat(c.tier)}<br><span>${c.abilities.map(esc).join(' / ')}</span></div></div>`).join('')}</div>`).join('')}</div>
  </div>`;
  $('#rulesOverlay').classList.remove('hidden');
  $('#btnRulesClose').onclick = () => $('#rulesOverlay').classList.add('hidden');
}
$('#btnRules').onclick = openRules;
$('#btnRulesLobby').onclick = openRules;

// 게임 시작: 내 소속 공개 화면 (한 번만)
function renderReveal() {
  const el = $('#reveal');
  const key = `${S.code}-${S.me && S.me.company}`;
  if (S.phase !== 'morning' || S.day !== 1 || revealShown === key) return;
  revealShown = key;
  const c = S.me.company;
  el.innerHTML = `<div class="reveal-box" style="--c:${TAG_COLOR[c]}">
    <p class="muted">아비터 개인 통지</p>
    <div class="reveal-logo">${coLogo(c)}</div>
    <h1>${esc(COMPANY_FULL[c])}</h1>
    <p class="reveal-perk">${coInfo(c).icon} ${esc(coInfo(c).special)}</p></div>`;
  el.classList.remove('hidden');
  Sound.sfx('reveal');
  const hide = () => el.classList.add('hidden');
  el.onclick = hide;
  setTimeout(hide, 6000);
}

// ---------------------------------------------------------------------
// 결과 화면
// ---------------------------------------------------------------------
const KIND_LABEL = {
  attack: '공격', defend: '방어', heal: '치료', transfer: '송금',
  investigate: '조사', snoop: '정보 수집', trace: '추적', wiretap: '도청', expose: '폭로',
  emp: 'EMP', sabotage: '사보타주', steal: '도둑질', destroyCard: '손패 파괴', snatchCard: '손패 빼앗기',
  voteWeight: '표 배수', voteBlock: '투표권 무효', voteWatch: '개표 감시', commission: '커미션', embezzle: '횡령', tieBreak: '동률 결정권',
  newsEdit: '가짜 뉴스', shortSell: '공매도',
};
let endSnap = null;      // 보고서에 쓸 게임 종료 시점 상태

// 결과 화면 "심사 보고서" — 관계도에서 켜고 끌 행동 묶음
const KIND_GROUP = {
  transfer: 'money', steal: 'money', shortSell: 'money',
  attack: 'violence',
  defend: 'protect', heal: 'protect',
  investigate: 'intel', snoop: 'intel', trace: 'intel', wiretap: 'intel', expose: 'intel',
  emp: 'ops', sabotage: 'ops', destroyCard: 'ops', snatchCard: 'ops',
  voteWeight: 'politics', voteBlock: 'politics', voteWatch: 'politics',
  commission: 'politics', embezzle: 'politics', tieBreak: 'politics', newsEdit: 'politics',
};
const GROUPS = [
  { k: 'money', label: '송금·도둑질', color: '#FFB627' },
  { k: 'violence', label: '공격', color: '#FF2E6A' },
  { k: 'protect', label: '방어·치료', color: '#3DF5E0' },
  { k: 'intel', label: '정보', color: '#7CC4FF' },
  { k: 'ops', label: '공작', color: '#B98CFF' },
  { k: 'politics', label: '정치', color: '#C0EB75' },
];
const GROUP_COLOR = Object.fromEntries(GROUPS.map((g) => [g.k, g.color]));
const endView = { groups: new Set(['money', 'violence', 'protect']), day: 'all', hover: null, tab: 'money' };

const nameOfR = (id) => (endSnap.players.find((p) => p.id === id) || {}).name || '???';

function reportEntries() {
  const R = endSnap;
  return R.history.filter((h) => endView.groups.has(KIND_GROUP[h.kind])
    && (endView.day === 'all' || h.day === endView.day));
}

function relationGraph() {
  const R = endSnap;
  const ps = R.players;
  const n = ps.length;
  const C = 300; const RAD = 215; const NR = 32;
  const pos = {};
  ps.forEach((p, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    pos[p.id] = { x: C + RAD * Math.cos(a), y: C + RAD * Math.sin(a) };
  });

  // 같은 (보낸 사람 → 받은 사람, 묶음) 끼리 합치기
  const agg = {};
  for (const h of reportEntries()) {
    if (!h.to || h.to === h.from || !pos[h.to]) continue;
    const g = KIND_GROUP[h.kind];
    const key = `${h.from}|${h.to}|${g}`;
    const e = (agg[key] ||= { from: h.from, to: h.to, g, count: 0, amount: 0 });
    e.count += 1;
    e.amount += h.kind === 'transfer' ? (h.amount || 0) : 0;
  }
  const edges = Object.values(agg);
  // 같은 두 사람 사이 선이 여러 개면 간격을 벌려 겹치지 않게
  const pairIdx = {};
  const edgeSvg = edges.map((e) => {
    const a = pos[e.from]; const b = pos[e.to];
    const dx = b.x - a.x; const dy = b.y - a.y; const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len; const uy = dy / len;
    const k = `${e.from}|${e.to}`;
    const nth = (pairIdx[k] = (pairIdx[k] ?? -1) + 1);
    const bend = 26 + nth * 18;                       // 진행 방향 왼쪽으로 휘게 → 반대 방향 선과 안 겹침
    const x1 = a.x + ux * NR; const y1 = a.y + uy * NR;
    const x2 = b.x - ux * (NR + 6); const y2 = b.y - uy * (NR + 6);
    const cx = (x1 + x2) / 2 - uy * bend; const cy = (y1 + y2) / 2 + ux * bend;
    const w = e.g === 'money' ? 1.5 + Math.min(6, e.amount / 1000) : 1.5 + Math.min(5, e.count);
    const label = e.amount ? `₵${won(e.amount)}` : (e.count > 1 ? `×${e.count}` : '');
    return `<g class="edge" data-from="${e.from}" data-to="${e.to}">
      <path d="M${x1},${y1} Q${cx},${cy} ${x2},${y2}" stroke="${GROUP_COLOR[e.g]}" stroke-width="${w}"
        fill="none" marker-end="url(#ah-${e.g})" ${e.g === 'protect' ? 'stroke-dasharray="6 5"' : ''}/>
      ${label ? `<text x="${(x1 + x2) / 2 - uy * (bend * 0.55)}" y="${(y1 + y2) / 2 + ux * (bend * 0.55)}" fill="${GROUP_COLOR[e.g]}" class="edge-label">${label}</text>` : ''}
    </g>`;
  }).join('');

  const winners = R.winner.companyIds;
  const nodeSvg = ps.map((p) => {
    const { x, y } = pos[p.id];
    const col = TAG_COLOR[p.company] || '#6E8F98';
    return `<g class="node ${p.alive ? '' : 'dead'} ${winners.includes(p.company) ? 'win' : ''}" data-id="${p.id}" transform="translate(${x},${y})">
      <circle r="${NR}" fill="#0A1A22" stroke="${col}" stroke-width="3" ${p.alive ? '' : 'stroke-dasharray="4 4"'}/>
      ${p.company ? `<image href="img/co/${p.company}.png" x="${-NR * 0.72}" y="${-NR * 0.72}" width="${NR * 1.44}" height="${NR * 1.44}"/>` : `<text class="node-mark" fill="${col}" dy="9">?</text>`}
      ${p.alive ? '' : '<path d="M-14,-14 L14,14 M14,-14 L-14,14" stroke="#FF2E6A" stroke-width="3" opacity=".8"/>'}
      <text class="node-name" dy="${NR + 18}">${esc(p.name)}</text>
    </g>`;
  }).join('');

  const markers = GROUPS.map((g) => `<marker id="ah-${g.k}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="${g.color}"/></marker>`).join('');
  return `<svg id="relGraph" viewBox="0 0 600 600" role="img" aria-label="요원 관계도">
    <defs>${markers}</defs>
    <circle cx="${C}" cy="${C}" r="${RAD}" class="orbit"/>
    ${edgeSvg}${nodeSvg}
    ${edges.length ? '' : `<text x="${C}" y="${C}" class="empty-graph">선택한 조건의 기록이 없습니다</text>`}
  </svg>`;
}

// 회사별 자산: 막대 하나 = 회사, 칸 = 요원 (아바타 + 금액). 1인당 = 생존자 자산 합 ÷ 처음 인원
function assetBars() {
  const R = endSnap;
  const cos = Object.keys(CO_SHORT).filter((c) => R.players.some((p) => p.company === c));
  const tot = (c) => R.players.filter((p) => p.company === c).reduce((t, p) => t + (p.credits || 0), 0);
  const max = Math.max(1, ...cos.map(tot));
  return cos.sort((a, b) => tot(b) - tot(a)).map((c) => {
    const members = R.players.filter((p) => p.company === c).sort((a, b) => (b.credits || 0) - (a.credits || 0));
    const alive = members.filter((p) => p.alive);
    const per = Math.round(alive.reduce((t, p) => t + (p.credits || 0), 0) / members.length);
    const win = R.winner.companyIds.includes(c);
    return `<div class="abar ${win ? 'win' : ''}" style="--c:${TAG_COLOR[c]}">
      <div class="abar-head"><b>${coLogo(c, 'small')}${esc(CO_SHORT[c])}</b><span>${alive.length}/${members.length} 생존 · 1인당 ₵${won(per)}</span></div>
      <div class="abar-track" style="width:${Math.max(18, (tot(c) / max) * 100)}%">${members.map((p) => `<div class="abar-seg ${p.alive ? '' : 'gone'}" style="flex:${Math.max(1, p.credits || 0)}" title="${esc(p.name)} ₵${won(p.credits || 0)}${p.alive ? '' : ' (사망 · 제외)'}">
        <i class="abar-av">${Avatar.svg(Avatar.of(p))}</i><span>₵${won(p.credits || 0)}</span></div>`).join('')}</div>
      <div class="abar-total">합계 ₵${won(tot(c))}</div>
    </div>`;
  }).join('');
}
// 일차별 자금: 매일 아침 각자의 크래딧 (선 색 = 회사, 선 끝 = 아바타)
function moneyChart() {
  const R = endSnap;
  const log = R.creditLog || [];
  if (log.length < 2) return '<p class="muted">자금 기록이 부족합니다.</p>';
  const W = 760; const H = 360; const L = 54; const B = 30; const T = 14; const RR = 60;
  const maxV = Math.max(1000, ...log.flatMap((e) => Object.values(e.by)));
  const x = (i) => L + (i / (log.length - 1)) * (W - L - RR);
  const y = (v) => T + (1 - v / maxV) * (H - T - B);
  let g = '';
  for (let k = 0; k <= 4; k++) { const v = Math.round((maxV * k) / 4); g += `<line x1="${L}" x2="${W - RR}" y1="${y(v)}" y2="${y(v)}" class="mc-grid"/><text x="${L - 6}" y="${y(v) + 4}" class="mc-yl">${v >= 1000 ? `${Math.round(v / 100) / 10}k` : v}</text>`; }
  log.forEach((e, i) => { g += `<text x="${x(i)}" y="${H - 8}" class="mc-xl">${e.final ? '끝' : `${e.day}일`}</text>`; });
  let lines = ''; let avs = '';
  // 끝점이 겹치는 아바타는 아래로 비켜 놓는다
  const ends = R.players.map((p) => ({ id: p.id, y: y(log[log.length - 1].by[p.id] ?? 0) })).sort((a, b) => a.y - b.y);
  const endY = {};
  ends.forEach((e, i) => { endY[e.id] = i && e.y - endY[ends[i - 1].id] < 34 ? endY[ends[i - 1].id] + 34 : e.y; });
  for (const p of R.players) {
    const pts = log.map((e, i) => [x(i), y(e.by[p.id] ?? 0)]);
    const col = TAG_COLOR[p.company] || '#9fb';
    lines += `<polyline class="mc-line ${p.alive ? '' : 'gone'}" data-id="${p.id}" points="${pts.map((q) => q.join(',')).join(' ')}" style="stroke:${col}"/>`;
    pts.forEach((q) => { lines += `<circle cx="${q[0]}" cy="${q[1]}" r="2.6" fill="${col}" class="mc-dot" data-id="${p.id}"/>`; });
    const last = pts[pts.length - 1];
    avs += `<div class="mc-av ${p.alive ? '' : 'gone'}" data-id="${p.id}" style="left:${(last[0] / W) * 100}%;top:${(endY[p.id] / H) * 100}%;--c:${col}" title="${esc(p.name)} ₵${won(log[log.length - 1].by[p.id] || 0)}">${Avatar.svg(Avatar.of(p))}<b>${esc(p.name)}</b></div>`;
  }
  return `<div class="money-chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}${lines}</svg>${avs}</div>
    <p class="muted small">매일 아침 크래딧 · 선 색 = 회사 · 점선 = 사망 · 아바타에 마우스를 올리면 그 사람 선만</p>`;
}
function survivalBars() {
  const R = endSnap;
  const cos = Object.keys(CO_SHORT).filter((c) => R.players.some((p) => p.company === c));
  return cos.map((c) => {
    const members = R.players.filter((p) => p.company === c);
    const alive = members.filter((p) => p.alive).length;
    const st = R.winner.stats && R.winner.stats.find((x) => x.companyId === c);
    const win = R.winner.companyIds.includes(c);
    return `<div class="surv ${win ? 'win' : ''}" style="--c:${TAG_COLOR[c]}">
      <div class="surv-head"><b>${coLogo(c, 'small')}${esc(CO_SHORT[c])}</b><span>${alive}/${members.length} 생존${st ? ` · 1인당 ₵${won(st.avgAssets)}` : ''}</span></div>
      <div class="surv-bar"><i style="width:${(alive / members.length) * 100}%"></i></div>
      <div class="surv-names">${members.map((p) => `<span class="${p.alive ? '' : 'gone'}">${esc(p.name)}</span>`).join('')}</div>
    </div>`;
  }).join('');
}

function reportTimeline() {
  const byDay = {};
  for (const h of reportEntries()) (byDay[h.day] ||= []).push(h);
  const days = Object.keys(byDay);
  if (!days.length) return '<p class="muted">선택한 조건의 기록이 없습니다.</p>';
  return days.map((d) => `<div class="tl-day"><div class="tl-d">${d}일</div><ul>${byDay[d].map((h) => {
    const g = KIND_GROUP[h.kind];
    const self = !h.to || h.to === h.from;
    return `<li><span class="tl-kind" style="--c:${GROUP_COLOR[g]}">${KIND_LABEL[h.kind]}</span>
      ${esc(nameOfR(h.from))}${self ? '' : ` ▸ ${esc(nameOfR(h.to))}`}${h.amount ? ` <b>₵${won(h.amount)}</b>` : ''}${h.anon ? ' <i>익명</i>' : ''}${h.pierce ? ' <i>관통</i>' : ''}${h.text ? ` <i>"${esc(h.text)}"</i>` : ''}</li>`;
  }).join('')}</ul></div>`).join('');
}

// 보고서는 상태가 올 때마다 다시 그리지 않는다 (필터·호버 유지). 새 보고서일 때만 그림
let endDrawnFor = null;
function renderEndOnce() {
  if (!endSnap) { endDrawnFor = null; $('#endOverlay').classList.add('hidden'); return; }
  if (endDrawnFor === endSnap) return;
  endDrawnFor = endSnap;
  // 방금 끝난 판이면 결과 화면 전에 엔딩 연출 (어두워짐 → 아비터의 눈 → 심사 종료 → 승리 회사)
  if (S && S.phase === 'ended' && !endCineDone[endSnap.code + endSnap.day]) {
    endCineDone[endSnap.code + endSnap.day] = true;
    playEndCine(endSnap, () => { Sound.sfx(endWon() ? 'win' : 'lose'); renderEnd(true); });
    return;
  }
  Sound.sfx(endWon() ? 'win' : 'lose');   // 소리·로고 등장은 처음 열 때 한 번만
  renderEnd(true);
}
const endCineDone = {};
function playEndCine(R, done) {
  const w = R.winner;
  const el = document.createElement('div');
  el.id = 'endCine';
  const cos = w.companyIds;
  el.innerHTML = `<div class="ec-eye"><i class="ec-lid t"></i><i class="ec-iris"></i><i class="ec-lid b"></i></div>
    <div class="ec-title">심사 종료</div>
    <div class="ec-win">${cos.length ? cos.map((c) => `<div class="ec-co" style="--c:${TAG_COLOR[c]}">${coLogo(c)}<b>${esc(COMPANY_FULL[c])}</b>
      <div class="ec-avs">${R.players.filter((p) => p.company === c).map((p, i) => `<i class="${p.alive ? '' : 'gone'}" style="animation-delay:${3.3 + i * 0.15}s">${Avatar.svg(Avatar.of(p))}</i>`).join('')}</div></div>`).join('')
      : '<div class="ec-co"><b>승자 없음</b></div>'}<small>${cos.length ? '도시 소유권 획득' : ''}</small></div>`;
  document.body.appendChild(el);
  Sound.sfx('glitch');
  setTimeout(() => Sound.sfx('reveal'), 1500);
  setTimeout(() => Sound.sfx('shutter'), 2700);
  const finish = () => { if (!el.isConnected) return; el.classList.add('out'); setTimeout(() => { el.remove(); done(); }, 600); };
  el.onclick = finish;
  setTimeout(finish, 5600);
}

function renderEnd(first = false) {
  const ov = $('#endOverlay');
  if (!endSnap) { ov.classList.add('hidden'); return; }
  const R = endSnap;
  const w = R.winner;
  // 필터·날짜 버튼으로 다시 그릴 때는 머리(로고)를 그대로 둬서 깜빡임이 다시 재생되지 않게
  const keepHead = !first && ov.querySelector('.report-head');
  const names = w.companyIds.map((c) => `<span class="win-co" style="color:${TAG_COLOR[c]}">${coLogo(c, 'small')}${esc(COMPANY_FULL[c])}
    <span class="win-avs">${R.players.filter((p) => p.company === c).map((p) => `<i class="win-av ${p.alive ? '' : 'gone'}" title="${esc(p.name)}">${Avatar.svg(Avatar.of(p))}<b>${esc(p.name)}</b></i>`).join('')}</span></span>`).join('');
  const winLogos = w.companyIds.map((c) => `<div class="win-logo" style="--c:${TAG_COLOR[c]}">${coLogo(c)}</div>`).join('');
  const maxDay = Math.max(1, ...R.history.map((h) => h.day));
  ov.classList.remove('hidden');
  ov.innerHTML = `<div class="report">
    <header class="report-head">
      ${winLogos ? `<div class="win-logos">${winLogos}</div>` : ''}
      <div class="report-head-text">
        <p class="report-kicker">아비터 최종 판정 · 에덴-7 심사 ${R.day}일차 종료</p>
        <h1 class="report-title ${w.companyIds.length > 1 ? 'multi' : ''}">${w.companyIds.length ? `<em>승리</em>${names}` : '승자 없음'}</h1>
        <p class="report-reason">${esc(w.reason)}</p>
      </div>
      <div class="report-actions"><button id="btnBackLobby" class="primary">로비로 돌아가기</button></div>
    </header>
    <section class="report-graph">
      <div class="report-tabs"><button data-tab="money" class="${endView.tab !== 'rel' ? 'on' : ''}">${ic('credit')} 일차별 자금</button><button data-tab="rel" class="${endView.tab === 'rel' ? 'on' : ''}">${ic('transfer')} 관계도</button></div>
      ${endView.tab !== 'rel' ? moneyChart() : `<div class="report-filters">
        ${GROUPS.map((g) => `<button class="gchip ${endView.groups.has(g.k) ? 'on' : ''}" data-g="${g.k}" style="--c:${g.color}">${g.label}</button>`).join('')}
      </div>
      <div class="report-days">
        <button data-day="all" class="${endView.day === 'all' ? 'on' : ''}">전체</button>
        ${Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => `<button data-day="${d}" class="${endView.day === d ? 'on' : ''}">${d}일</button>`).join('')}
      </div>
      ${relationGraph()}
      <p class="muted small">요원 위에 마우스를 올리면 그 사람의 선만 보입니다. 점선 원 = 사망, 선 굵기 = 송금액·횟수</p>`}
    </section>
    <aside class="report-side">
      <h3>회사별 자산</h3>
      ${assetBars()}
      <h3>기록</h3>
      <div class="report-tl">${reportTimeline()}</div>
    </aside>
  </div>`;
  if (keepHead) ov.querySelector('.report-head').replaceWith(keepHead);
  // 로비로 돌아가기: 방을 대기실로 되돌리고(이미 돌아갔으면 그대로) 내 보고서를 닫는다
  $('#btnBackLobby').onclick = async () => {
    await send('room:reset');
    endSnap = null;
    render();
  };
  ov.querySelectorAll('.report-tabs button').forEach((b) => { b.onclick = () => { endView.tab = b.dataset.tab; renderEnd(); }; });
  ov.querySelectorAll('.mc-av').forEach((av) => {
    const mc = av.closest('.money-chart');
    av.onmouseenter = () => { mc.classList.add('focus'); mc.querySelectorAll('[data-id]').forEach((n) => n.classList.toggle('on', n.dataset.id === av.dataset.id)); };
    av.onmouseleave = () => { mc.classList.remove('focus'); };
  });
  ov.querySelectorAll('.gchip').forEach((b) => {
    b.onclick = () => {
      const g = b.dataset.g;
      if (endView.groups.has(g)) endView.groups.delete(g); else endView.groups.add(g);
      renderEnd();
    };
  });
  ov.querySelectorAll('.report-days button').forEach((b) => {
    b.onclick = () => { endView.day = b.dataset.day === 'all' ? 'all' : Number(b.dataset.day); renderEnd(); };
  });
  const svg = $('#relGraph');
  if (svg) svg.querySelectorAll('.node').forEach((nd) => {
    nd.onmouseenter = () => {
      const id = nd.dataset.id;
      svg.classList.add('focus');
      svg.querySelectorAll('.edge').forEach((e) => e.classList.toggle('on', e.dataset.from === id || e.dataset.to === id));
      svg.querySelectorAll('.node').forEach((x) => {
        const linked = x.dataset.id === id || svg.querySelector(`.edge.on[data-from="${x.dataset.id}"], .edge.on[data-to="${x.dataset.id}"]`);
        x.classList.toggle('on', !!linked);
      });
    };
    nd.onmouseleave = () => svg.classList.remove('focus');
  });
}

render();
