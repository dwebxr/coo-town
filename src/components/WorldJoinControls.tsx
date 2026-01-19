import { useState } from 'react';
import { useConvex, useMutation, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import { toast } from 'react-toastify';
import { api } from '../../convex/_generated/api';
import Button from './buttons/Button';
import interactImg from '../../assets/interact.svg';
import { waitForInput } from '../hooks/sendInput';
import { useServerGame } from '../hooks/serverGame';
import JoinWorldDialog from './JoinWorldDialog';

export default function WorldJoinControls() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const worldStatus = useQuery(api.world.defaultWorldStatus);
  const worldId = worldStatus?.worldId;
  const game = useServerGame(worldId);
  const humanTokenIdentifier = useQuery(api.world.userStatus, worldId ? { worldId } : 'skip');
  const userPlayerId =
    game && humanTokenIdentifier
      ? [...game.world.players.values()].find((p) => p.human === humanTokenIdentifier)?.id
      : undefined;
  const isPlaying = !!userPlayerId;
  const joinWorld = useMutation(api.world.joinWorld);
  const leaveWorld = useMutation(api.world.leaveWorld);
  const convex = useConvex();

  const handleJoin = async (characterId: string) => {
    if (!worldId) {
      toast.error('World is not ready yet.');
      return;
    }
    setIsJoining(true);
    try {
      const inputId = await joinWorld({ worldId, character: characterId });
      await waitForInput(convex, inputId);
      setDialogOpen(false);
    } catch (error: any) {
      if (error instanceof ConvexError) {
        toast.error(error.data);
      } else {
        toast.error(error?.message ?? 'Failed to join.');
      }
    } finally {
      setIsJoining(false);
    }
  };

  const handleLeave = async () => {
    if (!worldId) {
      return;
    }
    try {
      await leaveWorld({ worldId });
    } catch (error: any) {
      toast.error(error?.message ?? 'Failed to leave.');
    }
  };

  const isDisabled = !worldId || game === undefined;
  const onClick = () => {
    if (isDisabled) return;
    if (isPlaying) {
      void handleLeave();
    } else {
      setDialogOpen(true);
    }
  };

  return (
    <>
      <Button
        imgUrl={interactImg}
        onClick={onClick}
        className={isDisabled ? 'opacity-50 pointer-events-none' : undefined}
      >
        {isPlaying ? 'Leave' : 'Join'}
      </Button>
      <JoinWorldDialog
        isOpen={dialogOpen}
        isJoining={isJoining}
        onClose={() => setDialogOpen(false)}
        onJoin={handleJoin}
      />
    </>
  );
}
