import { createServer } from 'node:http';
import { DurableObject } from 'cloudflare:workers';
import { handleAsNodeRequest } from 'cloudflare:node';
import backend from './server.js';

const { createApp } = backend;

export class GameCoordinator extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ready = this.ctx.blockConcurrencyWhile(async () => {
      const state = await this.ctx.storage.get('game-state');
      const sql = this.ctx.storage.sql;
      sql.exec('CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, message TEXT NOT NULL, createdAt TEXT NOT NULL)');
      const messageStore = {
        count: () => sql.exec('SELECT COUNT(*) AS count FROM messages').one().count,
        add: ({ id, message, createdAt }) => sql.exec('INSERT INTO messages (id, message, createdAt) VALUES (?, ?, ?)', id, message, createdAt),
        list: () => sql.exec('SELECT id, message, createdAt FROM messages ORDER BY rowid').toArray(),
        delete: messageId => sql.exec('DELETE FROM messages WHERE id = ? RETURNING id', messageId).toArray().length > 0,
      };
      this.app = createApp({
        state,
        messageStore,
        allowedOrigins: env.ALLOWED_ORIGINS || '',
        environment: env.ENVIRONMENT || 'production',
        messageAdminToken: env.MESSAGE_ADMIN_TOKEN,
      });
      this.server = createServer(this.app);
      await new Promise((resolve, reject) => {
        this.server.once('error', reject);
        this.server.listen(0, resolve);
      });
      this.port = this.server.address().port;
    });
  }

  async fetch(request) {
    await this.ready;
    const response = await handleAsNodeRequest(this.port, request);
    await this.persist();
    return response;
  }

  async alarm() {
    await this.ready;
    this.app.locals.store.sweep();
    await this.persist();
  }

  async persist() {
    const state = this.app.locals.store.exportState();
    await this.ctx.storage.put('game-state', state);
    if (state.rooms.length) {
      await this.ctx.storage.setAlarm(Date.now() + 60 * 1000);
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }
}

export default {
  fetch(request, env) {
    const id = env.GAME_COORDINATOR.idFromName('global');
    return env.GAME_COORDINATOR.get(id).fetch(request);
  },
};