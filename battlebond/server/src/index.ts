import { Server } from 'colyseus';
import { BattleRoom } from './rooms/BattleRoom';

const port = Number(process.env.PORT ?? 2567);

const gameServer = new Server();
gameServer.define('battle', BattleRoom);

gameServer.listen(port).then(() => {
  console.log(`Tag Team game server listening on ws://localhost:${port}`);
});
