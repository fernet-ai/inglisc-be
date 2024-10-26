const express = require('express');
const jsonParser = require('./middlewares/jsonParser');
const corsMiddleware = require('./middlewares/corsMiddleware');
const lobbyRoutes = require('./routes/lobbyRoutes');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const ENVIRONMENT = process.env.ENVIRONMENT;


// Middleware per il parsing del JSON
app.use(jsonParser);

// Middleware per il CORS
app.use(corsMiddleware);


app.use('/lobby', lobbyRoutes);


app.get('/', (req, res) => {
  res.send('Sei su InGlisc GaMe!')
})


app.get('/mella', (req, res) => {
  res.send('Caramella ti adoro ❤️ 🍬')
})

// Avvio del server
app.listen(PORT, () => {
  console.log(`Server in ascolto su porta ${PORT} su ambiente di ${ENVIRONMENT}`);
});