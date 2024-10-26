//const cors = require('cors');
const express = require('express');
const lobbyRoutes = require('./routes/lobbyRoutes');
require('dotenv').config();


const app = express();
const PORT = process.env.PORT || 3000;

// Middleware per il CORS
// app.use(cors());

// Middleware per il parsing del JSON
app.use(express.json());


app.get('/', (req, res) => {
    res.send('Sei su InGlisc GaMe!')
  })


app.get('/mella', (req, res) => {
    res.send('Caramella ti adoro ❤️ 🍬')
})


app.use('/lobby', lobbyRoutes);

// Avvio del server
app.listen(PORT, () => {
  console.log(`Server in ascolto su porta ${PORT}`);
});
