import { useState, useEffect } from 'react';
import PixiGame from './PixiGame.tsx';

import { useElementSize } from 'usehooks-ts';
import { Stage } from '@pixi/react';
import { ConvexProvider, useConvex, useQuery } from 'convex/react';
import PlayerDetails from './PlayerDetails.tsx';
import { api } from '../../convex/_generated/api';
import { useWorldHeartbeat } from '../hooks/useWorldHeartbeat.ts';
import { useHistoricalTime } from '../hooks/useHistoricalTime.ts';
import { DebugTimeManager } from './DebugTimeManager.tsx';
import { GameId } from '../../convex/aiTown/ids.ts';
import { useServerGame } from '../hooks/serverGame.ts';

export const SHOW_DEBUG_UI = !!import.meta.env.VITE_SHOW_DEBUG_UI;

// Hook to detect mobile screens
const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  return isMobile;
};

export default function Game() {
  const convex = useConvex();
  const isMobile = useIsMobile();
  const [selectedElement, setSelectedElement] = useState<{
    kind: 'player';
    id: GameId<'players'>;
  }>();
  const [showMobilePanel, setShowMobilePanel] = useState(false);
  const [gameWrapperRef, { width, height }] = useElementSize();

  const worldStatus = useQuery(api.world.defaultWorldStatus);
  const worldId = worldStatus?.worldId;
  const engineId = worldStatus?.engineId;

  const game = useServerGame(worldId);

  // Send a periodic heartbeat to our world to keep it alive.
  useWorldHeartbeat();

  const worldState = useQuery(api.world.worldState, worldId ? { worldId } : 'skip');
  const { historicalTime, timeManager } = useHistoricalTime(worldState?.engine);

  // Auto-show panel on mobile when player is selected
  useEffect(() => {
    if (isMobile && selectedElement) {
      setShowMobilePanel(true);
    }
  }, [isMobile, selectedElement]);

  if (!worldId || !engineId || !game) {
    return null;
  }

  const handleSetSelectedElement = (element: typeof selectedElement) => {
    setSelectedElement(element);
    if (isMobile && element) {
      setShowMobilePanel(true);
    }
  };

  return (
    <>
      {SHOW_DEBUG_UI && <DebugTimeManager timeManager={timeManager} width={200} height={100} />}
      <div className="w-full h-full relative overflow-hidden bg-brown-900" ref={gameWrapperRef}>
        <Stage width={width} height={height} options={{ backgroundColor: 0x7ab5ff }}>
          <ConvexProvider client={convex}>
            <PixiGame
              game={game}
              worldId={worldId}
              engineId={engineId}
              width={width}
              height={height}
              historicalTime={historicalTime}
              setSelectedElement={handleSetSelectedElement}
            />
          </ConvexProvider>
        </Stage>

        {/* Desktop: Right-side overlay */}
        {!isMobile && (
          <div className="absolute top-0 right-0 z-10 h-full w-80 lg:w-96 p-4 flex flex-col pointer-events-auto overflow-y-auto">
            <PlayerDetails
              worldId={worldId}
              engineId={engineId}
              game={game}
              playerId={selectedElement?.id}
              setSelectedElement={setSelectedElement}
            />
          </div>
        )}

        {/* Mobile: Bottom sheet */}
        {isMobile && (
          <>
            {/* Tap hint when no player selected */}
            {!selectedElement && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-black/70 text-white px-4 py-2 rounded-full text-sm pointer-events-none">
                Tap an agent to view details
              </div>
            )}

            {/* Bottom sheet panel */}
            <div
              className={`absolute bottom-0 left-0 right-0 z-20 bg-brown-900/95 backdrop-blur transition-transform duration-300 ${
                showMobilePanel && selectedElement ? 'translate-y-0' : 'translate-y-full'
              }`}
              style={{ maxHeight: '60vh' }}
            >
              {/* Handle bar */}
              <div
                className="flex justify-center py-2 cursor-pointer"
                onClick={() => setShowMobilePanel(false)}
              >
                <div className="w-12 h-1 bg-white/30 rounded-full" />
              </div>

              <div className="p-4 overflow-y-auto" style={{ maxHeight: 'calc(60vh - 24px)' }}>
                <PlayerDetails
                  worldId={worldId}
                  engineId={engineId}
                  game={game}
                  playerId={selectedElement?.id}
                  setSelectedElement={setSelectedElement}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
