const crypto = require('node:crypto');

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const fail = (status, code, message) => { throw new ApiError(status, code, message); };
const id = () => crypto.randomBytes(16).toString('hex');
const token = () => crypto.randomBytes(32).toString('base64url');
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const key = (s) => s.normalize('NFKC').toLowerCase();
const WORD_PAIRS = require('./word-pairs.json').pairs;
const dictionaryPairs = new Set(WORD_PAIRS.map(([prompt, translation]) => `${key(prompt)}\u0000${key(translation)}`));
const isDictionaryPair = (prompt, translation) => dictionaryPairs.has(`${key(prompt)}\u0000${key(translation)}`);
const botTranslations = [...new Map(WORD_PAIRS.map(([, translation]) => [key(translation), translation])).values()];
const BOT_DIFFICULTIES = new Set(['facile', 'medio', 'difficile']);
const botSkill = { facile: 0.4, medio: 0.67, difficile: 0.9 };

function text(value, name, max) {
  if (typeof value !== 'string') fail(400, 'INVALID_INPUT', `${name} must be a string.`);
  const result = value.normalize('NFKC').trim();
  if (!result || result.length > max || /[\p{Cc}\p{Cf}]/u.test(result)) {
    fail(400, 'INVALID_INPUT', `${name} must contain 1–${max} characters and no control characters.`);
  }
  return result;
}

function bodyFields(body, fields) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some((field) => !fields.includes(field))) {
    fail(400, 'INVALID_INPUT', 'Invalid request body.');
  }
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function createStore({ ttlMs = 24 * 60 * 60 * 1000, now = Date.now, random = Math.random, state } = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('Invalid lobby TTL');
  const rooms = new Map(state?.rooms || []);
  let coffeeCount = state?.coffeeCount || 0;
  function sweep() {
    const time = now();
    for (const [code, room] of rooms) if (time - room.lastActive >= ttlMs) rooms.delete(code);
  }
  function get(code) {
    sweep();
    const room = rooms.get(typeof code === 'string' ? code.toUpperCase() : '');
    if (!room) fail(404, 'ROOM_NOT_FOUND', 'Room not found or expired.');
    return room;
  }
  function makePlayer(nickname) { return { id: id(), token: token(), nickname, isBot: false, score: 0, lastSeen: now() }; }
  function create(body) {
    bodyFields(body, ['nickname', 'roundCount']);
    const nickname = text(body.nickname, 'nickname', 30);
    const roundCount = body.roundCount === undefined ? 3 : body.roundCount;
    if (!Number.isInteger(roundCount) || ![3, 6, 9, 12].includes(roundCount)) {
      fail(400, 'INVALID_INPUT', 'roundCount must be 3, 6, 9 or 12.');
    }
    sweep();
    let code;
    do { code = Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join(''); } while (rooms.has(code));
    const player = makePlayer(nickname);
    const room = { code, creatorNickname: nickname, players: [player], hostId: player.id, roundCount, phase: 'waiting', rev: 1, lastActive: now(), game: null, lastEvent: null };
    rooms.set(code, room);
    return { room, player };
  }
  function join(room, body) {
    bodyFields(body, ['nickname']);
    const nickname = text(body.nickname, 'nickname', 30);
    if (room.phase !== 'waiting') fail(409, 'INVALID_PHASE', 'Joining is only allowed in the lobby.');
    if (room.players.some((p) => key(p.nickname) === key(nickname))) fail(409, 'NICKNAME_TAKEN', 'Nickname is already in use.');
    if (room.players.length >= 3) fail(409, 'ROOM_FULL', 'Room is full.');
    const player = makePlayer(nickname);
    room.players.push(player);
    changed(room);
    return player;
  }
  function addBot(room, player) {
    phase(room, 'waiting'); host(room, player);
    if (room.players.length >= 3) fail(409, 'ROOM_FULL', 'Room is full.');
    let number = 1;
    while (room.players.some((candidate) => key(candidate.nickname) === key(`Bot ${number} 🤖`))) number++;
    const bot = { id: id(), token: null, nickname: `Bot ${number} 🤖`, isBot: true, botDifficulty: 'medio', score: 0, lastSeen: now() };
    room.players.push(bot);
    changed(room);
    return bot;
  }
  function setBotDifficulty(room, player, body) {
    phase(room, 'waiting'); host(room, player);
    bodyFields(body, ['playerId', 'difficulty']);
    if (!BOT_DIFFICULTIES.has(body.difficulty)) fail(400, 'INVALID_INPUT', 'difficulty must be facile, medio or difficile.');
    const bot = room.players.find((candidate) => candidate.id === body.playerId && candidate.isBot);
    if (!bot) fail(404, 'BOT_NOT_FOUND', 'Bot not found in this lobby.');
    bot.botDifficulty = body.difficulty;
    changed(room);
  }
  function removeBot(room, player, body) {
    phase(room, 'waiting'); host(room, player);
    bodyFields(body, ['playerId']);
    const index = room.players.findIndex((candidate) => candidate.id === body.playerId && candidate.isBot);
    if (index < 0) fail(404, 'BOT_NOT_FOUND', 'Bot not found in this lobby.');
    room.players.splice(index, 1);
    changed(room);
  }
  function authenticate(room, header) {
    const match = typeof header === 'string' && /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header);
    const candidate = match && Buffer.from(match[1], 'utf8');
    const player = candidate && room.players.find((p) => typeof p.token === 'string' && crypto.timingSafeEqual(Buffer.from(p.token, 'utf8'), candidate));
    if (!player) fail(401, 'UNAUTHORIZED', 'A valid player bearer token is required.');
    room.lastActive = now();
    player.lastSeen = room.lastActive;
    return player;
  }
  function changed(room) { room.rev++; room.lastActive = now(); }
  function leave(room, player) {
    const wasPlaying = room.phase !== 'waiting';
    room.players = room.players.filter((p) => p.id !== player.id);
    const humans = room.players.filter((candidate) => !candidate.isBot);
    if (!humans.length) { rooms.delete(room.code); return; }
    if (room.hostId === player.id) room.hostId = humans[0].id;
    if (wasPlaying) {
      room.game = null;
      room.phase = 'waiting';
      room.players.forEach((p) => { p.score = 0; });
      room.lastEvent = { type: 'game_aborted', playerId: player.id, nickname: player.nickname };
    }
    changed(room);
  }
  function phase(room, expected) {
    if (room.phase !== expected) fail(409, 'INVALID_PHASE', 'Action is not allowed in this phase.');
  }
  function host(room, player) {
    if (room.hostId !== player.id) fail(403, 'FORBIDDEN', 'Only the host can perform this action.');
  }
  function wordmaster(room, player, required) {
    if ((room.game.round.wordmasterId === player.id) !== required) fail(403, 'FORBIDDEN', required ? 'Only the wordmaster can perform this action.' : 'The wordmaster cannot perform this action.');
  }
  function newRound(room, number) {
    room.game.round = { id: id(), number, wordmasterId: room.game.order[(number - 1) % room.game.order.length], prompt: null, options: [], correctId: null, initial: new Map(), discardedId: null, final: new Map(), result: null };
    room.phase = 'setup';
  }
  function botSetup(room) {
    const master = room.players.find((candidate) => candidate.id === room.game.round.wordmasterId);
    const levelPairs = WORD_PAIRS.filter(([, , difficulty]) => difficulty === master.botDifficulty);
    const source = levelPairs.length ? levelPairs : WORD_PAIRS;
    const pair = source[Math.min(source.length - 1, Math.floor(random() * source.length))];
    const [prompt, translation] = pair;
    const alternatives = botTranslations.filter((candidate) => key(candidate) !== key(translation));
    const distractors = [];
    while (distractors.length < 4) {
      const index = Math.min(alternatives.length - 1, Math.floor(random() * alternatives.length));
      distractors.push(alternatives.splice(index, 1)[0]);
    }
    const values = shuffle([translation, ...distractors]);
    const options = values.map((value) => ({ id: id(), text: value }));
    const round = room.game.round;
    round.prompt = prompt;
    round.correctId = options.find((option) => key(option.text) === key(translation)).id;
    round.options = options;
    room.phase = 'initial-choices';
    changed(room);
  }
  function botInitialChoice(bot, round) {
    const correct = round.options.find((option) => option.id === round.correctId);
    const knowsPair = isDictionaryPair(round.prompt, correct.text);
    const confidence = botSkill[bot.botDifficulty] * (knowsPair ? 0.9 : 0.45);
    if (random() < confidence) return correct.id;
    const wrong = round.options.filter((option) => option.id !== round.correctId);
    return wrong[Math.min(wrong.length - 1, Math.floor(random() * wrong.length))].id;
  }
  function botDiscardChoice(room, round) {
    const wrong = round.options.filter((option) => option.id !== round.correctId);
    const selectedWrong = wrong.filter((option) => [...round.initial.values()].includes(option.id));
    const targetChance = { facile: 0.2, medio: 0.65, difficile: 0.95 }[room.players.find((player) => player.id === round.wordmasterId).botDifficulty];
    const candidates = selectedWrong.length && random() < targetChance ? selectedWrong : wrong;
    return candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))].id;
  }
  function botFinalChoice(bot, round) {
    const correct = round.options.find((option) => option.id === round.correctId);
    const knowsPair = isDictionaryPair(round.prompt, correct.text);
    const initial = round.initial.get(bot.id);
    const available = round.options.filter((option) => option.id !== round.discardedId);
    const initialCorrect = initial === round.correctId;
    const skill = botSkill[bot.botDifficulty];
    const keepInitial = initialCorrect ? 0.55 + skill * 0.4 : 0.1 + (1 - skill) * 0.3;
    if (initial !== round.discardedId && random() < keepInitial) return initial;
    if (random() < skill * (knowsPair ? 0.9 : 0.4)) return correct.id;
    const alternatives = available.filter((option) => option.id !== initial && option.id !== round.correctId);
    const candidates = alternatives.length ? alternatives : available.filter((option) => option.id !== initial);
    return candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))].id;
  }
  function finishRound(room, round) {
    const guesses = room.players.filter((player) => player.id !== round.wordmasterId).map((player) => {
      const initialOptionId = round.initial.get(player.id), finalOptionId = round.final.get(player.id);
      const correct = finalOptionId === round.correctId, changed = initialOptionId !== finalOptionId;
      return { playerId: player.id, initialOptionId, finalOptionId, changed, correct, points: correct ? (changed ? 1 : 3) : 0 };
    });
    const winners = guesses.filter((guess) => guess.correct);
    const correctTranslation = round.options.find((item) => item.id === round.correctId).text;
    const dictionaryVerified = isDictionaryPair(round.prompt, correctTranslation);
    const wordmasterPoints = winners.length === 0 ? (dictionaryVerified ? 3 : 2) : winners.length === 1 && winners[0].changed ? 1 : 0;
    for (const guess of guesses) room.players.find((player) => player.id === guess.playerId).score += guess.points;
    room.players.find((player) => player.id === round.wordmasterId).score += wordmasterPoints;
    round.result = { number: round.number, wordmasterId: round.wordmasterId, prompt: round.prompt, options: round.options, correctOptionId: round.correctId, discardedOptionId: round.discardedId, guesses, wordmasterPoints };
    room.game.results.push(round.result);
    room.phase = 'round-result';
  }
  function driveBots(room) {
    for (let step = 0; step < 12; step++) {
      const round = room.game?.round;
      if (!round) return;
      if (room.phase === 'setup') {
        const master = room.players.find((candidate) => candidate.id === round.wordmasterId);
        if (!master?.isBot) return;
        botSetup(room);
        continue;
      }
      if (room.phase === 'initial-choices') {
        const bots = room.players.filter((candidate) => candidate.isBot && candidate.id !== round.wordmasterId && !round.initial.has(candidate.id));
        if (!bots.length) return;
        for (const bot of bots) {
          round.initial.set(bot.id, botInitialChoice(bot, round));
          if (round.initial.size === 2) room.phase = 'discard';
          changed(room);
        }
        continue;
      }
      if (room.phase === 'discard') {
        const master = room.players.find((candidate) => candidate.id === round.wordmasterId);
        if (!master?.isBot) return;
        round.discardedId = botDiscardChoice(room, round);
        room.phase = 'final-choices';
        changed(room);
        continue;
      }
      if (room.phase === 'final-choices') {
        const bots = room.players.filter((candidate) => candidate.isBot && candidate.id !== round.wordmasterId && !round.final.has(candidate.id));
        if (!bots.length) return;
        for (const bot of bots) {
          round.final.set(bot.id, botFinalChoice(bot, round));
          if (round.final.size === 2) finishRound(room, round);
          changed(room);
        }
        continue;
      }
      return;
    }
  }
  function start(room, player, rematch = false) {
    phase(room, rematch ? 'game-result' : 'waiting');
    host(room, player);
    if (room.players.length !== 3) fail(409, 'NEED_THREE_PLAYERS', 'Exactly three players are required.');
    room.players.forEach((p) => { p.score = 0; });
    room.game = { order: room.players.map((p) => p.id), round: null, results: [] };
    room.lastEvent = null;
    newRound(room, 1);
    changed(room); driveBots(room);
  }
  function setup(room, player, body) {
    phase(room, 'setup'); wordmaster(room, player, true);
    bodyFields(body, ['prompt', 'options', 'correctIndex']);
    const prompt = text(body.prompt, 'prompt', 120);
    if (!Array.isArray(body.options) || body.options.length !== 5) fail(400, 'INVALID_INPUT', 'Exactly five options are required.');
    const values = body.options.map((value) => text(value, 'option', 80));
    if (new Set(values.map(key)).size !== 5) fail(400, 'INVALID_INPUT', 'Options must be distinct ignoring case.');
    if (!Number.isInteger(body.correctIndex) || body.correctIndex < 0 || body.correctIndex > 4) fail(400, 'INVALID_INPUT', 'correctIndex must be an integer from 0 to 4.');
    const options = values.map((value) => ({ id: id(), text: value }));
    const round = room.game.round;
    round.prompt = prompt; round.correctId = options[body.correctIndex].id; round.options = shuffle(options);
    room.phase = 'initial-choices'; changed(room); driveBots(room);
  }
  function option(round, body) {
    bodyFields(body, ['optionId']);
    if (typeof body.optionId !== 'string' || !round.options.some((o) => o.id === body.optionId)) fail(400, 'INVALID_OPTION', 'Unknown option.');
    return body.optionId;
  }
  function initial(room, player, body) {
    phase(room, 'initial-choices'); wordmaster(room, player, false);
    const round = room.game.round;
    if (round.initial.has(player.id)) fail(409, 'ALREADY_SUBMITTED', 'Initial choice is already submitted.');
    round.initial.set(player.id, option(round, body));
    if (round.initial.size === 2) room.phase = 'discard';
    changed(room); driveBots(room);
  }
  function discard(room, player, body) {
    phase(room, 'discard'); wordmaster(room, player, true);
    const round = room.game.round;
    const selected = option(round, body);
    if (selected === round.correctId) fail(400, 'INVALID_DISCARD', 'The correct option cannot be discarded.');
    round.discardedId = selected; room.phase = 'final-choices'; changed(room); driveBots(room);
  }
  function confirm(room, player, body) {
    phase(room, 'final-choices'); wordmaster(room, player, false);
    const round = room.game.round;
    if (round.final.has(player.id)) fail(409, 'ALREADY_SUBMITTED', 'Final choice is already confirmed.');
    const selected = option(round, body);
    if (selected === round.discardedId) fail(400, 'INVALID_OPTION', 'The discarded option cannot be selected.');
    round.final.set(player.id, selected);
    if (round.final.size === 2) finishRound(room, round);
    changed(room); driveBots(room);
  }
  function advance(room, player) {
    phase(room, 'round-result'); host(room, player);
    if (room.game.round.number === room.roundCount) room.phase = 'game-result';
    else newRound(room, room.game.round.number + 1);
    changed(room); driveBots(room);
  }
  function snapshot(room, player) {
    const game = room.game;
    let round = null, ranking = null;
    if (game) {
      const r = game.round;
      const participants = room.players.filter((p) => p.id !== r.wordmasterId);
      const shared = r.initial.size === 2;
      round = {
        id: r.id, number: r.number, wordmasterId: r.wordmasterId, prompt: r.prompt,
        options: r.options, discardedOptionId: r.discardedId,
        initialSubmittedPlayerIds: [...r.initial.keys()],
        initialChoices: participants.filter((p) => shared || p.id === player.id).filter((p) => r.initial.has(p.id)).map((p) => ({ playerId: p.id, optionId: r.initial.get(p.id) })),
        finalConfirmedPlayerIds: [...r.final.keys()],
        myFinalOptionId: r.final.get(player.id) || null,
        result: r.result,
      };
      if (room.phase === 'game-result') {
        const sorted = [...room.players].sort((a, b) => b.score - a.score);
        ranking = sorted.map((p, index) => ({ playerId: p.id, score: p.score, rank: sorted.findIndex((q) => q.score === p.score) + 1 }));
      }
    }
    return { code: room.code, rev: room.rev, phase: room.phase, hostId: room.hostId, roundCount: room.roundCount, totalRounds: room.roundCount, me: player.id,
      players: room.players.map(({ id, nickname, score, isBot, botDifficulty }) => ({ id, nickname, score, isBot, ...(isBot ? { botDifficulty } : {}) })),
      lastEvent: room.lastEvent, round, results: game ? game.results : [], ranking };
  }
  function activeCount() {
    const time = now();
    sweep();
    let count = 0;
    for (const room of rooms.values()) {
      count += room.players.filter(player => !player.isBot && time - player.lastSeen <= 2 * 60 * 1000).length;
    }
    return count;
  }
  function openLobbies() {
    sweep();
    const time = now();
    return [...rooms.values()]
      .filter(room => room.phase !== 'game-result' && time - room.lastActive <= 2 * 60 * 1000)
      .map(room => ({
        code: room.code,
        creatorNickname: room.creatorNickname,
        roundCount: room.roundCount,
        participantNames: room.players.map(player => player.isBot ? `${player.nickname} (bot)` : player.nickname),
        participantCount: room.players.length,
        maxParticipants: 3,
        phase: room.phase,
        isInProgress: room.phase !== 'waiting',
        joinable: room.phase === 'waiting' && room.players.length < 3,
      }));
  }
  function offerCoffee() {
    coffeeCount += 1;
    return coffeeCount;
  }
  return { create, join, addBot, removeBot, setBotDifficulty, get, authenticate, leave, start, setup, initial, discard, confirm, advance, snapshot, sweep, activeCount, openLobbies, coffeeCount: () => coffeeCount, offerCoffee,
    exportState: () => ({ rooms: [...rooms], coffeeCount }) };
}

module.exports = { createStore, ApiError, bodyFields };