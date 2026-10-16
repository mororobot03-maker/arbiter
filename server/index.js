// =====================================================================
//  아비터 — Socket.IO 서버 (방/로비, 재접속, 이벤트 연결)
//  실행:  npm start            (기본)
//         npm run dev          (FAST=1 짧은 타이머, MIN_PLAYERS=2)
// =====================================================================
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const S = require('./gameState');
const game = require('./game');

const PORT = Number(process.env.PORT) || 3000;
const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));
// 카드 그림 목록: public/img/cards/<카드id>.png|jpg|webp 가 있으면 그 카드에 그림이 붙는다 (5초 캐시)
const fs = require('fs');
const CARD_ART_DIR = path.join(__dirname, '..', 'public', 'img', 'cards');
let artCache = { at: 0, map: {} };
app.get('/card-art.json', (req, res) => {
  if (Date.now() - artCache.at > 5000) {
    const map = {};
    try {
      for (const f of fs.readdirSync(CARD_ART_DIR)) {
        const m = f.match(/^([A-Za-z0-9]+)\.(png|jpe?g|webp)$/i);
        if (m && S.CARD_DEFS[m[1]]) map[m[1]] = f;
      }
    } catch { /* 폴더가 없으면 그림 없음 */ }
    artCache = { at: Date.now(), map };
  }
  res.json(artCache.map);
});
const server = http.createServer(app);
const io = new Server(server);

const rooms = new Map();          // 방코드 → room

// 방 전체가 아니라, 플레이어마다 "그 사람 시야"를 따로 만들어 보낸다
function broadcast(room) {
  for (const pid of Object.keys(room.players)) {
    const p = room.players[pid];
    if (p.connected && p.socketId) io.to(p.socketId).emit('state', S.getPlayerView(room, pid));
  }
}

// 엔진이 화면 갱신/개인 알림을 하고 싶을 때 부르는 함수들
game.init({
  broadcast,
  notify(room, pid, note) {
    const p = room.players[pid];
    if (p && p.connected && p.socketId) io.to(p.socketId).emit('notice', note);
  },
});

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 헷갈리는 O/0, I/1 제외
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function cleanId(id) {
  return typeof id === 'string' ? id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) : '';
}
function cleanName(name) {
  return String(name || '').trim().slice(0, 12);
}

// 방 입장 (새로 들어오기 + 재접속 둘 다 처리)
function enterRoom(socket, room, name, playerId, avatar) {
  let p = room.players[playerId];
  if (p) {
    // 재접속: 같은 playerId 면 새 소켓으로 갈아끼운다
    p.socketId = socket.id;
    p.connected = true;
  } else {
    if (room.phase !== S.PHASES.LOBBY) return '이미 시작된 게임입니다.';
    if (room.seatOrder.length >= S.RULES.maxPlayers) return '방이 가득 찼습니다.';
    if (!name) return '이름을 입력하세요.';
    if (Object.values(room.players).some((x) => x.name === name)) return '같은 이름이 이미 있습니다.';
    p = S.createPlayer({ id: playerId, name, socketId: socket.id });
    room.players[playerId] = p;
    room.seatOrder.push(playerId);
  }
  const av = S.sanitizeAvatar(avatar);
  if (av && room.phase === S.PHASES.LOBBY) p.avatar = av;
  socket.data = { roomCode: room.code, playerId };
  broadcast(room);
  return null;
}

function ctx(socket) {
  const { roomCode, playerId } = socket.data || {};
  const room = roomCode && rooms.get(roomCode);
  return room ? { room, playerId } : null;
}

const reply = (ack, err, extra = {}) => typeof ack === 'function' && ack({ ok: !err, error: err, ...extra });

io.on('connection', (socket) => {
  // 이상한 입력(null, 잘못된 형식)이 와도 서버가 죽지 않도록 모든 핸들러를 감싼다
  const on = socket.on.bind(socket);
  socket.on = (ev, fn) => on(ev, (...args) => {
    const ack = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
    if (args[0] === null || (typeof args[0] !== 'object' && typeof args[0] !== 'undefined' && typeof args[0] !== 'function')) args[0] = {};
    try { fn(...args); } catch (e) {
      console.error(`[${ev}]`, e);
      if (ack) { try { ack({ ok: false, error: '처리 중 오류가 발생했습니다.' }); } catch (_) { /* 무시 */ } }
    }
  });
  socket.on('room:create', ({ name, playerId, avatar } = {}, ack) => {
    name = cleanName(name);
    playerId = cleanId(playerId);
    if (!name || !playerId) return reply(ack, '이름을 입력하세요.');
    const room = S.createRoom({ code: makeCode(), hostId: playerId });
    rooms.set(room.code, room);
    const err = enterRoom(socket, room, name, playerId, avatar);
    reply(ack, err, { code: room.code });
  });

  socket.on('room:join', ({ code, name, playerId, avatar } = {}, ack) => {
    playerId = cleanId(playerId);
    const room = rooms.get(String(code || '').toUpperCase().trim());
    if (!room) return reply(ack, '방을 찾을 수 없습니다.');
    if (!playerId) return reply(ack, '잘못된 요청입니다.');
    const err = enterRoom(socket, room, cleanName(name), playerId, avatar);
    reply(ack, err, { code: room.code });
  });

  socket.on('room:leave', (_, ack) => {
    const c = ctx(socket);
    if (c) leaveRoom(c.room, c.playerId, true);
    socket.data = {};
    reply(ack, null);
  });

  socket.on('game:start', (_, ack) => {
    const c = ctx(socket);
    if (!c) return reply(ack, '방에 없습니다.');
    if (c.room.hostId !== c.playerId) return reply(ack, '방장만 시작할 수 있습니다.');
    // 로비에서 연결이 끊긴 사람은 빼고 시작
    for (const pid of [...c.room.seatOrder]) {
      if (!c.room.players[pid].connected) leaveRoom(c.room, pid, true);
    }
    reply(ack, game.startGame(c.room));
  });

  // 대기실에서 요원 외형 바꾸기
  socket.on('room:avatar', (data, ack) => {
    const c = ctx(socket);
    if (!c) return reply(ack, '방에 없습니다.');
    if (c.room.phase !== S.PHASES.LOBBY) return reply(ack, '외형은 대기실에서만 바꿀 수 있습니다.');
    const av = S.sanitizeAvatar(data);
    if (!av) return reply(ack, '잘못된 외형입니다.');
    c.room.players[c.playerId].avatar = av;
    broadcast(c.room);
    reply(ack, null);
  });

  socket.on('room:settings', (data, ack) => {
    const c = ctx(socket);
    if (!c) return reply(ack, '방에 없습니다.');
    reply(ack, game.updateSettings(c.room, c.playerId, data));
  });

  // 결과 화면의 "로비로 돌아가기": 끝난 방을 대기실로 되돌림 (이미 돌아갔으면 아무 일 없음)
  socket.on('room:reset', (_, ack) => {
    const c = ctx(socket);
    if (!c) return reply(ack, '방에 없습니다.');
    reply(ack, game.resetRoom(c.room));
  });

  socket.on('action', ({ type, data } = {}, ack) => {
    const c = ctx(socket);
    if (!c) return reply(ack, '방에 없습니다.');
    reply(ack, game.handleAction(c.room, c.playerId, type, data));
  });

  socket.on('chat', (data, ack) => {
    const c = ctx(socket);
    if (!c) return reply(ack, '방에 없습니다.');
    reply(ack, game.chat(c.room, c.playerId, data));
  });

  socket.on('disconnect', () => {
    const c = ctx(socket);
    if (!c) return;
    const p = c.room.players[c.playerId];
    if (!p || p.socketId !== socket.id) return;     // 이미 새 소켓으로 재접속함
    p.connected = false;
    // 로비에서는 15초 안에 돌아오지 않으면 자리 정리 (새로고침은 바로 돌아오므로 유지됨)
    if (c.room.phase === S.PHASES.LOBBY) {
      setTimeout(() => {
        if (!p.connected && c.room.phase === S.PHASES.LOBBY) leaveRoom(c.room, p.id, true);
      }, 15_000);
    }
    broadcast(c.room);
    scheduleCleanup(c.room);
  });
});

function leaveRoom(room, playerId, removeSeat) {
  if (room.phase === S.PHASES.LOBBY && removeSeat) {
    delete room.players[playerId];
    room.seatOrder = room.seatOrder.filter((id) => id !== playerId);
    if (room.hostId === playerId) room.hostId = room.seatOrder[0] || null;
    if (room.seatOrder.length === 0) {
      rooms.delete(room.code);
      return;
    }
  } else if (room.players[playerId]) {
    room.players[playerId].connected = false;
  }
  broadcast(room);
  scheduleCleanup(room);
}

// 아무도 접속해 있지 않은 방은 10분 뒤 삭제
function scheduleCleanup(room) {
  setTimeout(() => {
    if (!rooms.has(room.code)) return;
    if (Object.values(room.players).every((p) => !p.connected)) {
      game.stopRoom(room);
      rooms.delete(room.code);
    }
  }, 10 * 60_000);
}

server.listen(PORT, () => {
  console.log(`아비터 서버 실행 중 → http://localhost:${PORT}`);
  console.log(`최소 인원 ${S.RULES.minPlayers}명, 타이머 ${process.env.FAST ? '빠름(FAST)' : '기본'}`);
});

// 마지막 안전망: 예상 못 한 오류로 서버 전체가 꺼지지 않게 기록만 남긴다
process.on('uncaughtException', (e) => console.error('[uncaught]', e));
process.on('unhandledRejection', (e) => console.error('[unhandled]', e));
