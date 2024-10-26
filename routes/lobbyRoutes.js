const express = require('express');
const router = express.Router();
const lobbyController = require('../controllers/lobbyController');


router.post('/', lobbyController.createLobby);                  // POST /lobby
router.post('/:code/join', lobbyController.joinLobby);          // POST /lobby/:code/join
router.get('/:code/users', lobbyController.getUsersInLobby);    // GET  /lobby/:code/users


module.exports = router;



