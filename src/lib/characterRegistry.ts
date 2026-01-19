import { useMemo } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { characters as builtInCharacters } from '../../data/characters';
import { standard32x32 } from '../../data/spritesheets/standard32x32';

type CharacterRegistryEntry = {
  spriteId: string;
  displayName: string;
  textureUrl: string | null;
  frameWidth: number;
  frameHeight: number;
  framesPerDirection: number;
  directions: number;
  ownerId: string;
};

export type CharacterDefinition = {
  name: string;
  displayName?: string;
  textureUrl: string;
  portraitUrl?: string | null;
  spritesheetData: typeof standard32x32;
  speed: number;
  isCustom?: boolean;
  ownerId?: string;
};

export const useCharacters = () => {
  const customSprites = useQuery(api.characterSprites.list);
  const isLoading = customSprites === undefined;
  const characters = useMemo(() => {
    const custom = (customSprites ?? [])
      .filter((sprite): sprite is CharacterRegistryEntry & { textureUrl: string } => !!sprite.textureUrl)
      .map((sprite) => ({
        name: sprite.spriteId,
        displayName: sprite.displayName,
        textureUrl: sprite.textureUrl,
        portraitUrl: sprite.textureUrl,
        spritesheetData: standard32x32,
        speed: 0.1,
        isCustom: true,
        ownerId: sprite.ownerId,
      }));
    return [...builtInCharacters, ...custom];
  }, [customSprites]);
  return { characters, isLoading, customSprites: customSprites ?? [] };
};
