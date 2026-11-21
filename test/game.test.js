const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const { createStore } = require('../game');
const dictionary = require('../word-pairs.json');

async function fixture(t, options) {
  const app = createApp(options);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { method = 'POST', body, token, raw, headers = {} } = {}) {
    const response = await fetch(base + path, { method, headers: { ...(body !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) });
    const json = await response.json();
    return { status: response.status, json, headers: response.headers };
  }
  return request;
}

async function players(request) {
  const first = await request('/lobby', { body: { nickname: 'Ada' } });
  assert.equal(first.status, 201);
  const code = first.json.snapshot.code;
  const second = await request(`/lobby/${code}/join`, { body: { nickname: 'Bob' } });
  const third = await request(`/lobby/${code}/join`, { body: { nickname: 'Cat' } });
  assert.equal(second.status, 201); assert.equal(third.status, 201);
  const ps = [first.json, second.json, third.json];
  const call = (action, i, body) => request(`/lobby/${code}/${action}`, { token: ps[i].token, body });
  const get = (i) => request(`/lobby/${code}`, { method: 'GET', token: ps[i].token });
  return { code, ps, call, get };
}
const setupBody = { prompt: 'gatto', options: ['cat', 'dog', 'bird', 'fish', 'horse'], correctIndex: 0 };
async function setupRound(call, master, body = setupBody) {
  const response = await call('setup', master, body);
  assert.equal(response.status, 200);
  return Object.fromEntries(response.json.snapshot.round.options.map((o) => [o.text, o.id]));
}
const choice = (optionId) => ({ optionId });
const error = (response, status, code) => { assert.equal(response.status, status); assert.equal(response.json.error.code, code); };

test('store state can be restored with in-progress game Maps intact', () => {
  const store = createStore();
  const { room, player } = store.create({ nickname: 'Ada' });
  store.addBot(room, player);
  store.addBot(room, player);
  store.start(room, player);
  store.setup(room, player, setupBody);
  store.offerCoffee();

  const restored = createStore({ state: store.exportState() });
  const restoredRoom = restored.get(room.code);
  const restoredPlayer = restored.authenticate(restoredRoom, `Bearer ${player.token}`);

  assert.equal(restored.snapshot(restoredRoom, restoredPlayer).phase, 'discard');
  assert.equal(restored.snapshot(restoredRoom, restoredPlayer).round.initialChoices.length, 2);
  assert.equal(restored.coffeeCount(), 1);
});

test('active user endpoint reports players with recent activity', async (t) => {
  const req = await fixture(t);
  const host = await req('/lobby', { body: { nickname: 'Ada', roundCount: 3 } });
  await req(`/lobby/${host.json.snapshot.code}/join`, { body: { nickname: 'Bob' } });
  const active = await req('/active', { method: 'GET' });
  assert.equal(active.status, 200);
  assert.equal(active.json.activeUsers, 2);
});

test('active lobby list includes creator, participants, phase and joinability', async (t) => {
  const req = await fixture(t);
  const host = await req('/lobby', { body: { nickname: 'Ada' } });
  const code = host.json.snapshot.code;
  assert.deepEqual((await req('/lobbies', { method: 'GET' })).json.lobbies, [
    { code, creatorNickname: 'Ada', roundCount: 3, participantNames: ['Ada'], participantCount: 1, maxParticipants: 3, phase: 'waiting', isInProgress: false, joinable: true },
  ]);
  await req(`/lobby/${code}/join`, { body: { nickname: 'Bob' } });
  assert.deepEqual((await req('/lobbies', { method: 'GET' })).json.lobbies, [
    { code, creatorNickname: 'Ada', roundCount: 3, participantNames: ['Ada', 'Bob'], participantCount: 2, maxParticipants: 3, phase: 'waiting', isInProgress: false, joinable: true },
  ]);
  await req(`/lobby/${code}/join`, { body: { nickname: 'Cat' } });
  let lobby = (await req('/lobbies', { method: 'GET' })).json.lobbies[0];
  assert.equal(lobby.participantCount, 3);
  assert.equal(lobby.joinable, false);
  assert.equal(lobby.isInProgress, false);
  await req(`/lobby/${code}/start`, { token: host.json.token });
  lobby = (await req('/lobbies', { method: 'GET' })).json.lobbies[0];
  assert.deepEqual(lobby.participantNames, ['Ada', 'Bob', 'Cat']);
  assert.equal(lobby.phase, 'setup');
  assert.equal(lobby.isInProgress, true);
  assert.equal(lobby.joinable, false);
});

test('health endpoint responds without credentials', async (t) => {
  const req = await fixture(t);
  const response = await req('/health', { method: 'GET' });
  assert.equal(response.status, 200);
  assert.equal(response.json.status, 'ok');
  assert.equal(typeof response.json.uptimeSeconds, 'number');
});

test('coffee offer counter is shared by clients on the server', async (t) => {
  const req = await fixture(t);
  assert.deepEqual((await req('/coffee', { method: 'GET' })).json, { coffeeCount: 0 });
  assert.deepEqual((await req('/coffee', { method: 'POST' })).json, { coffeeCount: 1 });
  assert.deepEqual((await req('/coffee', { method: 'POST' })).json, { coffeeCount: 2 });
  assert.deepEqual((await req('/coffee', { method: 'GET' })).json, { coffeeCount: 2 });
});

test('identity, lobby validation, safe names, host rotation and leaving', async (t) => {
  const req = await fixture(t);
  error(await req('/lobby', { body: { nickname: '' } }), 400, 'INVALID_INPUT');
  error(await req('/lobby', { body: { nickname: 'x', admin: true } }), 400, 'INVALID_INPUT');
  error(await req('/lobby', { raw: '{' }), 400, 'INVALID_JSON');
  error(await req('/lobby', { body: { nickname: 'x'.repeat(17000) } }), 413, 'BODY_TOO_LARGE');
  error(await req('/lobby', { raw: 'hello', headers: { 'Content-Type': 'text/plain' } }), 415, 'UNSUPPORTED_MEDIA_TYPE');
  error(await req('/lobby/__proto__/join', { body: { nickname: 'x' } }), 404, 'ROOM_NOT_FOUND');
  const a = (await req('/lobby', { body: { nickname: '__proto__' } })).json;
  const code = a.snapshot.code;
  assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  assert.equal(a.snapshot.players[0].nickname, '__proto__');
  error(await req(`/lobby/${code}/join`, { body: { nickname: '  __PROTO__ ' } }), 409, 'NICKNAME_TAKEN');
  const b = (await req(`/lobby/${code.toLowerCase()}/join`, { body: { nickname: 'constructor' } })).json;
  error(await req(`/lobby/${code}`, { method: 'GET' }), 401, 'UNAUTHORIZED');
  error(await req(`/lobby/${code}`, { method: 'GET', token: 'bad' }), 401, 'UNAUTHORIZED');
  const other = (await req('/lobby', { body: { nickname: 'other' } })).json;
  error(await req(`/lobby/${code}`, { method: 'GET', token: other.token }), 401, 'UNAUTHORIZED');
  error(await req(`/lobby/${code}/start`, { token: a.token }), 409, 'NEED_THREE_PLAYERS');
  error(await req(`/lobby/${code}/start`, { token: a.token, body: { extra: true } }), 400, 'INVALID_INPUT');
  const c = (await req(`/lobby/${code}/join`, { body: { nickname: 'toString' } })).json;
  error(await req(`/lobby/${code}/join`, { body: { nickname: 'new' } }), 409, 'ROOM_FULL');
  error(await req(`/lobby/${code}/start`, { token: b.token }), 403, 'FORBIDDEN');
  assert.deepEqual((await req(`/lobby/${code}/leave`, { token: a.token })).json, { left: true });
  const snap = (await req(`/lobby/${code}`, { method: 'GET', token: b.token })).json.snapshot;
  assert.equal(snap.hostId, b.playerId); assert.equal(snap.rev, 4);
  error(await req(`/lobby/${code}`, { method: 'GET', token: a.token }), 401, 'UNAUTHORIZED');
  await req(`/lobby/${code}/leave`, { token: b.token });
  await req(`/lobby/${code}/leave`, { token: c.token });
  error(await req(`/lobby/${code}`, { method: 'GET', token: c.token }), 404, 'ROOM_NOT_FOUND');
});

test('creator can choose 3, 6, 9 or 12 rounds', async (t) => {
  const req = await fixture(t);
  error(await req('/lobby', { body: { nickname: 'Ada', roundCount: 5 } }), 400, 'INVALID_INPUT');
  const created = await req('/lobby', { body: { nickname: 'Ada', roundCount: 6 } });
  assert.equal(created.status, 201);
  assert.equal(created.json.snapshot.roundCount, 6);
  assert.equal(created.json.snapshot.totalRounds, 6);
  const code = created.json.snapshot.code;
  await req(`/lobby/${code}/join`, { body: { nickname: 'Bob' } });
  await req(`/lobby/${code}/join`, { body: { nickname: 'Cat' } });
  const started = await req(`/lobby/${code}/start`, { token: created.json.token });
  assert.equal(started.json.snapshot.roundCount, 6);
  assert.equal(started.json.snapshot.totalRounds, 6);
  assert.equal(started.json.snapshot.round.number, 1);
});

test('host can add and remove bots to fill the lobby, but other players cannot manage them', async (t) => {
  const req = await fixture(t);
  const host = (await req('/lobby', { body: { nickname: 'Ada' } })).json;
  const code = host.snapshot.code;
  const bob = (await req(`/lobby/${code}/join`, { body: { nickname: 'Bob' } })).json;
  const call = (player, action, body = {}) => req(`/lobby/${code}/${action}`, { token: player.token, body });

  error(await call(bob, 'add-bot'), 403, 'FORBIDDEN');
  let response = await call(host, 'add-bot');
  assert.equal(response.status, 200);
  let bots = response.json.snapshot.players.filter((player) => player.isBot);
  assert.equal(bots.length, 1);
  assert.equal(bots[0].botDifficulty, 'medio');
  assert.equal(bots[0].token, undefined);
  assert.equal((await req('/active', { method: 'GET' })).json.activeUsers, 2);
  assert.deepEqual((await req('/lobbies', { method: 'GET' })).json.lobbies[0].participantNames, ['Ada', 'Bob', `${bots[0].nickname} (bot)`]);
  error(await call(host, 'add-bot'), 409, 'ROOM_FULL');
  error(await call(bob, 'set-bot-difficulty', { playerId: bots[0].id, difficulty: 'difficile' }), 403, 'FORBIDDEN');
  error(await call(host, 'set-bot-difficulty', { playerId: bots[0].id, difficulty: 'impossibile' }), 400, 'INVALID_INPUT');
  response = await call(host, 'set-bot-difficulty', { playerId: bots[0].id, difficulty: 'difficile' });
  bots = response.json.snapshot.players.filter((player) => player.isBot);
  assert.equal(bots[0].botDifficulty, 'difficile');
  response = await call(host, 'remove-bot', { playerId: bots[0].id });
  assert.equal(response.json.snapshot.players.length, 2);
  response = await call(host, 'add-bot');
  assert.equal(response.json.snapshot.players.length, 3);
  assert.equal((await call(host, 'start')).json.snapshot.phase, 'setup');
});

test('bots play as guessers and later take the wordmaster role automatically', async (t) => {
  const req = await fixture(t);
  const host = (await req('/lobby', { body: { nickname: 'Ada', roundCount: 3 } })).json;
  const code = host.snapshot.code;
  const call = (action, body = {}) => req(`/lobby/${code}/${action}`, { token: host.token, body });
  const firstBot = (await call('add-bot')).json.snapshot.players.find((player) => player.isBot);
  const secondSnapshot = (await call('add-bot')).json.snapshot;
  const secondBot = secondSnapshot.players.find((player) => player.isBot && player.id !== firstBot.id);
  await call('set-bot-difficulty', { playerId: firstBot.id, difficulty: 'difficile' });
  await call('start');

  let round = (await req(`/lobby/${code}`, { method: 'GET', token: host.token })).json.snapshot.round;
  assert.equal(round.wordmasterId, host.playerId);
  await call('setup', setupBody);
  round = (await req(`/lobby/${code}`, { method: 'GET', token: host.token })).json.snapshot.round;
  assert.equal(round.initialSubmittedPlayerIds.length, 2);
  const wrongOption = round.options.find((option) => option.id !== round.options.find((item) => item.text === 'cat').id);
  await call('discard', { optionId: wrongOption.id });
  let snapshot = (await req(`/lobby/${code}`, { method: 'GET', token: host.token })).json.snapshot;
  assert.equal(snapshot.phase, 'round-result');
  assert.equal(snapshot.round.result.guesses.length, 2);
  assert.ok(snapshot.round.result.guesses.every((guess) => guess.playerId !== host.playerId));

  await call('advance');
  snapshot = (await req(`/lobby/${code}`, { method: 'GET', token: host.token })).json.snapshot;
  round = snapshot.round;
  assert.equal(snapshot.phase, 'initial-choices');
  assert.equal(round.wordmasterId, firstBot.id);
  assert.ok(round.prompt);
  assert.ok(dictionary.pairs.some(([prompt, , difficulty]) => prompt === round.prompt && difficulty === 'difficile'));
  assert.equal(round.initialSubmittedPlayerIds.length, 1);
  await call('initial-choice', { optionId: round.options[0].id });
  snapshot = (await req(`/lobby/${code}`, { method: 'GET', token: host.token })).json.snapshot;
  assert.equal(snapshot.phase, 'final-choices');
  assert.equal(snapshot.round.finalConfirmedPlayerIds.length, 1);
  assert.ok(snapshot.round.discardedOptionId);
  const finalChoice = snapshot.round.options.find((option) => option.id !== snapshot.round.discardedOptionId);
  snapshot = (await call('confirm', { optionId: finalChoice.id })).json.snapshot;
  assert.equal(snapshot.phase, 'round-result');
  assert.equal(snapshot.round.result.wordmasterId, firstBot.id);
  assert.ok(snapshot.round.result.guesses.some((guess) => guess.playerId === secondBot.id));
});

test('phase, role, privacy, immutable choices, forced change, and concurrent duplicate requests', async (t) => {
  const req = await fixture(t);
  const { call, get, ps } = await players(req);
  error(await call('setup', 0, setupBody), 409, 'INVALID_PHASE');
  const started = (await call('start', 0)).json.snapshot;
  assert.equal(started.phase, 'setup');
  assert.match(started.round.id, /^[a-f0-9]{32}$/);
  error(await call('setup', 1, setupBody), 403, 'FORBIDDEN');
  error(await call('setup', 0, { ...setupBody, options: ['cat', ' CAT ', 'a', 'b', 'c'] }), 400, 'INVALID_INPUT');
  error(await call('setup', 0, { ...setupBody, correctIndex: '0' }), 400, 'INVALID_INPUT');
  const ids = await setupRound(call, 0);
  assert.equal((await get(0)).json.snapshot.round.id, started.round.id);
  assert.equal((await get(1)).json.snapshot.round.id, started.round.id);
  error(await call('initial-choice', 0, choice(ids.cat)), 403, 'FORBIDDEN');
  error(await call('discard', 0, choice(ids.dog)), 409, 'INVALID_PHASE');
  error(await call('initial-choice', 1, choice('__proto__')), 400, 'INVALID_OPTION');
  const [x, y] = await Promise.all([call('initial-choice', 1, choice(ids.dog)), call('initial-choice', 1, choice(ids.cat))]);
  assert.deepEqual([x.status, y.status].sort(), [200, 409]);
  const privateChoice = (await get(1)).json.snapshot.round.initialChoices[0].optionId;
  let r = (await get(2)).json.snapshot.round;
  assert.deepEqual(r.initialChoices, []); assert.deepEqual(r.initialSubmittedPlayerIds, [ps[1].playerId]);
  assert.equal(JSON.stringify(r).includes('correctOptionId'), false);
  assert.equal((await call('initial-choice', 2, choice(ids.dog))).json.snapshot.phase, 'discard');
  r = (await get(0)).json.snapshot.round;
  assert.equal(r.initialChoices.length, 2);
  error(await call('discard', 1, choice(ids.dog)), 403, 'FORBIDDEN');
  error(await call('discard', 0, choice(ids.cat)), 400, 'INVALID_DISCARD');
  assert.equal((await call('discard', 0, choice(ids.dog))).json.snapshot.phase, 'final-choices');
  error(await call('confirm', 2, choice(ids.dog)), 400, 'INVALID_OPTION');
  error(await call('confirm', 0, choice(ids.cat)), 403, 'FORBIDDEN');
  assert.equal((await call('confirm', 1, choice(ids.cat))).status, 200);
  error(await call('confirm', 1, choice(ids.fish)), 409, 'ALREADY_SUBMITTED');
  r = (await get(2)).json.snapshot.round;
  assert.equal(r.myFinalOptionId, null); assert.equal(r.result, null); assert.equal(JSON.stringify(r).includes('correctOptionId'), false);
  const end = (await call('confirm', 2, choice(ids.fish))).json.snapshot;
  assert.equal(end.phase, 'round-result');
  assert.equal(end.round.result.correctOptionId, ids.cat);
  assert.equal(end.round.result.guesses.find((g) => g.playerId === ps[1].playerId).initialOptionId, privateChoice);
  assert.deepEqual(end.results, [end.round.result]);
  error(await call('confirm', 2, choice(ids.cat)), 409, 'INVALID_PHASE');
  error(await call('advance', 1), 403, 'FORBIDDEN');
});

for (const left of ['wrong', 'unchanged', 'changed']) for (const right of ['wrong', 'unchanged', 'changed']) {
  test(`scoring: ${left} / ${right}`, async (t) => {
    const req = await fixture(t);
    const { call, ps } = await players(req);
    await call('start', 0);
    const ids = await setupRound(call, 0);
    const initial = (type) => type === 'unchanged' ? ids.cat : ids.dog;
    const final = (type) => type === 'wrong' ? ids.fish : ids.cat;
    await call('initial-choice', 1, choice(initial(left)));
    await call('initial-choice', 2, choice(initial(right)));
    await call('discard', 0, choice(ids.bird));
    await call('confirm', 1, choice(final(left)));
    const { snapshot } = (await call('confirm', 2, choice(final(right)))).json;
    const points = (type) => type === 'wrong' ? 0 : type === 'unchanged' ? 3 : 1;
    const correct = [left, right].filter((x) => x !== 'wrong');
    const masterPoints = correct.length === 0 ? 3 : correct.length === 1 && correct[0] === 'changed' ? 1 : 0;
    assert.deepEqual(snapshot.players.map((p) => p.score), [masterPoints, points(left), points(right)]);
    assert.equal(snapshot.round.result.wordmasterPoints, masterPoints);
    assert.deepEqual(snapshot.round.result.guesses.map((g) => g.playerId), [ps[1].playerId, ps[2].playerId]);
  });
}

for (const testCase of [
  { label: 'prompt absent from dictionary', body: { prompt: 'parolainventatainesistente', options: ['cat', 'dog', 'bird', 'fish', 'horse'], correctIndex: 0 } },
  { label: 'correct translation absent for dictionary prompt', body: { prompt: 'gatto', options: ['kitten', 'dog', 'bird', 'fish', 'horse'], correctIndex: 0 } },
]) {
  test(`wordmaster earns only 2 points when nobody guesses and ${testCase.label}`, async (t) => {
    const req = await fixture(t);
    const { call } = await players(req);
    await call('start', 0);
    const ids = await setupRound(call, 0, testCase.body);
    await call('initial-choice', 1, choice(ids.dog));
    await call('initial-choice', 2, choice(ids.fish));
    await call('discard', 0, choice(ids.bird));
    await call('confirm', 1, choice(ids.fish));
    const { snapshot } = (await call('confirm', 2, choice(ids.dog))).json;
    assert.equal(snapshot.round.result.wordmasterPoints, 2);
    assert.equal(snapshot.players[0].score, 2);
  });
}

test('three rounds rotate in entry order, tie rankings, results and rematch reset', async (t) => {
  const req = await fixture(t);
  const { call, get, ps } = await players(req);
  await call('start', 0);
  const roundIds = new Set();
  for (let master = 0; master < 3; master++) {
    const before = (await get(0)).json.snapshot;
    assert.equal(before.round.wordmasterId, ps[master].playerId);
    assert.equal(before.round.number, master + 1);
    assert.ok(!roundIds.has(before.round.id));
    roundIds.add(before.round.id);
    const ids = await setupRound(call, master);
    const guessers = [0, 1, 2].filter((i) => i !== master);
    for (const i of guessers) await call('initial-choice', i, choice(ids.cat));
    await call('discard', master, choice(ids.dog));
    for (const i of guessers) await call('confirm', i, choice(ids.cat));
    const result = (await call('advance', 0)).json.snapshot;
    assert.equal(result.phase, master === 2 ? 'game-result' : 'setup');
    assert.equal(result.results.length, master + 1);
  }
  const end = (await get(2)).json.snapshot;
  assert.deepEqual(end.players.map((p) => p.score), [6, 6, 6]);
  assert.deepEqual(end.ranking.map((r) => r.rank), [1, 1, 1]);
  error(await call('rematch', 1), 403, 'FORBIDDEN');
  const replay = (await call('rematch', 0)).json.snapshot;
  assert.equal(replay.phase, 'setup'); assert.equal(replay.round.wordmasterId, ps[0].playerId);
  assert.ok(!roundIds.has(replay.round.id));
  assert.deepEqual(replay.players.map((p) => p.score), [0, 0, 0]);
  assert.deepEqual(replay.results, []); assert.equal(replay.ranking, null);
});

test('leaving during game aborts and clears all scores; new player can start', async (t) => {
  const req = await fixture(t);
  const { code, call, get, ps } = await players(req);
  const originalRoundId = (await call('start', 0)).json.snapshot.round.id;
  const ids = await setupRound(call, 0);
  await call('initial-choice', 1, choice(ids.cat)); await call('initial-choice', 2, choice(ids.cat));
  await call('discard', 0, choice(ids.dog));
  await call('confirm', 1, choice(ids.cat)); await call('confirm', 2, choice(ids.cat));
  await call('leave', 0);
  const snap = (await get(1)).json.snapshot;
  assert.equal(snap.phase, 'waiting'); assert.equal(snap.hostId, ps[1].playerId);
  assert.deepEqual(snap.players.map((p) => p.score), [0, 0]);
  assert.equal(snap.round, null); assert.deepEqual(snap.results, []);
  assert.deepEqual(snap.lastEvent, { type: 'game_aborted', playerId: ps[0].playerId, nickname: 'Ada' });
  assert.equal((await req(`/lobby/${code}/join`, { body: { nickname: 'Dan' } })).status, 201);
  const restarted = (await call('start', 1)).json.snapshot;
  assert.equal(restarted.phase, 'setup');
  assert.notEqual(restarted.round.id, originalRoundId);
});

test('room-wide inactivity expiry, activity refresh, no player eviction and revision rules', async (t) => {
  let time = 0;
  const req = await fixture(t, { ttlMs: 100, now: () => time });
  const { code, ps, call, get } = await players(req);
  time = 90;
  const before = (await get(0)).json.snapshot;
  assert.equal(before.rev, 3);
  time = 180;
  const after = (await get(1)).json.snapshot;
  assert.equal(after.players.length, 3); assert.equal(after.rev, 3);
  error(await call('start', 2), 403, 'FORBIDDEN');
  assert.equal((await get(0)).json.snapshot.rev, 3);
  time = 280;
  error(await get(0), 404, 'ROOM_NOT_FOUND');
  error(await req(`/lobby/${code}/join`, { body: { nickname: 'new' } }), 404, 'ROOM_NOT_FOUND');
  assert.ok(ps[2].token);
});