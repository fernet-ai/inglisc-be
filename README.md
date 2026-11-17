# InGliSc backend

Backend REST in Node.js ed Express che gestisce le lobby private e lo stato autorevole del gioco InGliSc. È progettato per una rete locale o per un piccolo deployment controllato.

## Indice

- [Requisiti](#requisiti)
- [Avvio rapido](#avvio-rapido)
- [API REST](#api-rest)
- [Creazione delle lobby](#creazione-delle-lobby)
- [Ciclo di una manche](#ciclo-di-una-manche)
- [Snapshot e punteggi](#snapshot-e-punteggi)
- [Errori](#errori)
- [Persistenza e sicurezza](#persistenza-e-sicurezza)
- [Test](#test)

## Requisiti

- Node.js 22 consigliato
- npm
- Porta 3000 disponibile, modificabile tramite `PORT`

## Avvio rapido

```bash
npm install
npm start
```

Il server risponde su `0.0.0.0:3000` per essere raggiungibile dagli altri dispositivi della rete LAN.

Apri nel browser:

```text
http://localhost:3000
```

Per una porta personalizzata:

```bash
PORT=4000 npm start
```

Variabili disponibili:

- `PORT`: porta HTTP, predefinita 3000
- `ENVIRONMENT`: etichetta mostrata nel log di avvio

Il backend è stato pensato per una sola istanza: lobby, sessioni e punteggi vivono in memoria e vengono cancellati al riavvio del processo.

## API REST

Le richieste con body devono usare:

```text
Content-Type: application/json
```

Le risposte sono JSON e includono `Cache-Control: no-store`. Dopo l'autenticazione, invia il token nell'header:

```text
Authorization: Bearer <token>
```

| Metodo | Percorso | Descrizione |
| --- | --- | --- |
| `POST` | `/lobby` | Crea una lobby |
| `POST` | `/lobby/:code/join` | Entra in una lobby |
| `GET` | `/lobby/:code` | Legge lo snapshot personale |
| `POST` | `/lobby/:code/start` | Avvia la partita |
| `POST` | `/lobby/:code/leave` | Esce dalla lobby |
| `POST` | `/lobby/:code/setup` | Il paroliere prepara la manche |
| `POST` | `/lobby/:code/initial-choice` | Invia la scelta iniziale |
| `POST` | `/lobby/:code/discard` | Il paroliere scarta una parola |
| `POST` | `/lobby/:code/confirm` | Conferma la scelta finale |
| `POST` | `/lobby/:code/advance` | Avanza alla manche successiva |
| `POST` | `/lobby/:code/rematch` | Avvia una nuova partita |

## Creazione delle lobby

Crea una lobby da 6 manche:

```bash
curl -X POST http://localhost:3000/lobby \
  -H 'Content-Type: application/json' \
  -d '{"nickname":"Ada","roundCount":6}'
```

Valori ammessi per `roundCount`:

- `3`
- `6`
- `9`
- `12`

Se omesso, il valore predefinito è `3`. Qualsiasi altro valore viene rifiutato.

La risposta contiene:

```json
{
  "playerId": "...",
  "token": "...",
  "snapshot": {}
}
```

Lo snapshot include `roundCount` e `totalRounds`, entrambi impostati sul numero scelto dal creatore.

I nickname devono essere unici nella lobby e non possono superare 30 caratteri. Un lobby può ospitare esattamente 3 giocatori.

### Esempio di ingresso

```bash
curl -X POST http://localhost:3000/lobby/ABC234/join \
  -H 'Content-Type: application/json' \
  -d '{"nickname":"Bob"}'
```

Il codice viene normalizzato in maiuscolo. Il creator può avviare la partita solo quando sono presenti tre giocatori.

## Ciclo di una manche

Le fasi sono:

```text
waiting
  -> setup
  -> initial-choices
  -> discard
  -> final-choices
  -> round-result
  -> setup / game-result
```

1. Il paroliere prepara un indizio italiano, cinque opzioni inglesi e indica la risposta corretta.
2. Gli altri due giocatori scelgono una risposta in segreto.
3. Dopo entrambe le scelte, il paroliere scarta una delle quattro opzioni sbagliate.
4. Gli altri due confermano la risposta finale. Possono mantenerla o cambiarla una volta; se avevano scelto l'opzione scartata devono cambiarla.
5. Il server calcola i punti e rende visibile il risultato.
6. L'host avanza alla manche successiva oppure apre la classifica finale.

Il ruolo del paroliere ruota nell'ordine di ingresso. Per una partita da 6, 9 o 12 manche il ciclo riparte con lo stesso ordine dopo ogni terna di giocatori.

### Preparazione

```json
{
  "prompt": "gatto",
  "options": ["cat", "dog", "bird", "fish", "horse"],
  "correctIndex": 0
}
```

`correctIndex` è basato sull'indice dell'array inviato dal paroliere, prima dello shuffle casuale delle opzioni.

## Snapshot e punteggi

La lettura dello stato è personalizzata per il giocatore autenticato:

```bash
curl http://localhost:3000/lobby/ABC234 \
  -H 'Authorization: Bearer <token>'
```

Lo snapshot include:

- `code`: codice della lobby
- `roundCount` e `totalRounds`: numero totale scelto
- `phase`: fase corrente
- `hostId`: creatore o nuovo host
- `me`: ID del giocatore autenticato
- `players`: nickname e punteggi
- `round`: manche corrente e scelte
- `results`: risultati conclusi
- `ranking`: classifica finale
- `rev`: revisione monotona dello stato

La soluzione corretta non viene inclusa negli snapshot visibili agli altri giocatori prima del risultato.

### Punteggi

Ogni giocatore guadagna:

- **+3**: risposta corretta senza cambio
- **+1**: risposta corretta dopo il cambio
- **0**: risposta sbagliata

Il paroliere guadagna:

- **+3**: nessuno indovina
- **+1**: solo uno indovina cambiando idea
- **0**: negli altri casi

In caso di pareggio, i giocatori condividono la stessa posizione nella classifica.

## Uscita e lobby

- Se un giocatore esce mentre è in lobby, viene rimosso dalla lobby.
- Se l'host esce dalla lobby, il ruolo passa al primo giocatore restante.
- Se qualcuno esce durante una partita, la partita viene interrotta, i punteggi azzerati e la lobby torna in attesa.
- Quando tutti escono, la lobby viene eliminata.
- Una disconnessione temporanea lascia il posto riservato fino alla scadenza.

Le lobby inattive vengono cancellate dopo 24 ore dalla loro ultima attività. Il controllo viene eseguito periodicamente ogni minuto.

## Errori

Le risposte di errore hanno questo formato:

```json
{
  "error": {
    "code": "ROOM_NOT_FOUND",
    "message": "Room not found or expired."
  }
}
```

Codici principali:

| Stato | Codici |
| --- | --- |
| 400 | `INVALID_INPUT`, `INVALID_JSON`, `INVALID_OPTION`, `INVALID_DISCARD` |
| 401 | `UNAUTHORIZED` |
| 403 | `FORBIDDEN` |
| 404 | `ROOM_NOT_FOUND`, `NOT_FOUND` |
| 409 | `INVALID_PHASE`, `ALREADY_SUBMITTED`, `NICKNAME_TAKEN`, `ROOM_FULL`, `NEED_THREE_PLAYERS` |
| 413 | `BODY_TOO_LARGE` |
| 415 | `UNSUPPORTED_MEDIA_TYPE` |
| 500 | `INTERNAL_ERROR` |

Se una richiesta può essere stata elaborata ma la risposta è stata persa, rileggi lo snapshot invece di ripetere ciecamente l'azione.

## Persistenza e sicurezza

Questo backend è un prototipo per rete locale o demo controllate:

- nessun database
- nessun account utente
- nessuna chat o matchmaking pubblico
- token bearer gestiti in memoria
- nessuna protezione di produzione avanzata
- nessuna garanzia multiistanza

Per un deployment pubblico servono TLS/HTTPS, database o Redis, rate limiting, protezione contro abuso, logging gestito e una gestione sicura dei token.

Il middleware CORS permette richieste web, ma non rende il sistema sicuro per Internet.

## Test

Avvia tutte le test suite:

```bash
npm test
```

La suite usa istanze Express effimere su porte casuali e verifica:

- lobby e nickname
- autenticazione tramite token
- valori ammessi di `roundCount`
- tutti i ruoli e le fasi
- scelte, scarto e conferme
- punteggi
- rotazione delle manche
- rivincita
- abbandoni e scadenze

Per la verifica completa, avvia anche il frontend nella repository `inglisc`.
