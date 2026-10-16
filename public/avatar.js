// =====================================================================
//  아비터 — 요원 아바타 (사이버 마스크 흉상)
//  파츠 번호 6개로 얼굴 하나: { hat, eyes, mouth, neck, body, accent }
//  - 저장한 외형이 없으면 이름으로 정해진다 (같은 이름 = 항상 같은 얼굴)
//  - 서버에도 같은 범위(AVATAR_LIMITS)가 있어서 이상한 값은 걸러진다
// =====================================================================
const Avatar = (() => {
  const PARTS = {
    hat: ['없음', '안테나', '모히칸', '캡 모자', '헤드폰', '후드', '헤일로', '신사 모자', '토끼 귀'],
    eyes: ['바 바이저', 'V 바이저', '쌍안 렌즈', '슬릿', '외눈', '글리치'],
    mouth: ['그릴', '호흡기', '미소', '일자', '없음', '백조 부리'],
    neck: ['없음', '넥타이', '나비넥타이', '케이블 칼라', '스카프'],
  };
  const COLORS = [
    { n: '시안', h: 185, s: 90 }, { n: '마젠타', h: 320, s: 90 }, { n: '주황', h: 25, s: 95 }, { n: '보라', h: 268, s: 85 },
    { n: '초록', h: 145, s: 80 }, { n: '노랑', h: 50, s: 95 }, { n: '파랑', h: 212, s: 90 }, { n: '은색', h: 200, s: 8 },
  ];
  const LIMITS = { hat: PARTS.hat.length, eyes: PARTS.eyes.length, mouth: PARTS.mouth.length, neck: PARTS.neck.length, body: COLORS.length, accent: COLORS.length };
  const KEYS = Object.keys(LIMITS);

  function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function fromName(name) {
    let h = hash(name || '?');
    const next = (n) => { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; h = (h ^ (h >>> 13)) >>> 0; return h % n; };
    const av = {};
    for (const k of KEYS) av[k] = next(LIMITS[k]);
    if (av.accent === av.body) av.accent = (av.body + 3) % COLORS.length;   // 몸과 눈 색이 같으면 심심하니 다르게
    return av;
  }
  function random() {
    const av = {};
    for (const k of KEYS) av[k] = Math.floor(Math.random() * LIMITS[k]);
    return av;
  }
  function valid(av) { return !!av && KEYS.every((k) => Number.isInteger(av[k]) && av[k] >= 0 && av[k] < LIMITS[k]); }
  const of = (p) => (valid(p && p.avatar) ? p.avatar : fromName(p && p.name));

  const col = (i, l) => { const c = COLORS[i]; return `hsl(${c.h} ${c.s}% ${l}%)`; };
  const colS = (i, sMul, l) => { const c = COLORS[i]; return `hsl(${c.h} ${Math.round(c.s * sMul)}% ${l}%)`; };

  // ---- 그리기 (100×100) ----
  function svg(av) {
    av = valid(av) ? av : fromName('?');
    const c = col(av.body, 60); const dark = colS(av.body, 0.5, 13); const mid = colS(av.body, 0.6, 27);
    const a = col(av.accent, 63);
    const gid = 'ag' + KEYS.map((k) => av[k]).join('');
    const back = {
      5: `<path d="M17 72 Q12 22 50 9 Q88 22 83 72 Q66 61 50 61 Q34 61 17 72 Z" fill="${mid}" stroke="${c}" stroke-width="1.6"/>`,
      // 토끼 귀: 머리 뒤에서 솟아오름 (안쪽은 빛 색)
      8: `<g transform="rotate(-12 38 22)"><ellipse cx="38" cy="9" rx="7" ry="15" fill="${dark}" stroke="${c}" stroke-width="1.8"/><ellipse cx="38" cy="10" rx="3" ry="10" fill="${a}" opacity=".85"/></g>
          <g transform="rotate(12 62 22)"><ellipse cx="62" cy="9" rx="7" ry="15" fill="${dark}" stroke="${c}" stroke-width="1.8"/><ellipse cx="62" cy="10" rx="3" ry="10" fill="${a}" opacity=".85"/></g>`,
    }[av.hat] || '';
    const hat = [
      '',
      `<line x1="65" y1="18" x2="74" y2="4" stroke="${c}" stroke-width="2"/><circle cx="74" cy="4" r="3" fill="${a}"/>`,
      `<path d="M42 17 L45 3 L48 13 L51 1 L54 13 L57 3 L59 17 Z" fill="${a}" stroke="${c}" stroke-width="1"/>`,
      `<path d="M27 31 Q27 11 50 11 Q73 11 73 31 Z" fill="${mid}" stroke="${c}" stroke-width="1.6"/><path d="M60 28 L88 30 Q87 35 70 34 L60 33 Z" fill="${c}"/><circle cx="50" cy="12" r="2" fill="${a}"/>`,
      `<path d="M23 42 Q23 7 50 7 Q77 7 77 42" fill="none" stroke="${c}" stroke-width="4"/><rect x="17" y="33" width="11" height="20" rx="3" fill="${mid}" stroke="${a}" stroke-width="1.6"/><rect x="72" y="33" width="11" height="20" rx="3" fill="${mid}" stroke="${a}" stroke-width="1.6"/>`,
      '',
      `<ellipse cx="50" cy="7" rx="19" ry="4.5" fill="none" stroke="${a}" stroke-width="2.4" filter="url(#${gid}b)"/>`,
      // 신사 모자: 높은 원통 + 챙 + 빛 색 띠
      `<rect x="35" y="0" width="30" height="20" fill="${dark}" stroke="${c}" stroke-width="1.6"/><rect x="35" y="13" width="30" height="4" fill="${a}"/><ellipse cx="50" cy="20" rx="27" ry="4.5" fill="${mid}" stroke="${c}" stroke-width="1.6"/>`,
      '',
    ][av.hat];
    const eyes = [
      `<rect x="29" y="35" width="42" height="9" rx="2" fill="${a}"/>`,
      `<path d="M29 34 L50 42 L71 34 L69 44 L50 50 L31 44 Z" fill="${a}"/>`,
      `<circle cx="40" cy="40" r="6.5" fill="${a}"/><circle cx="60" cy="40" r="6.5" fill="${a}"/><circle cx="40" cy="40" r="2.2" fill="${dark}"/><circle cx="60" cy="40" r="2.2" fill="${dark}"/>`,
      `<rect x="31" y="38" width="13" height="3.2" fill="${a}"/><rect x="56" y="38" width="13" height="3.2" fill="${a}"/>`,
      `<circle cx="50" cy="40" r="9" fill="${dark}" stroke="${a}" stroke-width="2"/><circle cx="50" cy="40" r="4.5" fill="${a}"/>`,
      `<g fill="${a}"><rect x="32" y="35" width="5" height="5"/><rect x="37" y="40" width="5" height="5"/><rect x="42" y="35" width="5" height="5"/><rect x="53" y="35" width="5" height="5"/><rect x="58" y="40" width="5" height="5" opacity=".6"/><rect x="63" y="35" width="5" height="5"/></g>`,
    ][av.eyes];
    const mouth = [
      `<g stroke="${c}" stroke-width="2"><line x1="42" y1="54" x2="42" y2="62"/><line x1="47.3" y1="54" x2="47.3" y2="63"/><line x1="52.7" y1="54" x2="52.7" y2="63"/><line x1="58" y1="54" x2="58" y2="62"/></g>`,
      `<rect x="38" y="52" width="24" height="11" rx="5" fill="${mid}" stroke="${c}" stroke-width="1.6"/><circle cx="44" cy="57.5" r="2" fill="${a}"/><circle cx="56" cy="57.5" r="2" fill="${a}"/>`,
      `<path d="M40 55 Q50 63 60 55" fill="none" stroke="${a}" stroke-width="2.6" stroke-linecap="round"/>`,
      `<line x1="42" y1="58" x2="58" y2="58" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`,
      '',
      // 백조 부리: 주황 부리 + 위쪽 검은 혹
      `<path d="M42 49 Q50 45 58 49 L53 66 Q50 70 47 66 Z" fill="#FF8A1F" stroke="#FFC36B" stroke-width="1"/><path d="M44 48.5 Q50 44.5 56 48.5 L50 55 Z" fill="#0b0b0b" stroke="${c}" stroke-width=".8"/><line x1="48.5" y1="60" x2="51.5" y2="60" stroke="#B85A0A" stroke-width="1"/>`,
    ][av.mouth];
    const neck = [
      '',
      `<path d="M40 73 L47 81 M60 73 L53 81" stroke="#E8F6F7" stroke-width="1.6"/><path d="M47 74 L53 74 L52 80 L48 80 Z" fill="${a}"/><path d="M48 80 L52 80 L55 94 L50 99 L45 94 Z" fill="${a}"/>`,
      `<path d="M50 78 L40 72 L40 84 Z M50 78 L60 72 L60 84 Z" fill="${a}"/><circle cx="50" cy="78" r="2.6" fill="${c}"/>`,
      `<ellipse cx="50" cy="75" rx="13" ry="3.5" fill="none" stroke="${a}" stroke-width="2.4"/><path d="M39 77 Q33 86 26 90 M61 77 Q67 86 74 90" fill="none" stroke="${a}" stroke-width="1.6"/>`,
      `<path d="M35 72 Q50 82 65 72 L65 79 Q50 89 35 79 Z" fill="${a}"/><path d="M56 82 L61 96 L53 93 Z" fill="${a}"/>`,
    ][av.neck];
    return `<svg viewBox="0 0 100 100" aria-hidden="true">
      <defs><radialGradient id="${gid}g"><stop offset="0" stop-color="${a}" stop-opacity=".22"/><stop offset="1" stop-color="${a}" stop-opacity="0"/></radialGradient>
      <filter id="${gid}b"><feGaussianBlur stdDeviation="1"/></filter></defs>
      <rect width="100" height="100" fill="url(#${gid}g)"/>
      ${back}
      <path d="M8 101 Q10 80 30 76 L42 73 L58 73 L70 76 Q90 80 92 101 Z" fill="${mid}" stroke="${c}" stroke-width="1.6"/>
      <path d="M22 84 L32 79 M78 84 L68 79" stroke="${c}" stroke-width="1" opacity=".6"/>
      <rect x="43" y="62" width="14" height="13" fill="${dark}" stroke="${c}" stroke-width="1.2"/>
      ${neck}
      <path d="M27 42 Q27 14 50 14 Q73 14 73 42 L71 56 Q64 68 50 69 Q36 68 29 56 Z" fill="${dark}" stroke="${c}" stroke-width="2"/>
      ${eyes}${mouth}${hat}
    </svg>`;
  }
  return { PARTS, COLORS, LIMITS, KEYS, fromName, random, valid, of, svg };
})();
