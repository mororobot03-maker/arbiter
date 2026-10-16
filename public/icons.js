// 사이버네틱 선 아이콘 세트 (24×24, 얇은 네온 선 · 각진 모서리)
//   ic('attack') → <svg class="ic"> … </svg>  색은 currentColor 를 따른다
(function () {
  const P = {
    // ---- 계열 ----
    force: '<path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="5"/><path d="M12 10.5v3M10.5 12h3"/>',
    intel: '<path d="M2 12l4-5h12l4 5-4 5H6z"/><circle cx="12" cy="12" r="2.6"/><path d="M12 4V2M12 22v-2"/>',
    deceit: '<path d="M4 4h16v7c0 5-4 9-8 9s-8-4-8-9z"/><path d="M12 4v16"/><path d="M7 10h3M14 10l2 1.5 2-1.5"/>',
    ops: '<path d="M4 20l7-7"/><path d="M13 11l3-3h4l-2-2 2-2h-4l-3 3v4z"/><circle cx="5" cy="19" r="1.4"/><path d="M15 15l5 5M18 15h2v2"/>',
    politics: '<path d="M4 9h16M6 9v9M10 9v9M14 9v9M18 9v9M3 21h18M12 3l9 5H3z"/>',
    // ---- 능력 ----
    attack: '<path d="M4 20L16 8M16 8h-5M16 8v5"/><path d="M14 3h7v7"/><path d="M3 15l6 6"/>',
    defend: '<path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/><path d="M8 12h8M12 8v8" opacity=".55"/>',
    heal: '<path d="M8 3h8v5h5v8h-5v5H8v-5H3V8h5z"/>',
    armor: '<path d="M12 2l9 6v8l-9 6-9-6V8z"/><path d="M12 7l4.5 3v4L12 17l-4.5-3v-4z"/>',
    investigate: '<rect x="3" y="3" width="18" height="18"/><path d="M3 9h18M3 15h18" opacity=".45"/><circle cx="12" cy="12" r="3"/><path d="M14.2 14.2L19 19"/>',
    snoop: '<path d="M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4"/><path d="M7 12h3l1.5-3 2 6 1.5-3h2"/>',
    marketPeek: '<path d="M3 5h3l2 10h10l2-7H7"/><circle cx="10" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/><circle cx="14" cy="10.5" r="1.4"/>',
    wiretap: '<path d="M3 12h3l2-5 3 10 3-14 3 12 2-3h2"/>',
    expose: '<path d="M4 9v6h4l6 4V5L8 9z"/><path d="M17 8.5a5 5 0 010 7M19.5 6a8.5 8.5 0 010 12"/>',
    disguise: '<path d="M3 8c3-2 15-2 18 0v3c0 5-4 7-9 7s-9-2-9-7z"/><path d="M7 11.5h3.5M13.5 11.5H17"/><path d="M10 15h4"/>',
    escrow: '<rect x="5" y="10" width="14" height="11"/><path d="M8 10V7a4 4 0 018 0v3"/><path d="M12 14v3"/>',
    bribe: '<circle cx="9" cy="9" r="5"/><circle cx="15" cy="15" r="5"/><path d="M15 12.5v5M13 15h4" />',
    forgery: '<rect x="3" y="5" width="18" height="14"/><circle cx="8.5" cy="11" r="2"/><path d="M6 16h5M14 9h5M14 12h5M14 15h3"/>',
    cookBooks: '<path d="M5 3h12l2 2v16H5z"/><path d="M8 8h8M8 12h8M8 16h4"/><path d="M15 15l4 4" />',
    counterTrace: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4" opacity=".5"/><path d="M12 12l6-6"/><path d="M14 4h4v4"/>',
    extraUses: '<rect x="3" y="6" width="10" height="14"/><path d="M7 3h10v14"/><path d="M19 9v6M16 12h6"/>',
    sabotage: '<path d="M12 3v8"/><path d="M6.3 6.3a8 8 0 1011.4 0"/><path d="M3 21L21 3" opacity=".7"/>',
    emp: '<path d="M13 2L5 13h6l-1 9 8-11h-6z"/>',
    destroyCard: '<path d="M5 3h8l-2 6 3 3-3 9H5z"/><path d="M15 3h4v18h-6l3-8-3-3z" opacity=".6"/>',
    steal: '<circle cx="15" cy="7" r="4"/><path d="M15 5.5v3"/><path d="M3 17h5l3-3h5a2 2 0 010 4h-4M3 21h11l6-5"/>',
    snatchCard: '<rect x="12" y="2" width="8" height="11"/><path d="M3 21v-6l4-4 3 3M10 14l3-3"/>',
    voteWeight: '<rect x="4" y="10" width="16" height="11"/><path d="M8 10V4h8v6"/><path d="M10 13l4 5M14 13l-4 5"/>',
    voteBlock: '<rect x="4" y="10" width="16" height="11"/><path d="M8 10V4h8v6"/><path d="M3 22L21 9"/>',
    voteWatch: '<rect x="4" y="10" width="16" height="11"/><path d="M8 10V4h8v6"/><path d="M7 15.5l2.5-2h5l2.5 2-2.5 2h-5z"/>',
    commission: '<circle cx="12" cy="12" r="9"/><path d="M8 16L16 8"/><circle cx="8.5" cy="8.5" r="1.3"/><circle cx="15.5" cy="15.5" r="1.3"/>',
    embezzle: '<path d="M3 21h18M5 21V10M19 21V10M12 3l9 5H3z"/><path d="M9 14h6M12 11v7" opacity=".55"/><path d="M14 16l5 5"/>',
    tieBreak: '<path d="M12 3v18M6 21h12M4 7h16"/><path d="M4 7l-2 6h4zM20 7l-2 6h4z"/>',
    // ---- 회사 카드 · 돈 ----
    credit: '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M15 9.5a4 4 0 100 5M11 6.5v11"/>',
    transfer: '<path d="M3 8h15l-4-4M21 16H6l4 4"/>',
    special: '<path d="M12 2l2.6 6.4L21 9l-5 4.5L17.5 21 12 17.5 6.5 21 8 13.5 3 9l6.4-.6z"/>',
    news: '<path d="M12 12v10M8 22h8"/><circle cx="12" cy="10" r="2"/><path d="M8 6a6 6 0 018 0M5 3a10 10 0 0114 0"/>',
    shortSell: '<path d="M3 4v17h18"/><path d="M6 8l4 4 3-3 6 7"/><path d="M19 11v5h-5"/>',
    // ---- 상태 · 페이즈 ----
    vote: '<rect x="4" y="10" width="16" height="11"/><path d="M8 10V4h8v6"/><path d="M10 7h4"/>',
    card: '<rect x="4" y="5" width="12" height="16"/><path d="M8 2h12v16"/>',
    ready: '<path d="M4 12l5 5L20 6"/>',
    day: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M5 19l2-2"/>',
    night: '<path d="M20 15A8 8 0 019 4a8 8 0 1011 11z"/>',
    shop: '<path d="M3 9l2-5h14l2 5M3 9h18v3H3zM5 12v9h14v-9"/><path d="M10 21v-5h4v5"/>',
    discuss: '<path d="M3 4h12v8H8l-3 3v-3H3z"/><path d="M15 8h6v8h-2v3l-3-3h-5v-4"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>',
    self: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a6 6 0 016-6h4a6 6 0 016 6v2"/>',
    gift: '<rect x="3" y="9" width="18" height="12"/><path d="M3 13h18M12 9v12"/><path d="M12 9c-2-4-6-4-6-1.5S12 9 12 9zm0 0c2-4 6-4 6-1.5S12 9 12 9z"/>',
    lock: '<rect x="5" y="10" width="14" height="11"/><path d="M8 10V7a4 4 0 018 0v3"/>',
    x: '<path d="M5 5l14 14M19 5L5 19"/>',
    firewall: '<path d="M3 4h18v16H3z"/><path d="M3 9h18M3 14h18M9 4v5M15 9v5M9 14v6"/><path d="M15 17c0-2 2-2 2-4 1 1 2 2 2 4a2 2 0 01-4 0z" fill="currentColor" stroke="none" opacity=".8"/>',
  };
  // 능력 key → 아이콘 이름 (같은 이름이면 생략)
  const ALIAS = { anonTransfer: 'transfer', fakeNews: 'news' };
  function ic(name, cls = '') {
    const d = P[ALIAS[name] || name];
    if (!d) return '';
    return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${d}</svg>`;
  }
  window.ic = ic;
  window.IC_NAMES = Object.keys(P);
})();
