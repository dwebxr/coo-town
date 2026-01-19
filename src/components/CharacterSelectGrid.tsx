import clsx from 'clsx';
import { CharacterDefinition } from '../lib/characterRegistry';

type Props = {
  characters: CharacterDefinition[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
};

export default function CharacterSelectGrid({ characters, selectedId, onSelect }: Props) {
  return (
    <div className="grid grid-cols-4 sm:grid-cols-5 gap-3">
      {characters.map((character) => {
        const isSelected = selectedId === character.name;
        const label = character.displayName ?? character.name;
        const imageUrl = character.portraitUrl ?? character.textureUrl;
        return (
          <button
            key={character.name}
            type="button"
            onClick={() => onSelect(character.name)}
            className={clsx(
              'border-2 px-2 py-2 text-left transition',
              isSelected ? 'border-emerald-400' : 'border-white/20 hover:border-white/60',
            )}
          >
            <div className="bg-brown-200 p-1">
              <img
                src={imageUrl}
                alt={label}
                className="h-14 w-14 sm:h-16 sm:w-16 rounded-sm object-cover object-top"
                style={{ imageRendering: 'pixelated' }}
                loading="lazy"
              />
            </div>
            <div className="mt-2 text-[10px] uppercase text-white/80 truncate">{label}</div>
            {character.isCustom && (
              <div className="text-[9px] uppercase text-emerald-300">Custom</div>
            )}
          </button>
        );
      })}
    </div>
  );
}
