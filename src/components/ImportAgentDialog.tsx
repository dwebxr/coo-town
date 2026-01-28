import { useEffect, useMemo, useState } from 'react';
import ReactModal from 'react-modal';
import { useAction, useConvex, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { waitForInput } from '../hooks/sendInput';
import { useCharacters } from '../lib/characterRegistry';

const modalStyles = {
  overlay: {
    backgroundColor: 'rgb(0, 0, 0, 85%)',
    zIndex: 20,
  },
  content: {
    top: '50%',
    left: '50%',
    right: 'auto',
    bottom: 'auto',
    marginRight: '-50%',
    transform: 'translate(-50%, -50%)',
    maxWidth: '850px',
    width: '90%',
    border: '4px solid #4a3b5b',
    borderRadius: '4px',
    padding: '0',
    background: '#23202b',
    color: 'white',
    fontFamily: '"Upheaval Pro", "sans-serif"',
    boxShadow: '0 0 0 4px #2d2438, 0 10px 20px rgba(0,0,0,0.5)',
  },
};

const DEFAULT_PLAN = 'You want to explore the town and meet new people.';

type ElizaAgent = {
  id: string;
  name: string;
  characterName?: string;
  bio?: string;
  status?: string;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onCreateCharacter?: () => void;
};

export default function ImportAgentDialog({ isOpen, onClose, onCreateCharacter }: Props) {
  const { characters } = useCharacters();
  const [elizaAgents, setElizaAgents] = useState<ElizaAgent[]>([]);
  const [selectedElizaAgent, setSelectedElizaAgent] = useState<ElizaAgent | null>(null);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [plan, setPlan] = useState(DEFAULT_PLAN);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const worldStatus = useQuery(api.world.defaultWorldStatus);
  const worldId = worldStatus?.worldId;
  const userTokenIdentifier = useQuery(api.world.userStatus, worldId ? { worldId } : 'skip');

  const fetchElizaAgents = useAction(api.elizaAgent.actions.fetchElizaAgents);
  const importElizaAgent = useAction(api.elizaAgent.actions.importElizaAgent);
  const convex = useConvex();

  const customCharacters = useMemo(() => {
    const filtered = characters.filter((character) => character.isCustom);
    if (!userTokenIdentifier || userTokenIdentifier === 'skip') {
      return filtered;
    }
    return filtered.filter((character) => character.ownerId === userTokenIdentifier);
  }, [characters, userTokenIdentifier]);

  const hasCustomCharacters = customCharacters.length > 0;

  // Fetch ElizaOS agents when dialog opens
  useEffect(() => {
    if (!isOpen) {
      setError(null);
      setSelectedElizaAgent(null);
      setPlan(DEFAULT_PLAN);
      setElizaAgents([]);
      return;
    }

    const loadAgents = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const agents = await fetchElizaAgents({});
        setElizaAgents(agents || []);
        if (agents && agents.length > 0) {
          setSelectedElizaAgent(agents[0]);
        }
      } catch (e: any) {
        console.error('Failed to fetch ElizaOS agents:', e);
        setError(e.message || 'Failed to fetch agents from ElizaOS server');
      } finally {
        setIsLoading(false);
      }
    };

    loadAgents();
  }, [isOpen, fetchElizaAgents]);

  // Auto-select first character when available
  useEffect(() => {
    if (customCharacters.length > 0 && !selectedCharacterId) {
      setSelectedCharacterId(customCharacters[0].name);
    }
  }, [customCharacters, selectedCharacterId]);

  const selectedCharacter = useMemo(
    () => customCharacters.find((character) => character.name === selectedCharacterId) ?? null,
    [customCharacters, selectedCharacterId],
  );

  const handleImport = async () => {
    if (!worldId) {
      setError('World is not ready yet.');
      return;
    }
    if (!selectedElizaAgent) {
      setError('Select an ElizaOS agent to import.');
      return;
    }
    if (!hasCustomCharacters) {
      setError('Create a custom character sprite first.');
      return;
    }
    if (!selectedCharacterId) {
      setError('Select a character sprite.');
      return;
    }

    setError(null);
    setIsImporting(true);

    try {
      const result = await importElizaAgent({
        worldId,
        elizaAgentId: selectedElizaAgent.id,
        name: selectedElizaAgent.name,
        character: selectedCharacterId,
        identity: selectedElizaAgent.bio || `An agent named ${selectedElizaAgent.name}`,
        plan: plan.trim() || DEFAULT_PLAN,
        personality: [],
      });

      const { inputId } = result;

      await waitForInput(convex, inputId as Id<'inputs'>, {
        timeoutMs: 15000,
        timeoutMessage: 'World is still processing. Try again in a moment.',
      });

      onClose();
    } catch (error: any) {
      console.error(error);
      if (error instanceof ConvexError) {
        setError(error.data);
      } else {
        setError(error?.message ?? 'Failed to import agent.');
      }
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <ReactModal
      isOpen={isOpen}
      onRequestClose={onClose}
      style={modalStyles}
      contentLabel="Import ElizaOS Agent"
      ariaHideApp={false}
    >
      <div className="flex flex-col h-full bg-[#23202b] text-white font-dialog">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b-4 border-[#4a3b5b] bg-[#2d2438]">
          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-[#4a3b5b] rounded-sm">
              <span className="text-lg">📥</span>
            </div>
            <div>
              <h2 className="text-xl leading-none text-[#a395b8] uppercase tracking-wide">
                Import ElizaOS Agent
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#a395b8] hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Main Content */}
        <div className="flex flex-1 p-4 gap-4 overflow-hidden">
          {/* Left Column: Agent Selection */}
          <div className="w-1/2 flex flex-col gap-2">
            <label className="text-xs uppercase tracking-widest text-[#6d607d] font-bold">
              ElizaOS Agents
            </label>

            {isLoading ? (
              <div className="flex-1 bg-[#1a1821] border-4 border-[#2d2438] flex items-center justify-center">
                <div className="text-[#6d607d] text-sm">Loading agents...</div>
              </div>
            ) : elizaAgents.length === 0 ? (
              <div className="flex-1 bg-[#1a1821] border-4 border-[#2d2438] flex items-center justify-center p-4">
                <div className="text-center">
                  <div className="text-[#4a3b5b] text-2xl mb-2">🤖</div>
                  <p className="text-[#6d607d] text-sm">No agents found on ElizaOS server</p>
                </div>
              </div>
            ) : (
              <div className="flex-1 bg-[#1a1821] border-4 border-[#2d2438] overflow-y-auto">
                {elizaAgents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => setSelectedElizaAgent(agent)}
                    className={`w-full p-3 text-left border-b border-[#2d2438] transition-colors ${
                      selectedElizaAgent?.id === agent.id
                        ? 'bg-[#3b8f6e]/30 border-l-4 border-l-[#3b8f6e]'
                        : 'hover:bg-[#2d2438]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg">🤖</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-sm text-white truncate">{agent.name}</div>
                        {agent.bio && (
                          <div className="text-[10px] text-[#a395b8] truncate">{agent.bio}</div>
                        )}
                      </div>
                      {agent.status === 'active' && (
                        <span className="text-[8px] px-1.5 py-0.5 bg-[#3b8f6e] text-white rounded uppercase">
                          Active
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right Column: Sprite Selection & Settings */}
          <div className="w-1/2 flex flex-col gap-4 overflow-y-auto pr-2">
            {/* Sprite Selection */}
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-widest text-[#6d607d] font-bold">
                Select Sprite
              </label>

              {!hasCustomCharacters ? (
                <div className="bg-[#1a1821] border-4 border-[#2d2438] p-4 text-center">
                  <div className="text-[#4a3b5b] text-2xl mb-2">🎨</div>
                  <p className="text-[#6d607d] text-sm mb-3">No custom characters available</p>
                  {onCreateCharacter && (
                    <button
                      onClick={() => {
                        onClose();
                        onCreateCharacter();
                      }}
                      className="px-4 py-2 bg-[#4a3b5b] hover:bg-[#5a4b6b] text-white text-xs uppercase tracking-wider transition-colors"
                    >
                      Create Character
                    </button>
                  )}
                </div>
              ) : (
                <div className="bg-[#1a1821] border-4 border-[#2d2438] p-2 max-h-40 overflow-y-auto">
                  <div className="grid grid-cols-4 gap-2">
                    {customCharacters.map((character) => (
                      <button
                        key={character.name}
                        onClick={() => setSelectedCharacterId(character.name)}
                        className={`relative aspect-square border-2 transition-all ${
                          selectedCharacterId === character.name
                            ? 'border-[#3b8f6e] ring-2 ring-[#3b8f6e]/50'
                            : 'border-[#2d2438] hover:border-[#4a3b5b]'
                        }`}
                      >
                        <img
                          src={character.portraitUrl || character.textureUrl}
                          alt={character.displayName ?? character.name}
                          className="w-full h-full object-contain"
                          style={{ imageRendering: 'pixelated' }}
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Selected Character Preview */}
            {selectedCharacter && (
              <div className="bg-[#1a1821] border-4 border-[#2d2438] p-3 flex items-center gap-3">
                <img
                  src={selectedCharacter.portraitUrl || selectedCharacter.textureUrl}
                  alt={selectedCharacter.displayName ?? selectedCharacter.name}
                  className="w-12 h-12 object-contain"
                  style={{ imageRendering: 'pixelated' }}
                />
                <div>
                  <div className="text-sm font-bold text-white">
                    {selectedCharacter.displayName ?? selectedCharacter.name}
                  </div>
                  <div className="text-[10px] text-[#6d607d]">Selected Sprite</div>
                </div>
              </div>
            )}

            {/* Initial Plan */}
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-widest text-[#6d607d] font-bold">
                Initial Plan
              </label>
              <textarea
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
                placeholder={DEFAULT_PLAN}
                rows={3}
                className="w-full bg-[#1a1821] border-2 border-[#2d2438] focus:border-[#4a3b5b] px-3 py-2 text-sm text-[#e0dce6] outline-none transition-colors placeholder:text-[#4a3b5b] resize-none"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 pt-0 mt-auto shrink-0">
          {error && (
            <div className="mb-4 px-3 py-2 bg-red-900/30 border border-red-500/30 text-red-200 text-xs flex items-center gap-2">
              <span>⚠️</span> {error}
            </div>
          )}

          {selectedElizaAgent && (
            <div className="mb-4 px-3 py-2 bg-[#2d2438] border border-[#4a3b5b] text-sm">
              <span className="text-[#6d607d]">Importing:</span>{' '}
              <span className="text-white font-bold">{selectedElizaAgent.name}</span>
              {selectedElizaAgent.bio && (
                <span className="text-[#a395b8]"> - {selectedElizaAgent.bio}</span>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t-2 border-[#2d2438]">
            <button
              onClick={onClose}
              className="px-6 py-2 text-xs uppercase font-bold tracking-wider text-[#a395b8] hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={isImporting || isLoading || !selectedElizaAgent || !hasCustomCharacters}
              className={`px-6 py-2 bg-[#3b8f6e] border-b-4 border-[#23634a] text-white text-xs uppercase font-bold tracking-widest hover:bg-[#46a881] hover:translate-y-[-1px] active:translate-y-[1px] active:border-b-0 transition-all ${
                isImporting || isLoading || !selectedElizaAgent || !hasCustomCharacters
                  ? 'opacity-50 cursor-not-allowed'
                  : ''
              }`}
            >
              {isImporting ? 'Importing...' : 'Import Agent'}
            </button>
          </div>
        </div>
      </div>
    </ReactModal>
  );
}
