const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');

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
async function setupRound(call, master) {
  const response = await call('setup', master, setupBody);
  assert.equal(response.status, 200);
  return Object.fromEntries(response.json.snapshot.round.options.map((o) => [o.text, o.id]));
}
const choice = (optionId) => ({ optionId });
const error = (response, status, code) => { assert.equal(response.status, status); assert.equal(response.json.error.code, code); };

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