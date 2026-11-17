# InGliSc backend

Backend Express per una partita privata di tre giocatori. Richiede Node.js 18 o superiore (testato con Node 22). Nella directory del backend eseguire `npm install`, `npm start` o `npm test`. La porta predefinita è 3000; `PORT` la modifica, `ENVIRONMENT` cambia solo il messaggio di avvio. Il processo mantiene tutto in memoria: il riavvio cancella lobby, sessioni e partite. Eseguire una sola istanza; non esiste persistenza o sincronizzazione fra istanze.

## Protocollo

Le risposte dell'API `/lobby` sono JSON. Inviare `Content-Type: application/json` per ogni body, massimo 16 KB. Le azioni senza parametri accettano body assente oppure `{}`. I campi aggiuntivi sono rifiutati. I codici lobby sono sei caratteri casuali non ambigui e possono essere inseriti in minuscolo. Non esiste un elenco pubblico delle lobby.

Creazione e ingresso restituiscono `{ "playerId": "...", "token": "...", "snapshot": { ... } }` con HTTP 201. Il token è una credenziale segreta casuale da conservare sul dispositivo e **non** condividere: chi lo possiede controlla quel giocatore. Per ogni altra richiesta inviare `Authorization: Bearer <token>`; il solo `playerId` non autentica. L'uscita invalida il token; la riconnessione usa lo stesso token. Tutte le altre azioni riuscite restituiscono HTTP 200 e `{ "snapshot": { ... } }`, tranne l'uscita che restituisce `{ "left": true }`. `GET` e azioni non restituiscono mai token. Le risposte sono `Cache-Control: no-store`; CORS consente origini web qualsiasi e gli header `Authorization` e `Content-Type`.

| Metodo e percorso | Body | Autorizzazione e comportamento |
| --- | --- | --- |
| POST `/lobby` | `{ "nickname": "Ada" }` | Pubblico; crea lobby e inserisce automaticamente l'host. |
| POST `/lobby/:code/join` | `{ "nickname": "Bob" }` | Pubblico, solo `waiting`; massimo 3 giocatori. |
| GET `/lobby/:code` | nessuno | Token giocatore; snapshot personale, utile per polling. |
| POST `/lobby/:code/leave` | assente o `{}` | Token giocatore; abbandona, eventualmente interrompendo la partita. |
| POST `/lobby/:code/start` | assente o `{}` | Solo host in `waiting` con esattamente 3 giocatori. |
| POST `/lobby/:code/setup` | `{ "prompt": "gatto", "options": ["cat", "dog", "bird", "fish", "horse"], "correctIndex": 0 }` | Solo paroliere in `setup`. `correctIndex` è l'indice intero **zero-based nell'array inviato**, non nell'array mescolato. |
| POST `/lobby/:code/initial-choice` | `{ "optionId": "..." }` | Solo un giocatore non paroliere in `initial-choices`, una volta. |
| POST `/lobby/:code/discard` | `{ "optionId": "..." }` | Solo paroliere in `discard`; opzione non corretta, scelta o meno. |
| POST `/lobby/:code/confirm` | `{ "optionId": "..." }` | Solo un giocatore non paroliere in `final-choices`, una volta; non può selezionare l'opzione scartata. |
| POST `/lobby/:code/advance` | assente o `{}` | Solo host in `round-result`; inizia la manche successiva oppure mostra la classifica dopo la terza. |
| POST `/lobby/:code/rematch` | assente o `{}` | Solo host in `game-result`; azzera i punteggi e inizia una nuova partita. |

I nickname sono stringhe di 1–30 unità UTF-16, l'indizio 1–120 e ogni opzione 1–80, dopo normalizzazione Unicode NFKC e rimozione degli spazi iniziali/finali; caratteri di controllo e formattazione Unicode non sono ammessi. I nickname devono essere unici nella lobby e le cinque opzioni devono essere distinte, confrontando i valori normalizzati senza distinzione tra maiuscole e minuscole. Il server non verifica che l'indizio sia italiano, che le opzioni siano inglesi o che la traduzione/sinonimia sia corretta: è responsabilità del paroliere. Le opzioni sono mescolate in modo casuale e hanno ID opachi generati dal server.

## Snapshot completo

Ogni snapshot ha esattamente questi campi (gli array possono essere vuoti e i campi indicati null possono essere null):

```json
{
	"code": "ABC234", "rev": 4, "phase": "initial-choices", "hostId": "player-id", "me": "player-id",
	"players": [{ "id": "player-id", "nickname": "Ada", "score": 0 }],
	"lastEvent": null,
	"round": {
		"id": "round-id", "number": 1, "wordmasterId": "player-id", "prompt": "gatto",
		"options": [{ "id": "option-id", "text": "cat" }],
		"discardedOptionId": null,
		"initialSubmittedPlayerIds": [], "initialChoices": [],
		"finalConfirmedPlayerIds": [], "myFinalOptionId": null, "result": null
	},
	"results": [], "ranking": null
}
```

L'esempio abbrevia gli array `players` e `options`: durante una manche configurata sono rispettivamente tre e cinque. Ogni manche ha un `id` casuale distinto, stabile per tutta la sua durata anche quando la numerazione riparte in una rivincita. `rev` parte da 1 e aumenta una volta per ogni mutazione riuscita; letture, errori e aggiornamento della scadenza non cambiano la revisione. `me` è l'ID del giocatore autenticato, non il token. L'ordine di `players` è quello d'ingresso. `round` è null in `waiting`; in `setup`, `prompt` è null e `options` è vuoto. `lastEvent` è null o `{ "type": "game_aborted", "playerId": "...", "nickname": "..." }` dopo un'uscita durante la partita; viene cancellato al prossimo avvio. `results` contiene i risultati delle manche concluse nella partita corrente.

`initialSubmittedPlayerIds` e `finalConfirmedPlayerIds` indicano solo chi ha agito. `initialChoices` contiene oggetti `{ "playerId": "...", "optionId": "..." }`: fino a entrambe le scelte ogni giocatore vede solo la propria, poi tutti vedono entrambe. `myFinalOptionId` è la propria conferma o null, mai la scelta finale altrui prima del risultato. La soluzione non compare in alcuno snapshot fino alla risoluzione. `discardedOptionId` è null finché il paroliere non scarta. Dopo entrambe le conferme `round.result`, presente anche in `results`, è:

```json
{
	"number": 1, "wordmasterId": "...", "prompt": "gatto",
	"options": [{ "id": "...", "text": "cat" }],
	"correctOptionId": "...", "discardedOptionId": "...",
	"guesses": [{ "playerId": "...", "initialOptionId": "...", "finalOptionId": "...", "changed": false, "correct": true, "points": 3 }],
	"wordmasterPoints": 0
}
```

Anche qui le opzioni reali sono cinque e `guesses` contiene entrambi i giocatori. In `game-result`, `ranking` è un array ordinato per punteggio decrescente di `{ "playerId": "...", "score": 6, "rank": 1 }`; i pari merito hanno lo stesso rango di competizione (ad esempio 1, 1, 3). Altrimenti `ranking` è null.

## Regole e ciclo

Le fasi sono `waiting` → `setup` → `initial-choices` → `discard` → `final-choices` → `round-result`. Dopo l'avanzamento si riparte da `setup` oppure, dopo tre manche valide, si passa a `game-result`. Il paroliere ruota nell'ordine d'ingresso, iniziando dall'host al momento dell'avvio; entrambi i giocatori possono scegliere la stessa opzione iniziale. Scartata un'opzione sbagliata, ognuno conferma irrevocabilmente una risposta ancora disponibile: può mantenerla o cambiare una sola volta; se scartata deve cambiarla.

Il giocatore guadagna 3 punti se la risposta finale è corretta e invariata, 1 se corretta e cambiata, altrimenti 0. Il paroliere guadagna 3 se nessuno indovina, 1 se solo uno indovina cambiando, altrimenti 0. Il server calcola tutti i punti. Non esiste contestazione, penalità manuale o annullamento della singola manche: questa scelta modifica la costituzione originale (-1 e annullamento della manche).

Se un giocatore esce in `waiting`, l'host passa al primo rimasto quando necessario. Se esce in qualunque altra fase, la partita viene interrotta per tutti, tutti i punteggi e risultati sono cancellati, si torna a `waiting` e l'host passa al primo rimasto se necessario. L'ultimo giocatore che esce elimina la lobby. Una disconnessione temporanea non rimuove nessuno: attività di qualsiasi giocatore autenticato o ingresso riuscito rinnova l'inattività dell'intera lobby. Dopo 24 ore senza attività la lobby e tutti i token scadono; controllo su accesso e pulizia periodica ogni minuto. Nessuna espulsione individuale per inattività.

## Errori e sicurezza

Gli errori sono `{ "error": { "code": "...", "message": "..." } }` senza dati segreti. HTTP 400: `INVALID_INPUT`, `INVALID_JSON`, `INVALID_OPTION`, `INVALID_DISCARD` o `BAD_REQUEST` per altri errori di richiesta; 401 `UNAUTHORIZED`; 403 `FORBIDDEN`; 404 `ROOM_NOT_FOUND` (inesistente/scaduta) o `NOT_FOUND` (percorso); 409 `INVALID_PHASE`, `ALREADY_SUBMITTED`, `NICKNAME_TAKEN`, `ROOM_FULL`, `NEED_THREE_PLAYERS`; 413 `BODY_TOO_LARGE`; 415 `UNSUPPORTED_MEDIA_TYPE`; 500 `INTERNAL_ERROR`. Le richieste duplicate possono ricevere `ALREADY_SUBMITTED` oppure `INVALID_PHASE` se nel frattempo la fase è avanzata: dopo errori o timeout rileggere lo snapshot, senza ripetere ciecamente un'azione. Non ci sono precondizioni di revisione o chiavi di idempotenza.

Il backend non registra token, body o risposte. È un prototipo, non pronto per esposizione pubblica: usare HTTPS, proteggere i token anche in client e proxy, limitare origini e traffico, aggiungere rate limiting, difese antiabuso e hosting adatto. I codici lobby non sono credenziali forti; chi conosce un codice può entrare se c'è posto. Nessun account, database, matchmaking o chat. Il frontend usa questo contratto.
