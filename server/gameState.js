// =====================================================================
//  아비터 (ARBITER) — 게임 상태 데이터 구조
// ---------------------------------------------------------------------
//  원칙 3가지
//   1) 서버가 유일한 진실(Single Source of Truth). 클라이언트는 "보여주기"만.
//   2) 방 전체 상태(room)는 절대 그대로 emit 하지 않는다.
//      → 반드시 getPlayerView(room, playerId) 로 "그 사람이 봐도 되는 것"만 잘라서 보낸다.
//   3) 플레이어는 socket.id 가 아니라 playerId 로 식별한다. (새로고침/재접속 대비)
// =====================================================================

// ---------------------------------------------------------------------
// 1. 상수: 규칙서 수치를 한 곳에 모은다 (플레이테스트 때 여기만 고치면 됨)
// ---------------------------------------------------------------------
const PHASES = {
  LOBBY: 'lobby',     // 대기실
  MORNING: 'morning', // 아비터 뉴스 + 받은 돈 해제
  DISCUSS: 'discuss', // 토의 시간 (2일차부터, 투표 전)
  VOTE: 'vote',       // 지원금 투표 (2일차부터)
  VOTE_RESULT: 'voteResult', // 투표 결과 연출 (득표 막대 → 보조금 동전 이동)
  SHOP: 'shop',       // 카드 구매 턴 (경매·랜덤 구매·판매)
  DAY: 'day',         // 채팅·협상·행동 예약
  NIGHT: 'night',     // 예약 행동 일괄 처리 + 결과 연출
  ENDED: 'ended',     // 게임 종료, 결과 화면
};

const RULES = {
  minPlayers: 4,
  maxPlayers: 12,
  maxDays: 10,
  startHp: Number(process.env.START_HP) || 3,
  maxArmor: 1,                 // 유사체력 최대치 (소모될 때까지 유지)
  noCardPenalty: 1000,         // 피해 1을 받았는데 손패가 없으면 잃는 크래딧
  startCredits: 3000,
  maxCardsPerDay: (day) => Math.min(5, 2 + Math.floor((day - 1) / 2)),   // 하루 카드 사용 수 (회사 카드 포함): 2장, 2일마다 +1, 최대 5
  resourceGain: 1500,          // 회사 카드: 자원 얻기
  transferMult: 2,             // 송금: 내 자원(1,500) 대신 상대가 2배를 받는다 (금액 입력 없음)
  votePot: (day) => 1500 + 500 * (day - 2),        // 2일차 1,500, 매일 +500
  // 투표 주제 (weight = 나올 확률 비중, 같은 주제는 이틀 연속 안 나옴)
  voteTopics: {
    subsidy:   { label: '지원금', weight: 40 },
    damage:    { label: '피해 1', weight: 14, minDay: 3, majority: true },   // 생존자 과반 득표 필요, 방어 불가 (유사체력은 먼저 깨짐)
    fine:      { label: '벌금', weight: 14, amount: 2000 },                  // 걷은 돈은 다음 지원금에 적립
    cards:     { label: '랜덤 카드 3장', weight: 14, count: 3 },
    revealTop: { label: '자본 1위 공개', weight: 12, yesno: true },
    equalize:  { label: '부의 균일화', weight: 6, yesno: true },             // 생존자 크래딧을 똑같이 나눔
  },
  handLimit: (day) => Math.min(8, 2 + day),        // 1일차 3장, 매일 +1, 최대 8장

  // 카드 구매 턴
  auctionSlots: 5,
  auctionTierWeights: { 1: 0.4, 2: 0.4, 3: 0.2 },  // 경매: 5장은 계열별 1장씩 고정, 등급은 1단계 40% · 2단계 40% · 3단계 20%
  randomBuyLimit: 3,                               // 랜덤 카드: 하루 최대 3장
  randomPrice: (day) => 1000 + 250 * (day - 1),   // 랜덤 카드 가격: 매일 +250
  auctionMinBid: (day) => 300 + 100 * (day - 1),  // 경매 최저 입찰가: 매일 +100
  randomTierWeights: { 1: 0.85, 2: 0.13, 3: 0.02 },// 랜덤: 1단계 85%, 2단계 13%, 3단계 2%

  // 페이즈 길이 (단위: ms). FAST=1 로 서버를 켜면 테스트용 짧은 시간.
  durations: process.env.FAST
    ? { morning: 4_000, discuss: 15_000, vote: 15_000, shop: 30_000, day: 60_000, night: 10_000 }
    : { morning: 8_000, discuss: 60_000, vote: 30_000, shop: 45_000, day: 180_000, night: 25_000 },
};
// 자동 테스트용: DURATIONS="1,2,3,5,1[,토의]" (아침,투표,구매,낮,밤,토의 초 — 토의를 빼면 아침과 같은 길이)
if (process.env.DURATIONS) {
  const [m, v, s, d, n, t] = process.env.DURATIONS.split(',').map((x) => Number(x) * 1000);
  RULES.durations = { morning: m, discuss: t || m, vote: v, shop: s, day: d, night: n };
}
// 로비에서 방장이 고를 수 있는 값 (초 단위, 최대 일수는 일)
const SETTING_OPTIONS = {
  maxDays: [5, 6, 7, 8, 9, 10],
  morning: [5, 8, 12, 15],
  discuss: [30, 60, 90, 120, 180],
  vote: [20, 30, 45, 60],
  shop: [30, 45, 60, 90],
  day: [60, 90, 120, 180, 240, 300],
};
function defaultSettings() {
  return {
    maxDays: RULES.maxDays,
    durations: { ...RULES.durations },   // ms. night 는 사건 수에 맞춰 자동 계산 (테스트용 DURATIONS 일 때만 고정)
  };
}

// 혼자 테스트할 때 MIN_PLAYERS=2 처럼 최소 인원을 낮출 수 있다.
if (process.env.MIN_PLAYERS) RULES.minPlayers = Math.max(2, Number(process.env.MIN_PLAYERS));

// 5대 기업. 비밀 패시브 없음 — 대신 회사 카드의 세 번째 선택지 "특수능력" (무제한, 쓰는 날은 돈을 못 번다)
//   special.card: 밤에 실제 카드처럼 처리하기 위한 숨은 카드 id (CARD_DEFS 의 hidden 카드)
const COMPANIES = {
  helios:   { name: '헬리오스 인더스트리', passive: {}, startCard: 'engineer',
              special: { card: 'coHelios', icon: '🛡', label: '방어 1', target: 'any' } },
  blackice: { name: '블랙아이스 시큐리티', passive: {}, startCard: 'dataBroker',
              special: { card: 'coBlackice', icon: '👁', label: '정보 수집 1', target: 'other' } },
  redline:  { name: '레드라인 PMC',        passive: {}, startCard: 'thug',
              special: { card: 'coRedline', icon: '⚔', label: '피해 1', target: 'other' } },
  neoncast: { name: '네온캐스트 미디어',   passive: {}, startCard: 'publicist',
              special: { card: 'coNeoncast', icon: '📡', label: '가짜 밤 장면 송출 (공격·방어·돈·정보 중 선택)', target: 'self', fake: true } },
  orion:    { name: '오리온 파이낸셜',     passive: {}, startCard: 'lobbyist',
              special: { card: 'coOrion', icon: '📉', label: '공매도: 대상이 오늘 밤 피해를 입으면 +₵4,000', target: 'other', payout: 4000 } },
};
const COMPANY_IDS = Object.keys(COMPANIES);

// 요원 아바타 파츠 개수 (public/avatar.js 와 같아야 함). 범위 밖 값은 버린다
const AVATAR_LIMITS = { hat: 9, eyes: 6, mouth: 6, neck: 5, body: 8, accent: 8 };
function sanitizeAvatar(av) {
  if (!av || typeof av !== 'object') return null;
  const out = {};
  for (const [k, n] of Object.entries(AVATAR_LIMITS)) {
    const v = Number(av[k]);
    if (!Number.isInteger(v) || v < 0 || v >= n) return null;
    out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------
// 2. 카드 "정의"(설계도) vs 카드 "인스턴스"(실물)
//    - 정의: 깡패라는 카드가 어떤 능력을 가졌는지 (변하지 않는 데이터)
//    - 인스턴스: 백조가 지금 들고 있는 깡패 1장 (uid로 구분)
// ---------------------------------------------------------------------
// target 종류: 'other' = 나 말고 1명 / 'any' = 나 포함 1명 / 'self' = 나만
const CARD_DEFS = {
  thug: {
    name: '깡패', family: 'force', tier: 1,
    abilities: [{ key: 'attack', label: '공격 1', target: 'other', power: 1 }],
  },
  bodyguard: {
    name: '경호원', family: 'force', tier: 1,
    abilities: [{ key: 'defend', label: '방어 1', target: 'any', power: 1 }],
  },
  medic: {
    name: '응급요원', family: 'force', tier: 1,
    abilities: [{ key: 'heal', label: '체력 +1', target: 'any', power: 1 }],
  },
  // 2단계: 능력 2개 중 골라서 사용
  mercenary: {
    name: '용병', family: 'force', tier: 2,
    abilities: [
      { key: 'attack', label: '공격 1', target: 'other', power: 1 },
      { key: 'defend', label: '방어 1', target: 'any', power: 1 },
    ],
  },
  fieldMedic: {
    name: '의무병', family: 'force', tier: 2,
    abilities: [
      { key: 'heal', label: '체력 +1', target: 'any', power: 1 },
      { key: 'defend', label: '방어 1', target: 'any', power: 1 },
    ],
  },
  platingDoc: {
    name: '장갑 시술사', family: 'force', tier: 2,
    abilities: [
      { key: 'armor', label: '유사체력 +1: 체력 대신 1번 깎임 (쓸 때까지 유지, 최대 1)', target: 'any', power: 1 },
      { key: 'defend', label: '방어 1', target: 'any', power: 1 },
    ],
  },
  // ---- 정보 계열 ----
  // grade: 조사 등급 1=하급, 2=중급, 3=상급 (블랙아이스는 +1)
  dataBroker: {
    name: '데이터 브로커', family: 'intel', tier: 1,
    abilities: [{ key: 'investigate', label: '하급 조사', target: 'other', grade: 1 }],
  },
  informant: {
    name: '정보원', family: 'intel', tier: 1,
    abilities: [{ key: 'snoop', label: '정보 수집: 손패 1장 / 오늘 밤 쓴 카드 1장 / 크래딧 중 무작위 1개', target: 'other', count: 1 }],
  },
  marketScout: {
    name: '암시장 정찰꾼', family: 'intel', tier: 1,
    abilities: [{ key: 'marketPeek', label: '정찰: 다음 암시장 경매 카드 5장의 앞면 보기', target: 'self' }],
  },
  wiretapper: {
    name: '도청꾼', family: 'intel', tier: 1,
    abilities: [{ key: 'wiretap', label: '도청: 대상의 오늘 귓속말 2줄 (상대는 가려짐)', target: 'other', lines: 2 }],
  },
  hacker: {
    name: '해커', family: 'intel', tier: 2,
    abilities: [
      { key: 'investigate', label: '중급 조사', target: 'other', grade: 2 },
      { key: 'snoop', label: '정보 수집: 손패 1장 / 오늘 밤 쓴 카드 1장 / 크래딧 중 무작위 2개', target: 'other', count: 2 },
      { key: 'wiretap', label: '도청: 대상의 오늘 귓속말 4줄 + 대화 상대', target: 'other', lines: 4, reveal: true },
    ],
  },
  ghostRunner: {
    name: '고스트 넷러너', family: 'intel', tier: 3,
    abilities: [
      { key: 'investigate', label: '소속·손패·크래딧 전부 열람', target: 'other', grade: 3, full: true },
      { key: 'expose', label: '폭로: 소속을 다음 아침 전원 공개 (3일차부터)', target: 'other', minDay: 3 },
    ],
  },
  // ---- 기만 계열 (전부 나에게 쓰는 카드) ----
  // level: 위장이 속일 수 있는 최고 조사 등급 (1=하급까지, 3=상급까지)
  publicist: {
    name: '홍보 담당', family: 'deceit', tier: 1,
    abilities: [{ key: 'disguise', label: '위장: 오늘 밤 하급 조사에 가짜 결과', target: 'self', level: 1 }],
  },
  broker: {
    name: '브로커', family: 'deceit', tier: 1,
    abilities: [{ key: 'escrow', label: '에스크로: 오늘 내 송금은 상대도 나에게 송금해야 실행 (아니면 대신 자원)', target: 'self' }],
  },
  lobbyist: {
    name: '로비스트', family: 'deceit', tier: 1,
    abilities: [{ key: 'bribe', label: '뇌물: 오늘 내 송금이 3배로 도착', target: 'self', mult: 3 }],
  },
  forger: {
    name: '위조범', family: 'deceit', tier: 2,
    abilities: [
      { key: 'forgery', label: '위조 신분증: 조사 결과를 고른 소속으로 (상급엔 뚫림)', target: 'self', chooseCompany: true },
      { key: 'counterTrace', label: '역추적: 오늘 밤 나를 캐낸 사람 + 그 사람 정보 1개', target: 'self' },
      { key: 'extraUses', label: '위조 허가증: 오늘 카드 사용 +2', target: 'self', bonus: 2 },
    ],
  },
  spinDoctor: {
    name: '스핀 닥터', family: 'deceit', tier: 3,
    abilities: [
      { key: 'disguise', label: '위장: 상급 조사까지 가짜 결과', target: 'self', level: 3 },
      { key: 'forgery', label: '위조 신분증 (상급엔 뚫림)', target: 'self', chooseCompany: true },
      { key: 'counterTrace', label: '역추적: 오늘 밤 나를 캐낸 사람 + 그 사람 정보 1개', target: 'self' },
    ],
  },
  // ---- 공작 계열 (도둑질·빼앗기는 방어로 막힌다. 손패 파괴는 방어 무시) ----
  engineer: {
    name: '기술자', family: 'ops', tier: 1,
    abilities: [
      { key: 'sabotage', label: '사보타주: 대상의 다음 날 회사 카드 정지', target: 'other' },
      { key: 'firewall', label: '방화벽: 오늘 밤 나에게 오는 정보·공작·디버프 전부 무효', target: 'self' },
    ],
  },
  pickpocket: {
    name: '좀도둑', family: 'ops', tier: 1,
    abilities: [{ key: 'steal', label: '대상 크래딧 10% 훔치기', target: 'other', rate: 0.1 }],
  },
  operative: {
    name: '공작원', family: 'ops', tier: 2,
    abilities: [
      { key: 'sabotage', label: '사보타주: 대상의 다음 날 회사 카드 정지', target: 'other' },
      { key: 'emp', label: 'EMP: 대상의 오늘 밤 인물 카드 1장 취소', target: 'other' },
      { key: 'destroyCard', label: '대상 손패 1장 무작위 파괴 (방어 무시)', target: 'other' },
      { key: 'steal', label: '대상 크래딧 20% 훔치기', target: 'other', rate: 0.2 },
    ],
  },
  safecracker: {
    name: '금고털이', family: 'ops', tier: 3,
    abilities: [
      { key: 'steal', label: '대상 크래딧 30% 훔치기', target: 'other', rate: 0.3 },
      { key: 'snatchCard', label: '대상 손패 1장 무작위로 빼앗기', target: 'other' },
    ],
  },

  // ---- 정치 계열 (효과는 전부 다음 날 아침 투표에 적용) ----
  agitator: {
    name: '선동가', family: 'politics', tier: 1,
    abilities: [{ key: 'voteWeight', label: '내 표를 2배로', target: 'self', weight: 2 }],
  },
  blacklister: {
    name: '블랙리스트 작성자', family: 'politics', tier: 1,
    abilities: [{ key: 'voteBlock', label: '대상의 투표권 무효', target: 'other' }],
  },
  pollWatcher: {
    name: '개표 감시원', family: 'politics', tier: 1,
    abilities: [{ key: 'voteWatch', label: '대상이 누구에게 투표했는지 확인', target: 'other' }],
  },
  polBroker: {
    name: '정치 브로커', family: 'politics', tier: 2,
    abilities: [
      { key: 'commission', label: '커미션: 내가 찍은 사람이 당선되면 지원금 30%', target: 'self', rate: 0.3 },
      { key: 'voteWeight', label: '대상의 표를 2배로', target: 'any', weight: 2 },
    ],
  },
  embezzler: {
    name: '횡령 담당관', family: 'politics', tier: 2,
    abilities: [{ key: 'embezzle', label: '지원금 20%를 먼저 빼돌림', target: 'self', rate: 0.2 }],
  },
  arbiterLobbyist: {
    name: '아비터 로비스트', family: 'politics', tier: 3,
    abilities: [
      { key: 'embezzle', label: '지원금 40% 횡령', target: 'self', rate: 0.4 },
      { key: 'voteWeight', label: '내 표를 3배로', target: 'self', weight: 3 },
      { key: 'tieBreak', label: '동률이면 내가 찍은 사람이 당선', target: 'self' },
    ],
  },

  // 3단계: 강화된 능력
  cyborg: {
    name: '사이보그 용병', family: 'force', tier: 3,
    abilities: [
      { key: 'attack', label: '공격 2 + 방어 관통 + 압도 (체력과 카드를 함께 깎음)', target: 'other', power: 2, pierce: true, overwhelm: true },
      { key: 'defend', label: '방어 2', target: 'any', power: 2 },
    ],
  },
  // 나머지 계열(정보·기만·공작·정치)은 MVP 이후 여기에 추가
  // ---- 회사 특수능력 (손패에 없음, 회사 카드로만 사용. 경매·랜덤·카드 목록에 안 나옴) ----
  coHelios:   { name: '헬리오스 특수', family: 'company', tier: 0, hidden: true, abilities: [{ key: 'defend', label: '방어 1', target: 'any', power: 1 }] },
  coBlackice: { name: '블랙아이스 특수', family: 'company', tier: 0, hidden: true, abilities: [{ key: 'snoop', label: '정보 수집 1', target: 'other', count: 1 }] },
  coRedline:  { name: '레드라인 특수', family: 'company', tier: 0, hidden: true, abilities: [{ key: 'attack', label: '피해 1', target: 'other', power: 1 }] },
  coNeoncast: { name: '네온캐스트 특수', family: 'company', tier: 0, hidden: true, abilities: [{ key: 'fakeNews', label: '가짜 밤 장면', target: 'self' }] },
  coOrion:    { name: '오리온 특수', family: 'company', tier: 0, hidden: true, abilities: [{ key: 'shortSell', label: '공매도', target: 'other', payout: 4000 }] },
};

// 밤 처리 순서 (규칙서 "밤 처리 순서"). 숫자가 작을수록 먼저.
const NIGHT_ORDER = {
  emp: 1,
  disguise: 2, forgery: 2, cookBooks: 2, anonTransfer: 2, escrow: 2, bribe: 2,
  firewall: 1, defend: 3, heal: 3, armor: 3,
  attack: 4,
  investigate: 5, snoop: 5, wiretap: 5, expose: 5, marketPeek: 5,
  sabotage: 6, steal: 6, destroyCard: 6, snatchCard: 6,
  company: 7,
  politics: 8,
};

// ---------------------------------------------------------------------
// 3. 팩토리 함수: "빈 상태"를 찍어내는 틀
// ---------------------------------------------------------------------
let uidCounter = 0;
const uid = (prefix) => `${prefix}_${(++uidCounter).toString(36)}`;

function createCard(defId, source = 'random', price = 0) {
  return {
    uid: uid('c'),
    defId,          // CARD_DEFS 의 키
    source,         // 'start' | 'random' | 'auction' | 'stolen'  → 판매가 계산에 사용
    price,          // 구매가. 판매가 = source가 start/stolen이면 0, 아니면 price/2
  };
}

function createPlayer({ id, name, socketId }) {
  return {
    // --- 접속 정보 ---
    id,                 // 영구 ID (localStorage에 저장해 재접속 시 사용)
    name,
    socketId,           // 현재 연결된 소켓 (재접속하면 바뀜)
    connected: true,
    avatar: null,       // 요원 외형 { hat, eyes, mouth, neck, body, accent } (없으면 화면에서 이름으로 만든다)
    seat: null,         // 원탁 자리 번호 (게임 시작 시 배정)

    // --- 비밀 정보 (본인만) ---
    company: null,      // 'helios' 등
    credits: 0,         // 지금 쓸 수 있는 돈
    pendingCredits: 0,  // 밤에 들어온 돈 (다음 아침에 credits로 이동)
    lockedCredits: 0,   // 예약된 송금처럼 "묶인" 돈
    hand: [],           // 인물 카드 인스턴스 배열
    known: { absent: [], cards: [], facts: [] },   // 내가 정보로 알아낸 것 (중복 정보 방지 + 불참 기업 표시)
    passiveUses: {},    // { pierce: 3 } 처럼 횟수제 패시브 남은 횟수
    notebook: [],       // 정보 수첩: { day, kind, text }
    hud: [],            // 화면 HUD 태그: { day, targetId, text, tone } — 밤마다 새로

    // --- 공개 정보 (모두에게 보임) ---
    hp: RULES.startHp,
    armor: 0,          // 유사체력: 체력이 깎일 때 대신 소모 (공개)
    marketPeekDay: null, // 암시장 정찰꾼: 이 날 암시장에서 경매 카드 앞면이 보임
    alive: true,
    diedOnDay: null,
    exposed: false,     // 고스트 넷러너 '폭로'로 소속이 전원에게 공개됨
    hideRankDay: null,  // 장부 조작: 이 날 아침 순위 발표에서 숨김
    sabotagedDay: null, // 사보타주: 이 날 회사 카드 사용 불가
    ready: false,       // 준비 완료 체크 (무엇을 했는지는 안 보임)
  };
}

function createRoom({ code, hostId }) {
  return {
    code,               // 방 코드 (예: 'K7QX')
    hostId,
    createdAt: Date.now(),

    phase: PHASES.LOBBY,
    day: 0,
    phaseEndsAt: null,  // 페이즈 끝나는 시각(타임스탬프). 클라는 이걸로 남은 시간을 계산
    phaseDuration: 0,   // 이번 페이즈 전체 길이(ms) — 타이머 링/바를 몇 % 채울지 계산용

    players: {},        // { [playerId]: player }
    seatOrder: [],      // [playerId, ...] 원탁 배치 순서

    teamSizeAtStart: {},// { helios: 2, orion: 1, ... } → 10일차 생존 비율 계산용
    activeCompanies: [],// 이번 판에 참가한 기업 (인원에 맞춰 무작위로 고름)

    turn: createTurn(), // 오늘 하루만 쓰는 임시 데이터 (매일 아침 새로 만든다)

    vote: {
      carryover: 0,     // 동률로 이월된 지원금
      lastResult: null, // { day, winnerId, votes, pot } — 공개용 (누가 누굴 찍었는지는 X)
    },

    chat: {
      public: [],       // { id, from, text, at }
      ghost: [],        // 탈락자 전용
      whispers: {},     // { 'idA|idB': [msg, ...] } — 두 ID를 정렬해서 키로 사용
    },

    news: [],           // 아침 뉴스 { day, lines: [...] }
    lastNight: null,    // 지난밤 "전원에게 보이는" 결과 { day, shields, attacks, deaths, glitch }
    exposeQueue: [],    // 다음 아침 공개될 폭로 대상 [playerId]
    fakeNews: [],       // 네온캐스트가 심은 다음 아침 가짜 뉴스 [문장]
    voteFx: createVoteFx(), // 정치 카드 효과 (다음 아침 투표에 적용)
    phaseToken: 0,      // 타이머 꼬임 방지용 번호 (페이즈가 바뀔 때마다 +1)
    settings: defaultSettings(), // 방장이 로비에서 바꾸는 설정
    history: [],        // 결과 화면 타임라인 (게임 끝나기 전엔 절대 비공개)
                        // { day, kind: 'transfer'|'attack'|..., from, to, amount? }
    winner: null,       // { companyId, reason }
  };
}

// 정치 카드 효과 모음. 밤에 쌓이고, 다음 아침 투표가 끝나면 비운다.
function createVoteFx() {
  return {
    weights: {},        // { [playerId]: 표 배수 } — 여러 개면 곱해서 쌓인다 (2배 + 2배 = 4표)
    blocked: [],        // 투표권 무효 [playerId]
    watchers: [],       // 개표 감시 [{ who, target }]
    commissions: [],    // 커미션 [{ who, rate }]
    embezzles: [],      // 횡령 [{ who, rate }]
    tieBreakers: [],    // 동률 결정권 [playerId]
  };
}

// 하루치 임시 데이터. "예약"은 낮에 쌓이고, 밤에 처리된 뒤 버려진다.
function createTurn() {
  return {
    reservations: {},   // { [playerId]: { cards: [CardAction], company: CompanyAction|null } }
    votes: {},          // { [voterId]: targetId }  — 비공개
    whisperLog: {},     // { [playerId]: Set<상대ID> } — 나중에 '도청'용
    auction: [],        // 오늘 경매 5장: { id, family, tier, defId(비공개), sold, price, winnerId(비공개) }
    bids: {},           // { [playerId]: { [slotId]: 금액 } } — 비공개, 입찰액만큼 lockedCredits 로 묶임
    votePot: null,      // 오늘 투표 지원금 (횡령 반영 후). null 이면 아직 투표 전
    randomBuys: {},     // { [playerId]: 오늘 산 랜덤 카드 수 }
    newsEdits: {},      // 네온캐스트: { [playerId]: 가짜 뉴스 문장 } — 밤에 확정
  };
}
// CardAction    = { cardUid, ability: 'attack'|'defend'|'heal', targetId, usePierce?: boolean }
// CompanyAction = { type: 'resource' } | { type: 'transfer', targetId, amount }

// ---------------------------------------------------------------------
// 4. 소속 배분
//   - 인원에 맞춰 참가 기업 수를 정하고(4~5명 3개 / 6~8명 4개 / 9명 이상 5개),
//     5개 중 그만큼을 무작위로 고른다.
//   - 참가 기업마다 최소 1명, 나머지 자리는 참가 기업 중에서 완전 랜덤.
// ---------------------------------------------------------------------
function companyCountFor(n) {
  if (n <= 3) return 2;          // 테스트용(MIN_PLAYERS 낮춘 경우)
  if (n <= 5) return 3;
  if (n <= 8) return 4;
  return 5;
}

function assignCompanies(room) {
  const ids = room.seatOrder;
  const shuffle = (arr) => arr.map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  const active = shuffle(COMPANY_IDS).slice(0, Math.min(companyCountFor(ids.length), ids.length));
  room.activeCompanies = COMPANY_IDS.filter((c) => active.includes(c));   // 표시 순서는 고정
  const picks = shuffle([
    ...active,
    ...Array.from({ length: ids.length - active.length }, () => active[Math.floor(Math.random() * active.length)]),
  ]);

  room.teamSizeAtStart = Object.fromEntries(COMPANY_IDS.map((c) => [c, 0]));
  ids.forEach((pid, i) => {
    const p = room.players[pid];
    p.company = picks[i];
    room.teamSizeAtStart[p.company] += 1;
    const passive = COMPANIES[p.company].passive;
    if (passive.pierceUses) p.passiveUses.pierce = passive.pierceUses;
    if (passive.newsEditUses) p.passiveUses.newsEdit = passive.newsEditUses;
  });
}

// 시작 손패
//  - 회사 시작 카드가 구현돼 있으면: 시작 카드 + 랜덤 1단계 1장
//  - 아직 구현 안 됐으면: 무력 1단계 랜덤 2장 (임시)
//  (현재: 5개 회사 모두 시작 카드 구현됨)
const USE_COMPANY_START_CARD = true;

function randomCardDef(filter = () => true) {
  const pool = Object.keys(CARD_DEFS).filter((id) => !CARD_DEFS[id].hidden && filter(CARD_DEFS[id]));
  return pool[Math.floor(Math.random() * pool.length)];
}

// 가중치 표에서 하나 뽑기: { 1: 0.85, 2: 0.13, 3: 0.02 } → '1' | '2' | '3'
function weightedPick(weights) {
  let r = Math.random();
  const keys = Object.keys(weights);
  for (const k of keys) {
    r -= weights[k];
    if (r < 0) return Number(k);
  }
  return Number(keys[keys.length - 1]);
}

// 구현된 계열만 등장 (5개 계열 각 20% — 지금은 무력만 있으므로 무력 100%)
const implementedFamilies = () => [...new Set(Object.values(CARD_DEFS).filter((d) => !d.hidden).map((d) => d.family))];

// 계열·등급을 굴려서 카드 정의 하나를 고른다. 그 등급 카드가 없으면 한 단계씩 내려간다.
function rollCard(tierWeights, fixedFamily) {
  const families = implementedFamilies();
  const family = fixedFamily || families[Math.floor(Math.random() * families.length)];
  let tier = weightedPick(tierWeights);
  while (tier >= 1) {
    const defId = randomCardDef((d) => d.family === family && d.tier === tier);
    if (defId) return { family, tier, defId };
    tier -= 1;
  }
  return { family, tier: 1, defId: randomCardDef((d) => d.family === family) };
}

// 판매가: 구매가의 절반. 시작 카드와 빼앗은 카드는 0.
function sellPrice(card) {
  if (card.source === 'start' || card.source === 'stolen') return 0;
  return Math.floor(card.price / 2);
}

function dealStartingHand(player) {
  // 개발용: DEV_HAND="thug,bodyguard,medic" 이면 모두 그 카드로 시작
  if (process.env.DEV_HAND) { player.hand = process.env.DEV_HAND.split(',').filter((id) => CARD_DEFS[id]).map((id) => createCard(id, 'start')); return; }
  const forceTier1 = (def) => def.family === 'force' && def.tier === 1;
  const startDef = COMPANIES[player.company].startCard;
  if (USE_COMPANY_START_CARD && CARD_DEFS[startDef]) {
    player.hand = [
      createCard(startDef, 'start'),
      createCard(randomCardDef((d) => d.tier === 1), 'start'),
    ];
  } else {
    player.hand = [
      createCard(randomCardDef(forceTier1), 'start'),
      createCard(randomCardDef(forceTier1), 'start'),
    ];
  }
}

function startGame(room) {
  // 자리 섞기
  room.seatOrder.sort(() => Math.random() - 0.5);
  room.seatOrder.forEach((pid, i) => { room.players[pid].seat = i; });

  assignCompanies(room);
  for (const pid of room.seatOrder) {
    const p = room.players[pid];
    p.credits = RULES.startCredits;
    dealStartingHand(p);
  }
  room.day = 1;
  room.phase = PHASES.MORNING;
}

// ---------------------------------------------------------------------
// 5. 파생 값 계산 (상태에 저장하지 않고 그때그때 계산)
// ---------------------------------------------------------------------
// 송금하면 상대가 받는 금액: 기본 자원(1,500) × 배수. 배수 = 2배 / 오리온 2.5배 / 뇌물 3배 중 큰 것
// bribeMult 를 넘기면 그 값으로 (밤 처리 때 EMP 로 뇌물이 취소됐는지 반영), 안 넘기면 오늘 예약 기준
function getTransferMult(room, player, bribeMult) {
  const mult = RULES.transferMult;
  if (bribeMult === undefined) {
    const res = room.turn.reservations[player.id];
    bribeMult = 0;
    for (const c of (res ? res.cards : [])) {
      const card = player.hand.find((h) => h.uid === c.cardUid);
      const ab = card && CARD_DEFS[card.defId].abilities.find((a) => a.key === c.ability);
      if (ab && ab.key === 'bribe') bribeMult = Math.max(bribeMult, ab.mult);
    }
  }
  return Math.max(mult, bribeMult || 0);
}
// 오늘 카드 사용 한도 = 기본 + 예약한 '위조 허가증' 보너스
function cardCap(room, player) {
  const res = room.turn.reservations[player.id];
  let bonus = 0;
  for (const c of (res ? res.cards : [])) {
    const card = player.hand.find((h) => h.uid === c.cardUid);
    const ab = card && CARD_DEFS[card.defId].abilities.find((a) => a.key === c.ability);
    if (ab && ab.key === 'extraUses') bonus += ab.bonus;
  }
  return RULES.maxCardsPerDay(room.day) + bonus;
}
const getTransferGift = (room, player, bribeMult) => Math.floor(RULES.resourceGain * getTransferMult(room, player, bribeMult));

function getResourceGain(player) {
  const bonus = COMPANIES[player.company].passive.resourceBonus || 0;
  return Math.floor(RULES.resourceGain * (1 + bonus));
}

function alivePlayers(room) {
  return room.seatOrder.map((id) => room.players[id]).filter((p) => p.alive);
}

const whisperKey = (a, b) => [a, b].sort().join('|');

// 투표 결과 공개용: 커미션은 "얼마가 떼였는지"만 모두에게, "누가 받았는지"는 받은 본인에게만
function voteView(lr, playerId) {
  if (!lr) return null;
  const { commissions = [], ...pub } = lr;
  const mine = commissions.filter((c) => c.who === playerId).reduce((t, c) => t + c.amount, 0);
  return { ...pub, cut: commissions.reduce((t, c) => t + c.amount, 0), myCut: mine };
}

// ---------------------------------------------------------------------
// 6. 시야 필터: 이 플레이어에게 보내도 되는 것만 골라서 새 객체로 만든다
// ---------------------------------------------------------------------
function getPlayerView(room, playerId) {
  const me = room.players[playerId];
  const isGhost = me && !me.alive;
  const gameOver = room.phase === PHASES.ENDED;
  const myRes = room.turn.reservations[playerId] || { cards: [], company: null };

  return {
    code: room.code,
    phase: room.phase,
    day: room.day,
    phaseEndsAt: room.phaseEndsAt,
    phaseDuration: room.phaseDuration,
    isHost: room.hostId === playerId,
    hostId: room.hostId,
    // 규칙 패널·경매 후보 툴팁용 카드 목록 (정적인 설계도라 공개해도 됨)
    cardCatalog: Object.entries(CARD_DEFS).filter(([, d]) => !d.hidden).map(([id, d]) => ({
      id, name: d.name, family: d.family, tier: d.tier, abilities: d.abilities.map((a) => a.label),
    })),

    // 경매: 뒷면(계열·등급)과 "팔렸다/낙찰가"만 공개. 정체는 낙찰자 본인에게만.
    auction: room.turn.auction.map((s) => ({
      id: s.id,
      family: s.family,
      tier: (s.winnerId === playerId || isGhost || (me && me.marketPeekDay === room.day)) ? s.tier : null,   // 등급은 비공개
      sold: s.sold,
      price: s.sold ? s.price : null,
      wonByMe: s.winnerId === playerId,
      card: s.winnerId === playerId ? { defId: s.defId, ...CARD_DEFS[s.defId] } : null,
      // 암시장 정찰꾼을 쓴 사람에게만 앞면(이름)이 보인다
      peek: me && (me.marketPeekDay === room.day || isGhost) ? { defId: s.defId, name: CARD_DEFS[s.defId].name, abilities: CARD_DEFS[s.defId].abilities.map((a) => a.label) } : null,
    })),
    randomPrice: RULES.randomPrice(room.day),
    randomBuyLimit: RULES.randomBuyLimit,
    auctionMinBid: RULES.auctionMinBid(room.day),
    startHp: RULES.startHp,
    noCardPenalty: RULES.noCardPenalty,

    me: me && {
      id: me.id,
      name: me.name,
      company: me.company,
      companyName: me.company && COMPANIES[me.company].name,
      hp: me.hp,
      armor: me.armor,
      alive: me.alive,
      credits: me.credits,
      pendingCredits: me.pendingCredits,
      lockedCredits: me.lockedCredits,
      transferGift: me.company ? getTransferGift(room, me) : 0,     // 내가 송금하면 상대가 받는 금액
      transferMult: me.company ? getTransferMult(room, me) : 0,
      resourceGain: me.company ? getResourceGain(me) : 0,
      hand: me.hand.map((c) => ({ ...c, ...CARD_DEFS[c.defId], sellPrice: sellPrice(c) })),
      handLimit: RULES.handLimit(room.day),
      myBids: room.turn.bids[playerId] || {},
      randomBuys: room.turn.randomBuys[playerId] || 0,
      freeCard: room.turn.freeCards ? room.turn.freeCards[playerId] || null : null,   // 오늘 암시장 무료 카드 uid
      passiveUses: me.passiveUses,
      notebook: me.notebook,
      reservations: myRes,           // 내가 놓은 카드 (나만 보임)
      myVote: room.turn.votes[playerId] || null,
      newsEdit: room.turn.newsEdits[playerId] || null,
      sabotaged: me.sabotagedDay === room.day,
      hud: me.hud || [],              // 화면 HUD 태그 (나만 보임)
    },

    // 다른 사람: 공개 정보만. 죽은 사람은 소속 공개. 유령(나도 죽음)에겐 전부 공개.
    players: room.seatOrder.map((id) => {
      const p = room.players[id];
      const res = room.turn.reservations[id] || { cards: [], company: null };
      return {
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        seat: p.seat,
        hp: p.hp,
        armor: p.armor,
        alive: p.alive,
        connected: p.connected,
        ready: p.ready,
        company: (isGhost || gameOver || id === playerId || p.exposed || !p.alive) ? p.company : undefined,
        exposed: p.exposed,
        credits: gameOver ? p.credits + p.pendingCredits + p.lockedCredits : undefined,   // 결과 화면용
        ghostView: isGhost && p.alive && id !== playerId ? {
          credits: p.credits,
          hand: p.hand.map((c) => ({ name: CARD_DEFS[c.defId].name, family: CARD_DEFS[c.defId].family, tier: CARD_DEFS[c.defId].tier })),
          plays: res.cards.map((a) => {
            const c = p.hand.find((h) => h.uid === a.cardUid);
            const ab = c && CARD_DEFS[c.defId].abilities.find((x) => x.key === a.ability);
            return c ? { name: CARD_DEFS[c.defId].name, family: CARD_DEFS[c.defId].family, label: ab ? ab.label : '', targetId: a.targetId } : null;
          }).filter(Boolean),
          company: res.company,
          vote: room.turn.votes[id] || null,
        } : undefined,
      };
    }),

    chat: {
      public: room.chat.public,
      ghost: isGhost || gameOver ? room.chat.ghost : [],
      // 유령은 모든 귓속말을 볼 수 있다
      whispers: Object.fromEntries(
        Object.entries(room.chat.whispers).filter(([key]) => isGhost || key.split('|').includes(playerId)),
      ),
    },

    minPlayers: RULES.minPlayers,
    maxPlayers: RULES.maxPlayers,
    // 참가 기업은 비밀 — 유령·게임 종료 후에만 공개. 그 외엔 내가 알아낸 불참 기업만
    activeCompanies: (isGhost || gameOver) ? room.activeCompanies : null,
    knownAbsent: me && me.known ? me.known.absent : [],
    companyInfo: Object.fromEntries(COMPANY_IDS.map((c) => [c, { name: COMPANIES[c].name, icon: COMPANIES[c].special.icon, special: COMPANIES[c].special.label, target: COMPANIES[c].special.target, fake: !!COMPANIES[c].special.fake }])),
    voteBannedId: voteBannedId(room),
    maxDays: room.settings.maxDays,
    settings: {
      maxDays: room.settings.maxDays,
      morning: room.settings.durations.morning / 1000,
      discuss: room.settings.durations.discuss / 1000,
      vote: room.settings.durations.vote / 1000,
      shop: room.settings.durations.shop / 1000,
      day: room.settings.durations.day / 1000,
    },
    settingOptions: SETTING_OPTIONS,
    maxCardsPerDay: me ? cardCap(room, me) : RULES.maxCardsPerDay(room.day),
    votePot: room.turn.votePot ?? (room.day >= 2 ? RULES.votePot(room.day) + room.vote.carryover : 0),
    votedCount: Object.keys(room.turn.votes).length,
    topic: room.turn.topic || null,
    topicInfo: room.turn.topic ? RULES.voteTopics[room.turn.topic] : null,
    news: room.news.slice(-3),
    lastNight: room.lastNight,
    lastVote: voteView(room.vote.lastResult, playerId),
    history: gameOver ? room.history : [],
    creditLog: gameOver ? room.creditLog || [] : [],
    winner: room.winner,
  };
}

// 지원금 연속 당선 금지: 어제 투표에서 지원금을 받은 사람은 오늘 받을 수 없다
function voteBannedId(room) {
  const r = room.vote.lastSubsidy;
  return r && r.winnerId && r.day === room.day - 1 && room.turn.topic === 'subsidy' ? r.winnerId : null;
}

module.exports = {
  PHASES, RULES, SETTING_OPTIONS, defaultSettings, COMPANIES, COMPANY_IDS, CARD_DEFS, NIGHT_ORDER,
  createRoom, createPlayer, createCard, createTurn, createVoteFx,
  startGame, voteBannedId, assignCompanies, companyCountFor, dealStartingHand, randomCardDef, rollCard, sellPrice,
  getTransferGift, getTransferMult, cardCap, getResourceGain, alivePlayers, whisperKey,
  getPlayerView, AVATAR_LIMITS, sanitizeAvatar,
};
