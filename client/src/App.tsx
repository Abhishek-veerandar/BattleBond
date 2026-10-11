import { useGame } from './net';
import { Stage } from './ui';
import { LobbyScreen, TitleScreen } from './screens/Menus';
import { BattleScreen } from './screens/Battle';

export function App() {
  const game = useGame();
  const { phase, seat } = game.state;
  return (
    <Stage>
      {phase === 'battle' && seat ? (
        <BattleScreen game={game} />
      ) : phase === 'lobby' ? (
        <LobbyScreen game={game} />
      ) : (
        <TitleScreen game={game} />
      )}
    </Stage>
  );
}
