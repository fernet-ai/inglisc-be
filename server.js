//const cors = require('cors');
const express = require('express');
const app = express();
const PORT = 8080;


// Middleware per il CORS
// app.use(cors());

// Middleware per il parsing del JSON
app.use(express.json());

// Memoria per le lobby
const lobbies = {};



app.get('/', (req, res) => {
    res.send('Sei su InGlisc GaMe!')
  })


// Endpoint per creare una lobby
app.post('/lobby', (req, res) => {
  const { code } = req.body;
  
  // Verifica se il codice della lobby esiste già
  if (lobbies[code]) {
    return res.status(400).json({ message: 'Lobby già esistente.' });
  }

  lobbies[code] = { users: [] };
  res.status(201).json({ message: 'Lobby creata.', code });
});

// Endpoint per unirsi a una lobby
app.post('/lobby/:code/join', (req, res) => {
  const { code } = req.params;
  const { nickname } = req.body;

  // Controlla se la lobby esiste
  if (!lobbies[code]) {
    return res.status(404).json({ message: 'Lobby non trovata.' });
  }

  // Verifica se l'utente è già presente
  if (lobbies[code].users.includes(nickname)) {
    return res.status(400).json({ message: 'Nickname già in uso nella lobby.' });
  }

  // Aggiungi l'utente alla lobby
  lobbies[code].users.push(nickname);
  res.status(200).json({ message: 'Unito alla lobby.', users: lobbies[code].users });
});

// Endpoint per visualizzare gli utenti di una lobby
app.get('/lobby/:code/users', (req, res) => {
  const { code } = req.params;

  // Controlla se la lobby esiste
  if (!lobbies[code]) {
    return res.status(404).json({ message: 'Lobby non trovata.' });
  }

  res.status(200).json({ users: lobbies[code].users });
});

// Avvio del server
app.listen(PORT, () => {
  console.log(`Server in ascolto su porta ${PORT}`);
});
