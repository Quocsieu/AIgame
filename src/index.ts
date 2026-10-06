import http from 'node:http';
import { app } from './app.js';
import { multiplayerWsServer } from './multiplayer/room.websocket.js';

const PORT = parseInt(process.env.PORT || '3000', 10);

const server = http.createServer(app);
multiplayerWsServer.attach(server);

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

