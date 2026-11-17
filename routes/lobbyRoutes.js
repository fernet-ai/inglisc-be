const express = require('express');
const { bodyFields } = require('../game');

module.exports = function lobbyRoutes(store) {
	const router = express.Router();
	router.post('/', (req, res) => {
		const { room, player } = store.create(req.body);
		res.status(201).json({ playerId: player.id, token: player.token, snapshot: store.snapshot(room, player) });
	});
	router.post('/:code/join', (req, res) => {
		const room = store.get(req.params.code);
		const player = store.join(room, req.body);
		res.status(201).json({ playerId: player.id, token: player.token, snapshot: store.snapshot(room, player) });
	});
	router.use('/:code', (req, res, next) => {
		req.room = store.get(req.params.code);
		req.player = store.authenticate(req.room, req.get('Authorization'));
		next();
	});
	router.get('/:code', (req, res) => res.json({ snapshot: store.snapshot(req.room, req.player) }));
	router.post('/:code/leave', (req, res) => {
		bodyFields(req.body === undefined ? {} : req.body, []);
		store.leave(req.room, req.player);
		res.json({ left: true });
	});
	const action = (path, fn, hasBody = false) => router.post(`/:code/${path}`, (req, res) => {
		if (!hasBody) bodyFields(req.body === undefined ? {} : req.body, []);
		fn(req.room, req.player, req.body);
		res.json({ snapshot: store.snapshot(req.room, req.player) });
	});
	action('start', (room, player) => store.start(room, player));
	action('setup', store.setup, true);
	action('initial-choice', store.initial, true);
	action('discard', store.discard, true);
	action('confirm', store.confirm, true);
	action('advance', store.advance);
	action('rematch', (room, player) => store.start(room, player, true));
	return router;
};



