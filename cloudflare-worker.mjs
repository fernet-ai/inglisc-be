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
      this.app = createApp({
        state,
        allowedOrigins: env.ALLOWED_ORIGINS || '',
        environment: env.ENVIRONMENT || 'production',
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