const express = require('express');

// Middleware per il parsing del JSON
const jsonParser = express.json();

module.exports = jsonParser;
