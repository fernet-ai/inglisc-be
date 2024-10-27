
const lobbies = {};

// Per creare una lobby ---------------------------------------------------
exports.createLobby = (req, res) => {
  const { code } = req.body;
  
  // Verifica se il codice della lobby esiste già
  if (lobbies[code]) {
    return res.status(400).json({ message: `Lobby "${code}" già esistente.` });
  }

  lobbies[code] = { users: [] };
  res.status(201).json({ message: `Lobby "${code}" creata.`, code });
};

  
 // per unirsi a una lobby -------------------------------------------------
exports.joinLobby = (req, res) => {
  const { code } = req.params;
  const { nickname } = req.body;

  // Controlla se la lobby esiste
  if (!lobbies[code]) {
    return res.status(404).json({ message: `Lobby "${code}" non trovata.` });
  }

  // Verifica se l'utente è già presente
  if (lobbies[code].users.includes(nickname)) {
    return res.status(400).json({ message: `il Nickname "${nickname}" già in uso nella lobby "${code}".` });
  }

  // Aggiungi l'utente alla lobby
  lobbies[code].users.push(nickname);
  res.status(200).json({ message: `"${nickname}" si è unito alla lobby "${code}".`, users: lobbies[code].users });
};




// per visualizzare gli utenti di una lobby ------------------------------
exports.getUsersInLobby = (req, res) => {
  const { code } = req.params;

  // Controlla se la lobby esiste
  if (!lobbies[code]) {
    return res.status(404).json({ message: 'Lobby non trovata.' });
  }

  res.status(200).json({ users: lobbies[code].users });
};