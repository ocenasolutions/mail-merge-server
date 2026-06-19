const { WebSocketServer } = require('ws');
const logger = require('../../utils/logger');

class CampaignRealtimeHub {
  constructor() {
    this.server = null;
    this.clients = new Set();
    this.wss = null;
  }

  attach(server) {
    if (this.wss) {
      return this.wss;
    }

    this.server = server;
    this.wss = new WebSocketServer({ server, path: '/ws/campaigns' });

    this.wss.on('connection', (socket) => {
      this.clients.add(socket);
      socket.send(JSON.stringify({
        type: 'connected',
        timestamp: new Date().toISOString()
      }));

      socket.on('close', () => {
        this.clients.delete(socket);
      });

      socket.on('error', (error) => {
        logger.warn({ err: error }, 'Realtime websocket client error');
      });
    });

    logger.info({ path: '/ws/campaigns' }, 'Campaign realtime hub attached');
    return this.wss;
  }

  broadcast(type, payload = {}) {
    if (!this.wss) return;
    const message = JSON.stringify({
      type,
      payload,
      timestamp: new Date().toISOString()
    });

    for (const client of this.clients) {
      if (client.readyState === 1) {
        client.send(message);
      }
    }
  }
}

module.exports = new CampaignRealtimeHub();
