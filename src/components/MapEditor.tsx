import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { AnimatedSprite as PixiAnimatedSprite, Container, Stage } from '@pixi/react';
import { BaseTexture, SCALE_MODES, Spritesheet, type ISpritesheetData } from 'pixi.js';
// Map editor starts with an empty canvas; tilesets are supplied via packs.
import * as campfire from '../../data/animations/campfire.json';
import * as gentlesparkle from '../../data/animations/gentlesparkle.json';
import * as gentlewaterfall from '../../data/animations/gentlewaterfall.json';
import * as gentlesplash from '../../data/animations/gentlesplash.json';
import * as windmill from '../../data/animations/windmill.json';
const DEFAULT_MAP_WIDTH = 64;
const DEFAULT_MAP_HEIGHT = 48;
const DEFAULT_TILE_SIZE = 32;
const EMPTY_TILESET_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgCj2R1kAAAAASUVORK5CYII=';
const PACK_INDEX_PATH = 'assets/packs/index.json';

const MAP_WIDTH = DEFAULT_MAP_WIDTH;
const MAP_HEIGHT = DEFAULT_MAP_HEIGHT;

// Collision layer tile meanings
const COLLISION_WALKABLE = 367;
const COLLISION_BLOCKED = 458;
const RECENT_TILES_MAX = 12;
const RECENT_OBJECTS_MAX = 8;
const DEFAULT_LAYER_COUNT = 2;
const QUICKBAR_SLOTS = 8;

type MapAnimatedSprite = {
  x: number;
  y: number;
  w: number;
  h: number;
  layer: number;
  sheet: string;
  animation: string;
};

type TilesetConfig = {
  id: string;
  name: string;
  path: string;
  tileDim: number;
  pixelWidth: number;
  pixelHeight: number;
};

type TileCategory = 'terrain' | 'paths' | 'props' | 'buildings';
type TileCategoryFilter = 'all' | TileCategory;
type EditorMode = 'terrain' | 'paths' | 'props' | 'buildings' | 'objects' | 'prefabs';
type StampRotation = 0 | 90 | 180 | 270;

type PackTileset = {
  image: string;
  tileSize: number;
  pixelWidth: number;
  pixelHeight: number;
  categories?: Partial<Record<TileCategory, number[]>>;
};

type PackObject = {
  id: string;
  name: string;
  image: string;
  pixelWidth: number;
  pixelHeight: number;
  anchor?: ObjectAnchor;
};

type AssetPack = {
  id: string;
  name: string;
  tileset?: PackTileset;
  objects?: PackObject[];
};

type StampDefinition = {
  id: string;
  name: string;
  width: number;
  height: number;
  layers: number[][][];
};

type ObjectAnchor = 'top-left' | 'bottom-left';

type ObjectDefinition = {
  id: string;
  name: string;
  tilesetId: string;
  tileX: number;
  tileY: number;
  tileWidth: number;
  tileHeight: number;
  anchor: ObjectAnchor;
  imagePath?: string;
  pixelWidth?: number;
  pixelHeight?: number;
  packId?: string;
  packName?: string;
  readonly?: boolean;
};

type PlacedObject = {
  id: string;
  objectId: string;
  col: number;
  row: number;
};

type AutoStampOptions = {
  minTiles: number;
  maxWidth: number;
  maxHeight: number;
  maxStamps: number;
  groundCoverage: number;
};

const CATEGORY_FILTERS: Array<{ id: TileCategoryFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'terrain', label: 'Terrain' },
  { id: 'paths', label: 'Paths' },
  { id: 'props', label: 'Props' },
  { id: 'buildings', label: 'Buildings' },
];

const MODE_PRESETS: Array<{
  id: EditorMode;
  label: string;
  tool: 'brush' | 'object' | 'stamp';
  category?: TileCategory;
  layer?: number;
}> = [
  { id: 'terrain', label: 'Terrain', tool: 'brush', category: 'terrain', layer: 0 },
  { id: 'paths', label: 'Paths', tool: 'brush', category: 'paths', layer: 0 },
  { id: 'props', label: 'Props', tool: 'brush', category: 'props', layer: 1 },
  { id: 'buildings', label: 'Buildings', tool: 'brush', category: 'buildings', layer: 0 },
  { id: 'objects', label: 'Objects', tool: 'object' },
  { id: 'prefabs', label: 'Prefabs', tool: 'stamp' },
];

const CATEGORY_STORAGE_KEY = 'ai-town.tilesetCategories.v1';
const STAMP_STORAGE_KEY = 'ai-town.tilesetStamps.v1';
const OBJECT_STORAGE_KEY = 'ai-town.tilesetObjects.v1';
const AUTO_STAMP_STORAGE_KEY = 'ai-town.tilesetAutoStamps.v1';
const AUTO_STAMP_LIMIT = 12;
const STAMP_PREVIEW_MAX_SIZE = 64;
const TILESET_BASE_URL = import.meta.env.BASE_URL ?? '/';
const TILESET_BASE_PATH = TILESET_BASE_URL.endsWith('/') ? TILESET_BASE_URL : `${TILESET_BASE_URL}/`;

const resolveTilesetPath = (path: string) => {
  if (path.startsWith('http') || path.startsWith('data:')) return path;
  if (path.startsWith('/')) return path;
  return `${TILESET_BASE_PATH}${path}`;
};

const resolveAssetPath = (path: string) => resolveTilesetPath(encodeURI(path));

const createBlankLayer = (width: number, height: number) =>
  Array.from({ length: width }, () => Array.from({ length: height }, () => -1));

const createBlankLayers = (count: number, width: number, height: number) =>
  Array.from({ length: count }, () => createBlankLayer(width, height));

const DEFAULT_TILESET: TilesetConfig = {
  id: 'starter',
  name: 'Starter (empty)',
  path: EMPTY_TILESET_DATA_URI,
  tileDim: DEFAULT_TILE_SIZE,
  pixelWidth: DEFAULT_TILE_SIZE,
  pixelHeight: DEFAULT_TILE_SIZE,
};

const INITIAL_ANIMATED_SPRITES: MapAnimatedSprite[] = [];

const ANIMATION_SOURCES: Record<string, { spritesheet: ISpritesheetData; url: string }> = {
  'campfire.json': { spritesheet: campfire as ISpritesheetData, url: '/ai-town/assets/spritesheets/campfire.png' },
  'gentlesparkle.json': {
    spritesheet: gentlesparkle as ISpritesheetData,
    url: '/ai-town/assets/spritesheets/gentlesparkle32.png',
  },
  'gentlewaterfall.json': {
    spritesheet: gentlewaterfall as ISpritesheetData,
    url: '/ai-town/assets/spritesheets/gentlewaterfall32.png',
  },
  'windmill.json': { spritesheet: windmill as ISpritesheetData, url: '/ai-town/assets/spritesheets/windmill.png' },
  'gentlesplash.json': {
    spritesheet: gentlesplash as ISpritesheetData,
    url: '/ai-town/assets/spritesheets/gentlewaterfall32.png',
  },
};

const PIXI_ANIMATION_SPEED = 0.1;

const PixiAnimatedSpritesLayer = ({ sprites }: { sprites: MapAnimatedSprite[] }) => {
  const [spriteSheets, setSpriteSheets] = useState<Record<string, Spritesheet>>({});
  const sheetNames = useMemo(() => {
    const unique = new Set<string>();
    for (const sprite of sprites) {
      unique.add(sprite.sheet);
    }
    return Array.from(unique);
  }, [sprites]);

  useEffect(() => {
    let active = true;
    const loadSheets = async () => {
      const entries = await Promise.all(
        sheetNames.map(async (sheetName) => {
          const source = ANIMATION_SOURCES[sheetName];
          if (!source) return null;
          const sheet = new Spritesheet(
            BaseTexture.from(source.url, { scaleMode: SCALE_MODES.NEAREST }),
            source.spritesheet,
          );
          await sheet.parse();
          return [sheetName, sheet] as const;
        }),
      );
      if (!active) return;
      const loaded: Record<string, Spritesheet> = {};
      for (const entry of entries) {
        if (entry) {
          loaded[entry[0]] = entry[1];
        }
      }
      setSpriteSheets(loaded);
    };
    void loadSheets();
    return () => {
      active = false;
    };
  }, [sheetNames]);

  return (
    <Container>
      {sprites.map((sprite, index) => {
        const sheet = spriteSheets[sprite.sheet];
        const textures = sheet?.animations[sprite.animation];
        if (!textures) return null;
        return (
          <PixiAnimatedSprite
            key={`${sprite.sheet}-${sprite.animation}-${sprite.x}-${sprite.y}-${index}`}
            textures={textures}
            isPlaying={true}
            animationSpeed={PIXI_ANIMATION_SPEED}
            x={sprite.x}
            y={sprite.y}
            width={sprite.w}
            height={sprite.h}
          />
        );
      })}
    </Container>
  );
};

const MapEditor = () => {
  const [tileset, setTileset] = useState<TilesetConfig>(() => DEFAULT_TILESET);
  const [tilesetOptions, setTilesetOptions] = useState<TilesetConfig[]>([DEFAULT_TILESET]);
  const [assetPacks, setAssetPacks] = useState<AssetPack[]>([]);
  const [packLoadError, setPackLoadError] = useState<string | null>(null);
  const [selectedTileId, setSelectedTileId] = useState<number | null>(null);
  const [showCollision, setShowCollision] = useState(true); // Toggle collision overlay
  const [showAnimatedSprites, setShowAnimatedSprites] = useState(true);
  const [tilesetLoaded, setTilesetLoaded] = useState(false);
  const [activeTool, setActiveTool] = useState<'brush' | 'eraser' | 'eyedropper' | 'stamp' | 'object'>('brush');
  const [activeLayerIndex, setActiveLayerIndex] = useState(0);
  const [activeMode, setActiveMode] = useState<EditorMode>('terrain');
  const [lastTileMode, setLastTileMode] = useState<EditorMode>('terrain');
  const [paletteMode, setPaletteMode] = useState<'used' | 'all'>('all');
  const [activeCategory, setActiveCategory] = useState<TileCategoryFilter>('all');
  const [bulkTagMode, setBulkTagMode] = useState(false);
  const [paletteSelection, setPaletteSelection] = useState<{ startId: number; endId: number } | null>(null);
  const [isPaletteSelecting, setIsPaletteSelecting] = useState(false);
  const [autoLayerByTransparency, setAutoLayerByTransparency] = useState(true);
  const [isPointerDown, setIsPointerDown] = useState(false);
  const [recentTiles, setRecentTiles] = useState<number[]>([]);
  const [recentObjects, setRecentObjects] = useState<string[]>([]);
  const [animatedSprites, setAnimatedSprites] = useState<MapAnimatedSprite[]>(() => INITIAL_ANIMATED_SPRITES);
  const [tilesetLoadError, setTilesetLoadError] = useState<string | null>(null);
  const [transparentTiles, setTransparentTiles] = useState<boolean[]>([]);
  const [hiddenTiles, setHiddenTiles] = useState<boolean[]>([]);
  const [tilesetCategories, setTilesetCategories] = useState<Record<string, Record<number, TileCategory>>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const stored = window.localStorage.getItem(CATEGORY_STORAGE_KEY);
      if (!stored) return {};
      return JSON.parse(stored) as Record<string, Record<number, TileCategory>>;
    } catch {
      return {};
    }
  });
  const [tilesetStamps, setTilesetStamps] = useState<Record<string, StampDefinition[]>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const stored = window.localStorage.getItem(STAMP_STORAGE_KEY);
      if (!stored) return {};
      return JSON.parse(stored) as Record<string, StampDefinition[]>;
    } catch {
      return {};
    }
  });
  const [tilesetObjects, setTilesetObjects] = useState<Record<string, ObjectDefinition[]>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const stored = window.localStorage.getItem(OBJECT_STORAGE_KEY);
      if (!stored) return {};
      return JSON.parse(stored) as Record<string, ObjectDefinition[]>;
    } catch {
      return {};
    }
  });
  const [placedObjects, setPlacedObjects] = useState<PlacedObject[]>([]);
  const [activeStampId, setActiveStampId] = useState<string | null>(null);
  const [stampCaptureMode, setStampCaptureMode] = useState(false);
  const [isStampSelecting, setIsStampSelecting] = useState(false);
  const [stampSelection, setStampSelection] = useState<{
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
  } | null>(null);
  const [stampNameDraft, setStampNameDraft] = useState('');
  const [stampSkipEmpty, setStampSkipEmpty] = useState(true);
  const [stampRotation, setStampRotation] = useState<StampRotation>(0);
  const [stampFlipX, setStampFlipX] = useState(false);
  const [stampFlipY, setStampFlipY] = useState(false);
  const [editingStampId, setEditingStampId] = useState<string | null>(null);
  const [stampRenameDraft, setStampRenameDraft] = useState('');
  const [activeObjectId, setActiveObjectId] = useState<string | null>(null);
  const [activeObjectPackId, setActiveObjectPackId] = useState<string | null>(null);
  const [objectCaptureMode, setObjectCaptureMode] = useState(false);
  const [objectPaletteSelection, setObjectPaletteSelection] = useState<{ startId: number; endId: number } | null>(null);
  const [objectNameDraft, setObjectNameDraft] = useState('');
  const [objectAnchor, setObjectAnchor] = useState<ObjectAnchor>('bottom-left');
  const [editingObjectId, setEditingObjectId] = useState<string | null>(null);
  const [objectRenameDraft, setObjectRenameDraft] = useState('');
  const [isObjectPaletteSelecting, setIsObjectPaletteSelecting] = useState(false);
  const [showAutoStampOptions, setShowAutoStampOptions] = useState(false);
  const [autoStampOptions, setAutoStampOptions] = useState<AutoStampOptions>({
    minTiles: 6,
    maxWidth: 16,
    maxHeight: 16,
    maxStamps: AUTO_STAMP_LIMIT,
    groundCoverage: 0.7,
  });
  const [autoGeneratedStamps, setAutoGeneratedStamps] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const stored = window.localStorage.getItem(AUTO_STAMP_STORAGE_KEY);
      if (!stored) return {};
      return JSON.parse(stored) as Record<string, boolean>;
    } catch {
      return {};
    }
  });
  const [hoverInfo, setHoverInfo] = useState<{
    row: number;
    col: number;
    tileId: number;
    tileLayerIndex: number;
    collisionValue: number;
  } | null>(null);
  const tilesetRef = useRef<HTMLImageElement | null>(null);
  const dragToolRef = useRef<'brush' | 'eraser' | 'eyedropper' | 'stamp' | 'object' | null>(null);
  const stampFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    const loadPacks = async () => {
      try {
        setPackLoadError(null);
        const indexUrl = resolveAssetPath(PACK_INDEX_PATH);
        const indexResponse = await fetch(indexUrl);
        if (!indexResponse.ok) {
          throw new Error(`Pack index not found: ${indexUrl}`);
        }
        const indexData = await indexResponse.json();
        const entries = Array.isArray(indexData?.packs) ? indexData.packs : [];
        const packs = await Promise.all(
          entries.map(async (entry: { id?: string; name?: string; path?: string }) => {
            if (!entry?.path) return null;
            const packUrl = resolveAssetPath(entry.path);
            const response = await fetch(packUrl);
            if (!response.ok) {
              throw new Error(`Pack failed to load: ${packUrl}`);
            }
            const packData = await response.json();
            const id = String(packData?.id ?? entry.id ?? '').trim();
            if (!id) return null;
            const name = String(packData?.name ?? entry.name ?? id);
            const tileset = packData?.tileset as PackTileset | undefined;
            const objects = Array.isArray(packData?.objects) ? (packData.objects as PackObject[]) : undefined;
            return {
              id,
              name,
              tileset,
              objects,
            } as AssetPack;
          }),
        );
        if (!active) return;
        setAssetPacks(packs.filter((pack): pack is AssetPack => Boolean(pack)));
      } catch (error) {
        console.error('Failed to load asset packs:', error);
        if (!active) return;
        setAssetPacks([]);
        setPackLoadError('Failed to load asset packs.');
      }
    };
    void loadPacks();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const nextOptions = assetPacks
      .filter((pack) => Boolean(pack.tileset))
      .map((pack) => ({
        id: pack.id,
        name: pack.name,
        path: pack.tileset?.image ?? EMPTY_TILESET_DATA_URI,
        tileDim: pack.tileset?.tileSize ?? DEFAULT_TILE_SIZE,
        pixelWidth: pack.tileset?.pixelWidth ?? DEFAULT_TILE_SIZE,
        pixelHeight: pack.tileset?.pixelHeight ?? DEFAULT_TILE_SIZE,
      }));
    if (nextOptions.length === 0) {
      setTilesetOptions([DEFAULT_TILESET]);
      return;
    }
    setTilesetOptions(nextOptions);
  }, [assetPacks]);

  useEffect(() => {
    const match = tilesetOptions.find((option) => option.id === tileset.id);
    if (!match) {
      setTileset(tilesetOptions[0] ?? DEFAULT_TILESET);
      return;
    }
    if (
      match.path !== tileset.path ||
      match.tileDim !== tileset.tileDim ||
      match.pixelWidth !== tileset.pixelWidth ||
      match.pixelHeight !== tileset.pixelHeight ||
      match.name !== tileset.name
    ) {
      setTileset(match);
    }
  }, [tilesetOptions, tileset]);

  const tilesetPack = useMemo(
    () => assetPacks.find((pack) => pack.id === tileset.id) ?? null,
    [assetPacks, tileset.id],
  );

  const objectPacks = useMemo(
    () => assetPacks.filter((pack) => (pack.objects?.length ?? 0) > 0),
    [assetPacks],
  );

  useEffect(() => {
    if (objectPacks.length === 0) {
      if (activeObjectPackId !== null) {
        setActiveObjectPackId(null);
      }
      return;
    }
    if (!activeObjectPackId || !objectPacks.some((pack) => pack.id === activeObjectPackId)) {
      setActiveObjectPackId(objectPacks[0].id);
    }
  }, [objectPacks, activeObjectPackId]);

  const activeObjectPack = useMemo(() => {
    if (objectPacks.length === 0) return null;
    return objectPacks.find((pack) => pack.id === activeObjectPackId) ?? objectPacks[0];
  }, [objectPacks, activeObjectPackId]);

  const tileSize = tileset.tileDim;
  const tilesetCols = Math.floor(tileset.pixelWidth / tileSize);
  const tilesetRows = Math.floor(tileset.pixelHeight / tileSize);
  const mapPixelWidth = MAP_WIDTH * tileSize;
  const mapPixelHeight = MAP_HEIGHT * tileSize;
  const tilesetUrl = useMemo(() => resolveAssetPath(tileset.path), [tileset.path]);

  // Combine all BG layers for rendering (layer 0 is base, layer 1+ are overlays)
  // bgLayers structure: bgLayers[layerIndex][x][y] = tileIndex
  const [bgLayers, setBgLayers] = useState<number[][][]>(() =>
    createBlankLayers(DEFAULT_LAYER_COUNT, MAP_WIDTH, MAP_HEIGHT),
  );

  const [collisionLayer, setCollisionLayer] = useState<number[][]>(() =>
    createBlankLayer(MAP_WIDTH, MAP_HEIGHT),
  );

  const usedTileStats = useMemo(() => {
    const counts = new Map<number, number>();
    for (const layer of bgLayers) {
      for (const column of layer) {
        for (const tileId of column) {
          if (tileId < 0) continue;
          counts.set(tileId, (counts.get(tileId) ?? 0) + 1);
        }
      }
    }
    const usedIds = Array.from(counts.keys());
    usedIds.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a - b);
    return { usedIds, counts };
  }, [bgLayers]);

  const tileUsage = useMemo(() => {
    const base = new Set<number>();
    const overlay = new Set<number>();
    bgLayers.forEach((layer, layerIndex) => {
      for (const column of layer) {
        for (const tileId of column) {
          if (tileId < 0) continue;
          if (layerIndex === 0) {
            base.add(tileId);
          } else {
            overlay.add(tileId);
          }
        }
      }
    });
    return { base, overlay };
  }, [bgLayers]);

  const packCategoryAssignments = useMemo(() => {
    const categories = tilesetPack?.tileset?.categories;
    if (!categories) return {};
    const assignments: Record<number, TileCategory> = {};
    (Object.entries(categories) as Array<[TileCategory, number[]]>).forEach(([category, tileIds]) => {
      if (!Array.isArray(tileIds)) return;
      tileIds.forEach((tileId) => {
        if (Number.isFinite(tileId)) {
          assignments[Number(tileId)] = category;
        }
      });
    });
    return assignments;
  }, [tilesetPack]);

  const tilesetCategoryAssignments = useMemo(() => {
    const saved = tilesetCategories[tileset.id] ?? {};
    return { ...packCategoryAssignments, ...saved };
  }, [packCategoryAssignments, tilesetCategories, tileset.id]);
  const tilesetStampsForSet = tilesetStamps[tileset.id] ?? [];
  const activeStamp = tilesetStampsForSet.find((stamp) => stamp.id === activeStampId) ?? null;
  const userObjectsForSet = useMemo(
    () => tilesetObjects[tileset.id] ?? [],
    [tilesetObjects, tileset.id],
  );
  const builtinObjectsForSet = useMemo(() => {
    if (!activeObjectPack?.objects || activeObjectPack.objects.length === 0) return [];
    return activeObjectPack.objects
      .filter((source) => source?.id && source?.image)
      .map((source) => {
      const pixelWidth = Number(source.pixelWidth) || tileSize;
      const pixelHeight = Number(source.pixelHeight) || tileSize;
      const tileWidth = Math.max(1, Math.ceil(pixelWidth / tileSize));
      const tileHeight = Math.max(1, Math.ceil(pixelHeight / tileSize));
      const normalizedName = source.name.replace(/(\D)(\d)/g, '$1 $2');
      return {
        id: source.id,
        name: normalizedName,
        tilesetId: tileset.id,
        tileX: 0,
        tileY: 0,
        tileWidth,
        tileHeight,
        anchor: source.anchor ?? ('bottom-left' as ObjectAnchor),
        imagePath: source.image,
        pixelWidth,
        pixelHeight,
        packId: activeObjectPack.id,
        packName: activeObjectPack.name,
        readonly: true,
      };
    });
  }, [activeObjectPack, tileSize, tileset.id]);
  const tilesetObjectsForSet = useMemo(
    () => [...builtinObjectsForSet, ...userObjectsForSet],
    [builtinObjectsForSet, userObjectsForSet],
  );
  const activeObject = tilesetObjectsForSet.find((obj) => obj.id === activeObjectId) ?? null;
  const activeToolLabel =
    activeTool === 'stamp'
      ? `Stamp${activeStamp ? `: ${activeStamp.name}` : ''}${stampRotation ? ` (${stampRotation}deg)` : ''}`
      : activeTool === 'object'
      ? `Object${activeObject ? `: ${activeObject.name}` : ''}`
      : `${activeTool.charAt(0).toUpperCase()}${activeTool.slice(1)}`;

  const objectsById = useMemo(() => {
    const map = new Map<string, ObjectDefinition>();
    for (const obj of tilesetObjectsForSet) {
      map.set(obj.id, obj);
    }
    return map;
  }, [tilesetObjectsForSet]);

  useEffect(() => {
    setActiveStampId(null);
    setStampCaptureMode(false);
    setStampSelection(null);
    setStampNameDraft('');
    setIsStampSelecting(false);
    setBulkTagMode(false);
    setPaletteSelection(null);
    setIsPaletteSelecting(false);
    setEditingStampId(null);
    setStampRenameDraft('');
    setActiveObjectId(null);
    setObjectCaptureMode(false);
    setObjectPaletteSelection(null);
    setObjectNameDraft('');
    setObjectAnchor('bottom-left');
    setEditingObjectId(null);
    setObjectRenameDraft('');
    setIsObjectPaletteSelecting(false);
  }, [tileset.id]);

  useEffect(() => {
    setStampRotation(0);
    setStampFlipX(false);
    setStampFlipY(false);
  }, [activeStampId]);

  const resetMap = (options?: { animated: MapAnimatedSprite[] }) => {
    setBgLayers(createBlankLayers(DEFAULT_LAYER_COUNT, MAP_WIDTH, MAP_HEIGHT));
    setCollisionLayer(createBlankLayer(MAP_WIDTH, MAP_HEIGHT));
    setAnimatedSprites(options?.animated ?? []);
    setPlacedObjects([]);
    setRecentTiles([]);
    setSelectedTileId(null);
    setActiveLayerIndex(0);
    setPaletteMode('all');
    setActiveCategory('all');
    setStampSelection(null);
    setIsStampSelecting(false);
  };

  useEffect(() => {
    if (!bulkTagMode || paletteMode !== 'all' || activeCategory !== 'all') {
      setPaletteSelection(null);
      setIsPaletteSelecting(false);
    }
  }, [bulkTagMode, paletteMode, activeCategory]);

  useEffect(() => {
    if (objectCaptureMode) return;
    setObjectPaletteSelection(null);
    setIsObjectPaletteSelecting(false);
  }, [objectCaptureMode]);

  const handleTilesetChange = (nextId: string) => {
    const next = tilesetOptions.find((item) => item.id === nextId);
    if (!next || next.id === tileset.id) return;
    const confirmed = window.confirm(
      'Switching tileset will reset the current map. Continue?',
    );
    if (!confirmed) return;
    setTileset(next);
    resetMap({ animated: [] });
  };

  // Preload tileset image
  useEffect(() => {
    setTilesetLoaded(false);
    setTilesetLoadError(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = tilesetUrl;
    img.onload = () => {
      tilesetRef.current = img;
      setTilesetLoaded(true);
    };
    img.onerror = () => {
      console.error('Failed to load tileset image:', tilesetUrl);
      setTilesetLoadError(`Failed to load tileset: ${tilesetUrl}`);
    };
  }, [tilesetUrl]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(tilesetCategories));
  }, [tilesetCategories]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STAMP_STORAGE_KEY, JSON.stringify(tilesetStamps));
  }, [tilesetStamps]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(OBJECT_STORAGE_KEY, JSON.stringify(tilesetObjects));
  }, [tilesetObjects]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(AUTO_STAMP_STORAGE_KEY, JSON.stringify(autoGeneratedStamps));
  }, [autoGeneratedStamps]);

  useEffect(() => {
    if (!tilesetLoaded || !tilesetRef.current) {
      setTransparentTiles([]);
      setHiddenTiles([]);
      return;
    }
    const img = tilesetRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = tileset.pixelWidth;
    canvas.height = tileset.pixelHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setTransparentTiles([]);
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    let data: Uint8ClampedArray;
    try {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      data = imageData.data;
    } catch (error) {
      console.error('Failed to read tileset pixels:', error);
      setTransparentTiles([]);
      setHiddenTiles([]);
      setTilesetLoadError('Failed to read tileset pixels. Check image origin/CORS.');
      return;
    }
    const tileCount = tilesetRows * tilesetCols;
    const hasTransparency = Array.from({ length: tileCount }, () => false);
    const isHidden = Array.from({ length: tileCount }, () => false);
    for (let tileIndex = 0; tileIndex < tileCount; tileIndex += 1) {
      const tileRow = Math.floor(tileIndex / tilesetCols);
      const tileCol = tileIndex % tilesetCols;
      const startX = tileCol * tileSize;
      const startY = tileRow * tileSize;
      let transparent = false;
      let isFullyTransparent = true;
      let isSolidColor = true;
      let firstR = -1;
      let firstG = -1;
      let firstB = -1;
      let firstA = -1;
      for (let y = 0; y < tileSize; y += 1) {
        const rowOffset = (startY + y) * canvas.width;
        for (let x = 0; x < tileSize; x += 1) {
          const pixelIndex = (rowOffset + startX + x) * 4;
          const r = data[pixelIndex];
          const g = data[pixelIndex + 1];
          const b = data[pixelIndex + 2];
          const a = data[pixelIndex + 3];
          if (firstR === -1) {
            firstR = r;
            firstG = g;
            firstB = b;
            firstA = a;
          } else if (isSolidColor && (r !== firstR || g !== firstG || b !== firstB || a !== firstA)) {
            isSolidColor = false;
          }
          if (a !== 0) {
            isFullyTransparent = false;
          }
          if (a < 255) {
            transparent = true;
          }
        }
      }
      hasTransparency[tileIndex] = transparent;
      const isSolidBlack = isSolidColor && firstA === 255 && firstR === 0 && firstG === 0 && firstB === 0;
      isHidden[tileIndex] = isFullyTransparent || isSolidBlack;
    }
    setTransparentTiles(hasTransparency);
    setHiddenTiles(isHidden);
  }, [
    tilesetLoaded,
    tileSize,
    tilesetCols,
    tilesetRows,
    tileset.pixelWidth,
    tileset.pixelHeight,
  ]);

  // Get the x, y position in the tileset for a given tile ID
  const getTilePos = (tileId: number): { sx: number; sy: number } => {
    if (tileId < 0) return { sx: -1, sy: -1 };
    const row = Math.floor(tileId / tilesetCols);
    const col = tileId % tilesetCols;
    return { sx: col * tileSize, sy: row * tileSize };
  };

  const pushRecentTile = (tileId: number) => {
    if (tileId < 0) return;
    setRecentTiles((prev) => {
      const filtered = prev.filter((id) => id !== tileId);
      return [tileId, ...filtered].slice(0, RECENT_TILES_MAX);
    });
  };

  const pushRecentObject = (objectId: string) => {
    if (!objectId) return;
    setRecentObjects((prev) => {
      const filtered = prev.filter((id) => id !== objectId);
      return [objectId, ...filtered].slice(0, RECENT_OBJECTS_MAX);
    });
  };

  const selectObjectId = (objectId: string) => {
    if (!objectId) return;
    setActiveObjectId(objectId);
    setActiveTool('object');
    setActiveMode('objects');
    pushRecentObject(objectId);
  };

  const selectTileId = (tileId: number, options?: { layerOverride?: number }) => {
    setSelectedTileId(tileId);
    if (tileId >= 0) {
      pushRecentTile(tileId);
      setActiveTool('brush');
      if (typeof options?.layerOverride === 'number' && options.layerOverride >= 0) {
        setActiveLayerIndex(options.layerOverride);
      } else if (autoLayerByTransparency) {
        setActiveLayerIndex(transparentTiles[tileId] ? 1 : 0);
      }
    } else {
      setActiveTool('eraser');
    }
  };

  const selectedTileCategory =
    selectedTileId !== null && selectedTileId >= 0
      ? tilesetCategoryAssignments[selectedTileId]
      : undefined;

  const assignSelectedToCategory = (category: TileCategory | null) => {
    if (selectedTileId === null || selectedTileId < 0) return;
    setTilesetCategories((prev) => {
      const next = { ...prev };
      const current = { ...(next[tileset.id] ?? {}) };
      if (category) {
        current[selectedTileId] = category;
      } else {
        delete current[selectedTileId];
      }
      next[tileset.id] = current;
      return next;
    });
  };

  const autoTagUsedTiles = () => {
    if (usedTileStats.usedIds.length === 0) return;
    setTilesetCategories((prev) => {
      const next = { ...prev };
      const current = { ...(next[tileset.id] ?? {}) };
      for (const tileId of usedTileStats.usedIds) {
        if (hiddenTiles[tileId]) continue;
        if (current[tileId]) continue;
        if (tileUsage.overlay.has(tileId) || transparentTiles[tileId]) {
          current[tileId] = 'props';
        } else {
          current[tileId] = 'terrain';
        }
      }
      next[tileset.id] = current;
      return next;
    });
  };

  const applyCategoryToSelection = (category: TileCategory | null) => {
    if (paletteSelectionSet.size === 0) return;
    setTilesetCategories((prev) => {
      const next = { ...prev };
      const current = { ...(next[tileset.id] ?? {}) };
      paletteSelectionSet.forEach((tileId) => {
        if (hiddenTiles[tileId]) return;
        if (category) {
          current[tileId] = category;
        } else {
          delete current[tileId];
        }
      });
      next[tileset.id] = current;
      return next;
    });
  };

  const updateAutoStampOptions = (partial: Partial<AutoStampOptions>) => {
    setAutoStampOptions((prev) => ({ ...prev, ...partial }));
  };

  const applyMode = useCallback((mode: EditorMode) => {
    setActiveMode(mode);
    const preset = MODE_PRESETS.find((item) => item.id === mode);
    if (!preset) return;
    setActiveTool(preset.tool);
    if (preset.tool === 'brush' && preset.category) {
      setActiveCategory(preset.category);
      setPaletteMode('all');
    }
    if (typeof preset.layer === 'number') {
      setActiveLayerIndex(preset.layer);
    }
    if (mode !== 'objects' && mode !== 'prefabs') {
      setLastTileMode(mode);
    }
  }, []);

  const activateTileTool = useCallback((tool: 'brush' | 'eraser' | 'eyedropper') => {
    if (activeMode === 'objects' || activeMode === 'prefabs') {
      const preset = MODE_PRESETS.find((item) => item.id === lastTileMode);
      if (preset) {
        setActiveMode(preset.id);
        if (preset.category) {
          setActiveCategory(preset.category);
          setPaletteMode('all');
        }
        if (typeof preset.layer === 'number') {
          setActiveLayerIndex(preset.layer);
        }
      }
    }
    setActiveTool(tool);
  }, [activeMode, lastTileMode]);

  const allTileIds = useMemo(
    () => Array.from({ length: tilesetRows * tilesetCols }, (_, index) => index),
    [tilesetRows, tilesetCols],
  );

  const visibleAllTileIds = useMemo(
    () => allTileIds.filter((tileId) => !hiddenTiles[tileId]),
    [allTileIds, hiddenTiles],
  );

  const visibleUsedTileIds = useMemo(
    () => usedTileStats.usedIds.filter((tileId) => !hiddenTiles[tileId]),
    [usedTileStats.usedIds, hiddenTiles],
  );

  const basePaletteTileIds = paletteMode === 'used' ? visibleUsedTileIds : visibleAllTileIds;

  const categoryCounts = useMemo(() => {
    const counts: Record<TileCategoryFilter, number> = {
      all: basePaletteTileIds.length,
      terrain: 0,
      paths: 0,
      props: 0,
      buildings: 0,
    };
    for (const tileId of basePaletteTileIds) {
      const category = tilesetCategoryAssignments[tileId];
      if (category) counts[category] += 1;
    }
    return counts;
  }, [basePaletteTileIds, tilesetCategoryAssignments]);

  const paletteTileIds = objectCaptureMode
    ? allTileIds
    : activeCategory === 'all'
    ? basePaletteTileIds
    : basePaletteTileIds.filter((tileId) => tilesetCategoryAssignments[tileId] === activeCategory);

  const paletteSelectionBounds = useMemo(() => {
    if (!paletteSelection || !bulkTagMode || paletteMode !== 'all' || activeCategory !== 'all') return null;
    const startRow = Math.floor(paletteSelection.startId / tilesetCols);
    const startCol = paletteSelection.startId % tilesetCols;
    const endRow = Math.floor(paletteSelection.endId / tilesetCols);
    const endCol = paletteSelection.endId % tilesetCols;
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    return { minRow, maxRow, minCol, maxCol };
  }, [paletteSelection, bulkTagMode, paletteMode, activeCategory, tilesetCols]);

  const paletteSelectionSet = useMemo(() => {
    if (!paletteSelectionBounds) return new Set<number>();
    const selected = new Set<number>();
    for (let row = paletteSelectionBounds.minRow; row <= paletteSelectionBounds.maxRow; row += 1) {
      for (let col = paletteSelectionBounds.minCol; col <= paletteSelectionBounds.maxCol; col += 1) {
        const tileId = row * tilesetCols + col;
        if (tileId >= 0 && tileId < tilesetCols * tilesetRows) {
          if (hiddenTiles[tileId]) continue;
          selected.add(tileId);
        }
      }
    }
    return selected;
  }, [paletteSelectionBounds, tilesetCols, tilesetRows, hiddenTiles]);

  const paletteSelectionCount = paletteSelectionSet.size;

  const objectSelectionBounds = useMemo(() => {
    if (!objectPaletteSelection) return null;
    const startRow = Math.floor(objectPaletteSelection.startId / tilesetCols);
    const startCol = objectPaletteSelection.startId % tilesetCols;
    const endRow = Math.floor(objectPaletteSelection.endId / tilesetCols);
    const endCol = objectPaletteSelection.endId % tilesetCols;
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    return { minRow, maxRow, minCol, maxCol };
  }, [objectPaletteSelection, tilesetCols]);

  const objectSelectionSet = useMemo(() => {
    if (!objectSelectionBounds) return new Set<number>();
    const selected = new Set<number>();
    for (let row = objectSelectionBounds.minRow; row <= objectSelectionBounds.maxRow; row += 1) {
      for (let col = objectSelectionBounds.minCol; col <= objectSelectionBounds.maxCol; col += 1) {
        const tileId = row * tilesetCols + col;
        if (tileId >= 0 && tileId < tilesetCols * tilesetRows) {
          selected.add(tileId);
        }
      }
    }
    return selected;
  }, [objectSelectionBounds, tilesetCols, tilesetRows]);

  const selectionBounds = useMemo(() => {
    if (!stampSelection) return null;
    const minRow = Math.min(stampSelection.startRow, stampSelection.endRow);
    const maxRow = Math.max(stampSelection.startRow, stampSelection.endRow);
    const minCol = Math.min(stampSelection.startCol, stampSelection.endCol);
    const maxCol = Math.max(stampSelection.startCol, stampSelection.endCol);
    return { minRow, maxRow, minCol, maxCol };
  }, [stampSelection]);

  const transformedStampSize = useMemo(() => {
    if (!activeStamp) return null;
    if (stampRotation === 90 || stampRotation === 270) {
      return { width: activeStamp.height, height: activeStamp.width };
    }
    return { width: activeStamp.width, height: activeStamp.height };
  }, [activeStamp, stampRotation]);

  const transformStampCoord = (x: number, y: number, stamp: StampDefinition) => {
    let tx = stampFlipX ? stamp.width - 1 - x : x;
    let ty = stampFlipY ? stamp.height - 1 - y : y;
    if (stampRotation === 90) {
      return { x: ty, y: stamp.width - 1 - tx };
    }
    if (stampRotation === 180) {
      return { x: stamp.width - 1 - tx, y: stamp.height - 1 - ty };
    }
    if (stampRotation === 270) {
      return { x: stamp.height - 1 - ty, y: tx };
    }
    return { x: tx, y: ty };
  };

  const stampPreviewTiles = useMemo(() => {
    if (!activeStamp) return [];
    const tiles: Array<{ x: number; y: number; tileId: number; layerIndex: number }> = [];
    for (let layerIndex = 0; layerIndex < activeStamp.layers.length; layerIndex += 1) {
      const layer = activeStamp.layers[layerIndex];
      for (let x = 0; x < activeStamp.width; x += 1) {
        for (let y = 0; y < activeStamp.height; y += 1) {
          const tileId = layer?.[x]?.[y] ?? -1;
          if (tileId < 0) continue;
          const transformed = transformStampCoord(x, y, activeStamp);
          tiles.push({ x: transformed.x, y: transformed.y, tileId, layerIndex });
        }
      }
    }
    return tiles;
  }, [activeStamp, stampFlipX, stampFlipY, stampRotation]);

  const stampPreviewValid = useMemo(() => {
    if (!hoverInfo || !transformedStampSize) return true;
    return (
      hoverInfo.col + transformedStampSize.width <= MAP_WIDTH &&
      hoverInfo.row + transformedStampSize.height <= MAP_HEIGHT
    );
  }, [hoverInfo, transformedStampSize]);

  const objectPreviewBounds = useMemo(() => {
    if (!hoverInfo || !activeObject) return null;
    return getObjectPixelBounds(activeObject, { col: hoverInfo.col, row: hoverInfo.row });
  }, [activeObject, hoverInfo, tileSize]);

  const objectPreviewValid = useMemo(() => {
    if (!objectPreviewBounds) return true;
    return (
      objectPreviewBounds.startCol >= 0 &&
      objectPreviewBounds.startRow >= 0 &&
      objectPreviewBounds.endCol < MAP_WIDTH &&
      objectPreviewBounds.endRow < MAP_HEIGHT
    );
  }, [objectPreviewBounds]);

  const placedObjectsSorted = useMemo(() => {
    const list = [...placedObjects];
    list.sort((a, b) => {
      const aDef = objectsById.get(a.objectId);
      const bDef = objectsById.get(b.objectId);
      if (!aDef || !bDef) return 0;
      const aBounds = getObjectTileBounds(aDef, a);
      const bBounds = getObjectTileBounds(bDef, b);
      if (aBounds.endRow !== bBounds.endRow) return aBounds.endRow - bBounds.endRow;
      return aBounds.startCol - bBounds.startCol;
    });
    return list;
  }, [placedObjects, objectsById]);

  const quickbarTileSlots = useMemo(
    () => Array.from({ length: QUICKBAR_SLOTS }, (_, index) => recentTiles[index] ?? null),
    [recentTiles],
  );

  const quickbarObjectSlots = useMemo(() => {
    const available = recentObjects.filter((id) => objectsById.has(id));
    return Array.from({ length: QUICKBAR_SLOTS }, (_, index) => available[index] ?? null);
  }, [recentObjects, objectsById]);

  const showObjectPanel = activeMode === 'objects' || activeTool === 'object' || objectCaptureMode;
  const showStampPanel = activeMode === 'prefabs' || activeTool === 'stamp' || stampCaptureMode;
  const showTilePanel = activeTool !== 'object' || objectCaptureMode;

  const getTopTileAt = (row: number, col: number) => {
    for (let i = bgLayers.length - 1; i >= 0; i -= 1) {
      const tileId = bgLayers[i]?.[col]?.[row] ?? -1;
      if (tileId >= 0) return { tileId, layerIndex: i };
    }
    return { tileId: -1, layerIndex: -1 };
  };

  const createStampId = () => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return `stamp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  };

  const createObjectId = () => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return `object-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  };

  const createPlacedObjectId = () => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return `placed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  };

  function getObjectAnchorOffset(object: ObjectDefinition) {
    if (object.anchor === 'bottom-left') {
      return { x: 0, y: object.tileHeight - 1 };
    }
    return { x: 0, y: 0 };
  }

  function getObjectTileBounds(object: ObjectDefinition, placement: { col: number; row: number }) {
    const anchor = getObjectAnchorOffset(object);
    const startCol = placement.col - anchor.x;
    const startRow = placement.row - anchor.y;
    return {
      startCol,
      startRow,
      endCol: startCol + object.tileWidth - 1,
      endRow: startRow + object.tileHeight - 1,
    };
  }

  function getObjectPixelBounds(object: ObjectDefinition, placement: { col: number; row: number }) {
    const bounds = getObjectTileBounds(object, placement);
    return {
      ...bounds,
      left: bounds.startCol * tileSize,
      top: bounds.startRow * tileSize,
      width: object.tileWidth * tileSize,
      height: object.tileHeight * tileSize,
    };
  }

  const saveStampFromSelection = () => {
    if (!selectionBounds) return;
    const width = selectionBounds.maxCol - selectionBounds.minCol + 1;
    const height = selectionBounds.maxRow - selectionBounds.minRow + 1;
    const layers = bgLayers.map((layer) =>
      Array.from({ length: width }, (_, x) =>
        Array.from({ length: height }, (_, y) => layer[selectionBounds.minCol + x]?.[selectionBounds.minRow + y] ?? -1),
      ),
    );
    const name = stampNameDraft.trim() || `Stamp ${tilesetStampsForSet.length + 1}`;
    const newStamp: StampDefinition = {
      id: createStampId(),
      name,
      width,
      height,
      layers,
    };
    setTilesetStamps((prev) => {
      const next = { ...prev };
      const list = [...(next[tileset.id] ?? [])];
      list.push(newStamp);
      next[tileset.id] = list;
      return next;
    });
    setActiveStampId(newStamp.id);
    applyMode('prefabs');
    setStampCaptureMode(false);
    setStampSelection(null);
    setStampNameDraft('');
  };

  const saveObjectFromSelection = () => {
    if (!objectSelectionBounds) return;
    const width = objectSelectionBounds.maxCol - objectSelectionBounds.minCol + 1;
    const height = objectSelectionBounds.maxRow - objectSelectionBounds.minRow + 1;
    const name = objectNameDraft.trim() || `Object ${userObjectsForSet.length + 1}`;
    const newObject: ObjectDefinition = {
      id: createObjectId(),
      name,
      tilesetId: tileset.id,
      tileX: objectSelectionBounds.minCol,
      tileY: objectSelectionBounds.minRow,
      tileWidth: width,
      tileHeight: height,
      anchor: objectAnchor,
      pixelWidth: width * tileSize,
      pixelHeight: height * tileSize,
    };
    setTilesetObjects((prev) => {
      const next = { ...prev };
      const list = [...(next[tileset.id] ?? [])];
      list.push(newObject);
      next[tileset.id] = list;
      return next;
    });
    setActiveObjectId(newObject.id);
    applyMode('objects');
    setObjectCaptureMode(false);
    setObjectPaletteSelection(null);
    setObjectNameDraft('');
  };

  const renameStamp = (stampId: string, nextName: string) => {
    const trimmed = nextName.trim();
    if (!trimmed) return;
    setTilesetStamps((prev) => {
      const next = { ...prev };
      const list = (next[tileset.id] ?? []).map((stamp) =>
        stamp.id === stampId ? { ...stamp, name: trimmed } : stamp,
      );
      next[tileset.id] = list;
      return next;
    });
  };

  const renameObject = (objectId: string, nextName: string) => {
    const trimmed = nextName.trim();
    if (!trimmed) return;
    setTilesetObjects((prev) => {
      const next = { ...prev };
      const list = (next[tileset.id] ?? []).map((obj) =>
        obj.id === objectId ? { ...obj, name: trimmed } : obj,
      );
      next[tileset.id] = list;
      return next;
    });
  };

  const removeStamp = (stampId: string) => {
    setTilesetStamps((prev) => {
      const next = { ...prev };
      const list = next[tileset.id] ?? [];
      next[tileset.id] = list.filter((stamp) => stamp.id !== stampId);
      return next;
    });
    setActiveStampId((current) => (current === stampId ? null : current));
  };

  const removeObjectDefinition = (objectId: string) => {
    const objectDef = objectsById.get(objectId);
    if (objectDef?.readonly) return;
    setTilesetObjects((prev) => {
      const next = { ...prev };
      const list = next[tileset.id] ?? [];
      next[tileset.id] = list.filter((obj) => obj.id !== objectId);
      return next;
    });
    setPlacedObjects((prev) => prev.filter((placement) => placement.objectId !== objectId));
    setActiveObjectId((current) => (current === objectId ? null : current));
  };

  const getStampPreviewData = (stamp: StampDefinition) => {
    const maxDimension = Math.max(stamp.width, stamp.height, 1);
    const previewTileSize = Math.max(
      6,
      Math.min(tileSize, Math.floor(STAMP_PREVIEW_MAX_SIZE / maxDimension)),
    );
    const scale = previewTileSize / tileSize;
    const tiles: Array<{ x: number; y: number; tileId: number }> = [];
    for (let y = 0; y < stamp.height; y += 1) {
      for (let x = 0; x < stamp.width; x += 1) {
        let tileId = -1;
        for (let layerIndex = stamp.layers.length - 1; layerIndex >= 0; layerIndex -= 1) {
          const candidate = stamp.layers[layerIndex]?.[x]?.[y] ?? -1;
          if (candidate >= 0) {
            tileId = candidate;
            break;
          }
        }
        if (tileId >= 0) tiles.push({ x, y, tileId });
      }
    }
    return {
      tiles,
      previewTileSize,
      scale,
      width: stamp.width * previewTileSize,
      height: stamp.height * previewTileSize,
    };
  };

  const getObjectPreviewData = (object: ObjectDefinition) => {
    const pixelWidth = object.pixelWidth ?? object.tileWidth * tileSize;
    const pixelHeight = object.pixelHeight ?? object.tileHeight * tileSize;
    const maxDimension = Math.max(pixelWidth, pixelHeight, 1);
    const scale = Math.min(1, STAMP_PREVIEW_MAX_SIZE / maxDimension);
    const width = Math.max(1, Math.round(pixelWidth * scale));
    const height = Math.max(1, Math.round(pixelHeight * scale));
    const imageUrl = object.imagePath ? resolveAssetPath(object.imagePath) : tilesetUrl;
    if (object.imagePath) {
      return {
        width,
        height,
        imageUrl,
        backgroundSize: `${width}px ${height}px`,
        backgroundPosition: '0px 0px',
      };
    }
    const scaledTileSize = tileSize * scale;
    return {
      width,
      height,
      imageUrl,
      backgroundSize: `${tilesetCols * scaledTileSize}px ${tilesetRows * scaledTileSize}px`,
      backgroundPosition: `-${object.tileX * scaledTileSize}px -${object.tileY * scaledTileSize}px`,
    };
  };

  const exportStamps = () => {
    const payload = {
      version: 1,
      tilesetId: tileset.id,
      tileDim: tileset.tileDim,
      stamps: tilesetStampsForSet,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stamps_${tileset.id}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleStampImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const importedStamps = Array.isArray(parsed) ? parsed : parsed?.stamps;
        if (!Array.isArray(importedStamps)) {
          alert('No stamps found in this file.');
          return;
        }
        if (parsed?.tileDim && parsed.tileDim !== tileset.tileDim) {
          const proceed = window.confirm(
            `Stamp tile size ${parsed.tileDim} does not match current tileset (${tileset.tileDim}). Import anyway?`,
          );
          if (!proceed) return;
        }
        const sanitized: StampDefinition[] = importedStamps
          .map((stamp: StampDefinition) => {
            if (!stamp || !Array.isArray(stamp.layers)) return null;
            if (!Number.isFinite(stamp.width) || !Number.isFinite(stamp.height)) return null;
            return {
              id: createStampId(),
              name: stamp.name?.trim() ? stamp.name.trim() : 'Imported Stamp',
              width: stamp.width,
              height: stamp.height,
              layers: stamp.layers,
            };
          })
          .filter(Boolean) as StampDefinition[];
        if (sanitized.length === 0) {
          alert('No valid stamps found in this file.');
          return;
        }
        let replace = false;
        if (tilesetStampsForSet.length > 0) {
          replace = window.confirm('Replace existing stamps? Click Cancel to merge.');
        }
        setTilesetStamps((prev) => {
          const next = { ...prev };
          next[tileset.id] = replace ? sanitized : [...(next[tileset.id] ?? []), ...sanitized];
          return next;
        });
        setActiveStampId(sanitized[0]?.id ?? null);
        applyMode('prefabs');
      } catch (error) {
        console.error('Failed to import stamps:', error);
        alert('Invalid stamp JSON.');
      } finally {
        if (stampFileInputRef.current) stampFileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const buildAutoStampsFromMap = (options: AutoStampOptions) => {
    if (!bgLayers.length) return [];
    const minTiles = Math.max(1, Math.floor(options.minTiles));
    const maxWidth = Math.max(1, Math.floor(options.maxWidth));
    const maxHeight = Math.max(1, Math.floor(options.maxHeight));
    const maxStamps = Math.max(1, Math.floor(options.maxStamps));
    const groundCoverage = Math.min(0.95, Math.max(0.4, options.groundCoverage));
    const baseLayer = bgLayers[0] ?? [];
    const baseCounts = new Map<number, number>();
    let totalBaseTiles = 0;
    for (const column of baseLayer) {
      for (const tileId of column) {
        if (tileId < 0) continue;
        totalBaseTiles += 1;
        baseCounts.set(tileId, (baseCounts.get(tileId) ?? 0) + 1);
      }
    }
    const sortedBaseCounts = Array.from(baseCounts.entries()).sort((a, b) => b[1] - a[1]);
    const groundTiles = new Set<number>();
    let covered = 0;
    for (const [tileId, count] of sortedBaseCounts) {
      if (groundTiles.size >= 6) break;
      groundTiles.add(tileId);
      covered += count;
      if (totalBaseTiles > 0 && covered / totalBaseTiles >= groundCoverage) break;
    }

    const visited = Array.from({ length: MAP_WIDTH }, () => Array(MAP_HEIGHT).fill(false));
    const components: Array<{
      minCol: number;
      maxCol: number;
      minRow: number;
      maxRow: number;
      maskCount: number;
      tileInstanceCount: number;
      transparentCount: number;
      overlayCount: number;
      baseForegroundCount: number;
      categoryCounts: Record<TileCategory, number>;
    }> = [];

    const isForegroundAt = (col: number, row: number) => {
      const baseTile = baseLayer?.[col]?.[row] ?? -1;
      const hasBase = baseTile >= 0 && !groundTiles.has(baseTile);
      let hasOverlay = false;
      for (let layerIndex = 1; layerIndex < bgLayers.length; layerIndex += 1) {
        const overlayTile = bgLayers[layerIndex]?.[col]?.[row] ?? -1;
        if (overlayTile >= 0) {
          hasOverlay = true;
          break;
        }
      }
      return hasBase || hasOverlay;
    };

    for (let col = 0; col < MAP_WIDTH; col += 1) {
      for (let row = 0; row < MAP_HEIGHT; row += 1) {
        if (visited[col][row]) continue;
        if (!isForegroundAt(col, row)) continue;
        let minCol = col;
        let maxCol = col;
        let minRow = row;
        let maxRow = row;
        let maskCount = 0;
        let tileInstanceCount = 0;
        let transparentCount = 0;
        let overlayCount = 0;
        let baseForegroundCount = 0;
        const categoryCounts: Record<TileCategory, number> = {
          terrain: 0,
          paths: 0,
          props: 0,
          buildings: 0,
        };
        const stack: Array<[number, number]> = [[col, row]];
        visited[col][row] = true;
        while (stack.length) {
          const [cx, cy] = stack.pop() as [number, number];
          maskCount += 1;
          minCol = Math.min(minCol, cx);
          maxCol = Math.max(maxCol, cx);
          minRow = Math.min(minRow, cy);
          maxRow = Math.max(maxRow, cy);

          const baseTile = baseLayer?.[cx]?.[cy] ?? -1;
          if (baseTile >= 0 && !groundTiles.has(baseTile)) {
            baseForegroundCount += 1;
            tileInstanceCount += 1;
            if (transparentTiles[baseTile]) transparentCount += 1;
            const category = tilesetCategoryAssignments[baseTile];
            if (category) categoryCounts[category] += 1;
          }

          for (let layerIndex = 1; layerIndex < bgLayers.length; layerIndex += 1) {
            const overlayTile = bgLayers[layerIndex]?.[cx]?.[cy] ?? -1;
            if (overlayTile >= 0) {
              overlayCount += 1;
              tileInstanceCount += 1;
              if (transparentTiles[overlayTile]) transparentCount += 1;
              const category = tilesetCategoryAssignments[overlayTile];
              if (category) categoryCounts[category] += 1;
            }
          }

          const neighbors: Array<[number, number]> = [
            [cx + 1, cy],
            [cx - 1, cy],
            [cx, cy + 1],
            [cx, cy - 1],
          ];
          for (const [nx, ny] of neighbors) {
            if (nx < 0 || ny < 0 || nx >= MAP_WIDTH || ny >= MAP_HEIGHT) continue;
            if (visited[nx][ny]) continue;
            if (!isForegroundAt(nx, ny)) continue;
            visited[nx][ny] = true;
            stack.push([nx, ny]);
          }
        }

        const width = maxCol - minCol + 1;
        const height = maxRow - minRow + 1;
        if (maskCount < minTiles) continue;
        if (width > maxWidth || height > maxHeight) continue;

        components.push({
          minCol,
          maxCol,
          minRow,
          maxRow,
          maskCount,
          tileInstanceCount,
          transparentCount,
          overlayCount,
          baseForegroundCount,
          categoryCounts,
        });
      }
    }

    components.sort((a, b) => b.maskCount - a.maskCount);
    const stamps: StampDefinition[] = [];
    let buildingIndex = 1;
    let pathIndex = 1;
    let treeIndex = 1;
    let prefabIndex = 1;

    for (const component of components.slice(0, maxStamps)) {
      const width = component.maxCol - component.minCol + 1;
      const height = component.maxRow - component.minRow + 1;
      const layers = bgLayers.map((layer, layerIndex) =>
        Array.from({ length: width }, (_, x) =>
          Array.from({ length: height }, (_, y) => {
            const tileId = layer[component.minCol + x]?.[component.minRow + y] ?? -1;
            if (layerIndex === 0 && groundTiles.has(tileId)) return -1;
            return tileId;
          }),
        ),
      );

      const transparentRatio =
        component.tileInstanceCount > 0 ? component.transparentCount / component.tileInstanceCount : 0;
      let name = `Prefab ${prefabIndex}`;
      if (component.categoryCounts.buildings > 0) {
        name = `Building ${buildingIndex}`;
        buildingIndex += 1;
      } else if (component.categoryCounts.paths > 0 || (component.overlayCount === 0 && component.baseForegroundCount > 0)) {
        name = `Path ${pathIndex}`;
        pathIndex += 1;
      } else if (transparentRatio > 0.45) {
        name = `Tree Cluster ${treeIndex}`;
        treeIndex += 1;
      } else if (component.categoryCounts.props > 0 || component.overlayCount > 0) {
        name = `Prefab ${prefabIndex}`;
        prefabIndex += 1;
      } else {
        name = `Prefab ${prefabIndex}`;
        prefabIndex += 1;
      }

      stamps.push({
        id: createStampId(),
        name: `Auto ${name}`,
        width,
        height,
        layers,
      });
    }

    return stamps;
  };

  const extractStampsFromMap = () => {
    const stamps = buildAutoStampsFromMap(autoStampOptions);
    if (stamps.length === 0) {
      alert('No suitable stamp regions found on this map.');
      return;
    }
    if (tilesetStampsForSet.length > 0) {
      const confirmed = window.confirm(`Add ${stamps.length} auto stamps to the existing list?`);
      if (!confirmed) return;
    }
    setTilesetStamps((prev) => {
      const next = { ...prev };
      const list = [...(next[tileset.id] ?? []), ...stamps];
      next[tileset.id] = list;
      return next;
    });
    setActiveStampId(stamps[0].id);
    applyMode('prefabs');
    setAutoGeneratedStamps((prev) => ({ ...prev, [tileset.id]: true }));
  };


  const placeStampAt = (row: number, col: number) => {
    if (!activeStamp) return;
    const stampSize = transformedStampSize ?? { width: activeStamp.width, height: activeStamp.height };
    if (col + stampSize.width > MAP_WIDTH || row + stampSize.height > MAP_HEIGHT) {
      return;
    }
    setBgLayers((prev) => {
      const next = prev.map((layer) => layer.map((column) => [...column]));
      const layerCount = Math.min(activeStamp.layers.length, next.length);
      for (let layerIndex = 0; layerIndex < layerCount; layerIndex += 1) {
        const stampLayer = activeStamp.layers[layerIndex] ?? [];
        for (let x = 0; x < activeStamp.width; x += 1) {
          for (let y = 0; y < activeStamp.height; y += 1) {
            const tileId = stampLayer[x]?.[y] ?? -1;
            if (tileId < 0 && stampSkipEmpty) continue;
            const transformed = transformStampCoord(x, y, activeStamp);
            const targetCol = col + transformed.x;
            const targetRow = row + transformed.y;
            if (targetCol < 0 || targetCol >= MAP_WIDTH || targetRow < 0 || targetRow >= MAP_HEIGHT) {
              continue;
            }
            if (!next[layerIndex]?.[targetCol]) continue;
            next[layerIndex][targetCol][targetRow] = tileId;
          }
        }
      }
      return next;
    });
  };

  const placeObjectAt = (row: number, col: number) => {
    if (!activeObject) return;
    const bounds = getObjectTileBounds(activeObject, { col, row });
    if (
      bounds.startCol < 0 ||
      bounds.startRow < 0 ||
      bounds.endCol >= MAP_WIDTH ||
      bounds.endRow >= MAP_HEIGHT
    ) {
      return;
    }
    setPlacedObjects((prev) => [
      ...prev,
      {
        id: createPlacedObjectId(),
        objectId: activeObject.id,
        col,
        row,
      },
    ]);
    pushRecentObject(activeObject.id);
  };

  const removeObjectAt = (row: number, col: number) => {
    setPlacedObjects((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i -= 1) {
        const placement = next[i];
        const objectDef = objectsById.get(placement.objectId);
        if (!objectDef) continue;
        const bounds = getObjectTileBounds(objectDef, placement);
        if (col >= bounds.startCol && col <= bounds.endCol && row >= bounds.startRow && row <= bounds.endRow) {
          next.splice(i, 1);
          break;
        }
      }
      return next;
    });
  };

  const applyToolAt = (
    row: number,
    col: number,
    tool: 'brush' | 'eraser' | 'eyedropper' | 'stamp' | 'object',
  ) => {
    if (tool === 'stamp') {
      placeStampAt(row, col);
      return;
    }
    if (tool === 'object') {
      placeObjectAt(row, col);
      return;
    }
    if (tool === 'eyedropper') {
      const { tileId, layerIndex } = getTopTileAt(row, col);
      selectTileId(tileId, { layerOverride: layerIndex });
      return;
    }
    const tileIdToPlace = tool === 'eraser' ? -1 : selectedTileId;
    if (tileIdToPlace === null) return;
    setBgLayers((prev) => {
      const targetLayer = prev[activeLayerIndex];
      if (!targetLayer?.[col]) return prev;
      if (targetLayer[col][row] === tileIdToPlace) return prev;
      const next = prev.map((layer, layerIndex) => {
        if (layerIndex !== activeLayerIndex) return layer;
        const nextLayer = layer.map((column) => [...column]);
        if (!nextLayer[col]) return layer;
        nextLayer[col][row] = tileIdToPlace;
        return nextLayer;
      });
      return next;
    });
    if (tileIdToPlace >= 0) {
      pushRecentTile(tileIdToPlace);
    }
  };

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
    row: number,
    col: number,
  ) => {
    event.preventDefault();
    if (stampCaptureMode) {
      setStampSelection({ startRow: row, startCol: col, endRow: row, endCol: col });
      setIsStampSelecting(true);
      return;
    }
    const { tileId, layerIndex } = getTopTileAt(row, col);
    setHoverInfo({
      row,
      col,
      tileId,
      tileLayerIndex: layerIndex,
      collisionValue: collisionLayer[col]?.[row] ?? -1,
    });
    if (activeTool === 'object' && event.button === 2) {
      removeObjectAt(row, col);
      return;
    }
    const tool = event.button === 2 ? 'eraser' : activeTool;
    dragToolRef.current = tool;
    setIsPointerDown(true);
    applyToolAt(row, col, tool);
    if (tool === 'eyedropper' || tool === 'stamp' || tool === 'object') {
      dragToolRef.current = null;
      setIsPointerDown(false);
    }
  };

  const handlePointerEnter = (row: number, col: number) => {
    if (stampCaptureMode && isStampSelecting) {
      setStampSelection((prev) =>
        prev ? { ...prev, endRow: row, endCol: col } : { startRow: row, startCol: col, endRow: row, endCol: col },
      );
      return;
    }
    const { tileId, layerIndex } = getTopTileAt(row, col);
    const collisionValue = collisionLayer[col]?.[row] ?? -1;
    setHoverInfo({ row, col, tileId, tileLayerIndex: layerIndex, collisionValue });
    if (isPointerDown && dragToolRef.current) {
      applyToolAt(row, col, dragToolRef.current);
    }
  };

  const handlePalettePointerDown = (event: ReactPointerEvent<HTMLDivElement>, tileId: number) => {
    if (objectCaptureMode) {
      event.preventDefault();
      setObjectPaletteSelection({ startId: tileId, endId: tileId });
      setIsObjectPaletteSelecting(true);
      return;
    }
    if (!bulkTagMode || paletteMode !== 'all' || activeCategory !== 'all') return;
    event.preventDefault();
    setPaletteSelection({ startId: tileId, endId: tileId });
    setIsPaletteSelecting(true);
  };

  const handlePalettePointerEnter = (tileId: number) => {
    if (objectCaptureMode) {
      if (!isObjectPaletteSelecting) return;
      setObjectPaletteSelection((prev) => (prev ? { ...prev, endId: tileId } : { startId: tileId, endId: tileId }));
      return;
    }
    if (!isPaletteSelecting || !bulkTagMode || paletteMode !== 'all' || activeCategory !== 'all') return;
    setPaletteSelection((prev) => (prev ? { ...prev, endId: tileId } : { startId: tileId, endId: tileId }));
  };

  useEffect(() => {
    const handlePointerUp = () => {
      setIsPointerDown(false);
      dragToolRef.current = null;
      setIsStampSelecting(false);
      setIsPaletteSelecting(false);
      setIsObjectPaletteSelecting(false);
    };
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      const key = event.key.toLowerCase();
      if (key === 'b') activateTileTool('brush');
      if (key === 'e') activateTileTool('eraser');
      if (key === 'i') activateTileTool('eyedropper');
      if (key === 's') applyMode('prefabs');
      if (key === 'o') applyMode('objects');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Export map data
  const exportMap = () => {
    const objectSprites = placedObjects
      .map((placement) => {
        const def = objectsById.get(placement.objectId);
        if (!def) return null;
        return {
          id: placement.id,
          name: def.name,
          tileX: def.tileX,
          tileY: def.tileY,
          tileWidth: def.tileWidth,
          tileHeight: def.tileHeight,
          anchor: def.anchor,
          imagePath: def.imagePath,
          pixelWidth: def.pixelWidth,
          pixelHeight: def.pixelHeight,
          col: placement.col,
          row: placement.row,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    const mapData = {
      tilesetpath: tilesetUrl,
      tiledim: tileset.tileDim,
      tilesetpxw: tileset.pixelWidth,
      tilesetpxh: tileset.pixelHeight,
      mapwidth: MAP_WIDTH,
      mapheight: MAP_HEIGHT,
      bgtiles: bgLayers,
      objmap: [collisionLayer], // Keep same structure
      animatedsprites: animatedSprites,
      objectCatalog: tilesetObjectsForSet,
      objectPlacements: placedObjects,
      objectSprites,
    };
    console.log("===== EXPORTED MAP DATA =====");
    console.log(JSON.stringify(mapData, null, 2));
    const blob = new Blob([JSON.stringify(mapData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'map_export.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    alert("Map exported! Check your downloads folder.");
  };

  return (
    <div className="w-full h-screen bg-[#f5e6c8] text-[#4a3728] flex overflow-hidden">
      {/* Sidebar: Tile Palette - Stardew Valley Style */}
      <div className="w-72 bg-[#8b6b4a] p-3 border-r-4 border-[#6d4c30] flex flex-col shrink-0 overflow-hidden shadow-[inset_0_0_20px_rgba(0,0,0,0.3)] relative">
        <div className="absolute top-0 left-4 w-1 h-3 bg-[#3b2a21] z-10"></div>
        <div className="absolute top-0 right-4 w-1 h-3 bg-[#3b2a21] z-10"></div>
        <div className="mb-4 mt-2 bg-[#3b2a21] border-2 border-[#5a4030] p-2 rounded shadow-[0_2px_4px_rgba(0,0,0,0.4)] relative">
          <div className="absolute -top-1 left-3.5 w-2 h-2 rounded-full bg-[#1a110d] border border-[#5a4030]"></div>
          <div className="absolute -top-1 right-3.5 w-2 h-2 rounded-full bg-[#1a110d] border border-[#5a4030]"></div>
          <h2 className="text-lg font-display text-center text-[#f6e2b0] drop-shadow-[0_2px_0_#4a3728] tracking-widest">
            🌿 TILE PALETTE
          </h2>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          <div className="mb-3">
          <label className="block text-xs text-[#f3e2b5]/80 mb-1">Tileset</label>
          <select
            value={tileset.id}
            onChange={(event) => handleTilesetChange(event.target.value)}
            className="w-full bg-[#5a4030] border-2 border-[#6d4c30] text-sm px-2 py-1 rounded text-[#f3e2b5]"
          >
            {tilesetOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[10px] text-[#f3e2b5]/60">Switching tileset resets the map.</p>
          {packLoadError && (
            <p className="mt-2 text-[11px] text-red-300 break-words">{packLoadError}</p>
          )}
          {tilesetLoadError && (
            <p className="mt-2 text-[11px] text-red-300 break-words">{tilesetLoadError}</p>
          )}
          </div>

          {/* Display Options */}
          <div className="mb-3 space-y-1">
          <label className="flex items-center gap-2 text-sm cursor-pointer text-[#f3e2b5]">
            <input
              type="checkbox"
              checked={showCollision}
              onChange={(e) => setShowCollision(e.target.checked)}
              className="rounded accent-[#5fa052]"
            />
            Show Collision Overlay
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer text-[#f3e2b5]">
            <input
              type="checkbox"
              checked={autoLayerByTransparency}
              onChange={(e) => setAutoLayerByTransparency(e.target.checked)}
              className="rounded accent-[#5fa052]"
            />
            Auto place transparent tiles on Overlay
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer text-[#f3e2b5]">
            <input
              type="checkbox"
              checked={showAnimatedSprites}
              onChange={(e) => setShowAnimatedSprites(e.target.checked)}
              className="rounded accent-[#5fa052]"
            />
            Show Animated Sprites (Pixi)
          </label>
          </div>

          {/* Collision Legend */}
          <div className="mb-3 p-2 bg-[#5a4030] rounded border border-[#6d4c30] text-xs text-[#f3e2b5]">
          <p className="font-bold mb-1">Collision Legend:</p>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-green-500/50 border border-green-400"></div>
            <span>Walkable ({COLLISION_WALKABLE})</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-red-500/50 border border-red-400"></div>
            <span>Blocked ({COLLISION_BLOCKED})</span>
          </div>
          </div>

          {/* Selected Tile Preview */}
          {showTilePanel && (
            <div className="mb-3 p-3 bg-[#5a4030] border border-[#6d4c30] rounded text-center shadow-[inset_0_0_10px_rgba(0,0,0,0.2)]">
              <p className="text-xs text-[#f3e2b5]/80 mb-2 font-display tracking-wide uppercase">Selected Tile</p>
              {selectedTileId !== null && selectedTileId >= 0 && tilesetLoaded && (
                <div
                  className="mx-auto border-2 border-[#ffd93d] shadow-[0_0_10px_rgba(255,217,61,0.3)] bg-[#e8d4b0]"
                  style={{
                    width: tileSize * 2,
                    height: tileSize * 2,
                    backgroundImage: `url(${tilesetUrl})`,
                    backgroundPosition: `-${getTilePos(selectedTileId).sx * 2}px -${getTilePos(selectedTileId).sy * 2}px`,
                    backgroundSize: `${tilesetCols * tileSize * 2}px ${tilesetRows * tileSize * 2}px`,
                  }}
                />
              )}
              <p className="mt-2 text-[10px] text-gray-400">
                Category:{' '}
                {selectedTileCategory
                  ? CATEGORY_FILTERS.find((item) => item.id === selectedTileCategory)?.label ?? selectedTileCategory
                  : 'Unassigned'}
              </p>
              <label className="block mt-2 text-[10px] text-gray-400 mb-1 text-left">Tag selected tile</label>
              <select
                value={selectedTileCategory ?? ''}
                onChange={(event) => {
                  const value = event.target.value as TileCategory | '';
                  assignSelectedToCategory(value ? value : null);
                }}
                disabled={selectedTileId === null || selectedTileId < 0}
                className="w-full bg-gray-900 border border-gray-700 text-[11px] px-2 py-1 rounded disabled:opacity-50"
              >
                <option value="">Unassigned</option>
                {CATEGORY_FILTERS.filter((item) => item.id !== 'all').map((item) => (
                  <option key={`tag-${item.id}`} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {showStampPanel && (
            <div className="mb-3 p-2 bg-gray-700 rounded">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-gray-300">Stamps</p>
                <button
                  onClick={() => setShowAutoStampOptions((prev) => !prev)}
                  className="text-[10px] px-2 py-1 border border-gray-600 rounded hover:border-gray-400"
                >
                  {showAutoStampOptions ? 'Hide' : 'Options'}
                </button>
              </div>
              <div className="flex flex-wrap gap-1 mb-2">
                <button
                  onClick={extractStampsFromMap}
                  className="text-[10px] px-2 py-1 border border-gray-600 rounded hover:border-gray-400"
                  title="Auto-generate stamps from the current map"
                >
                  Extract
                </button>
                <button
                  onClick={() => {
                    setStampCaptureMode((prev) => {
                      if (prev) {
                        setStampSelection(null);
                        setStampNameDraft('');
                        setIsStampSelecting(false);
                      }
                      return !prev;
                    });
                  }}
                  className="text-[10px] px-2 py-1 border border-gray-600 rounded hover:border-gray-400"
                >
                  {stampCaptureMode ? 'Cancel' : 'Capture'}
                </button>
                <button
                  onClick={() => stampFileInputRef.current?.click()}
                  className="text-[10px] px-2 py-1 border border-gray-600 rounded hover:border-gray-400"
                >
                  Import
                </button>
                <button
                  onClick={exportStamps}
                  className="text-[10px] px-2 py-1 border border-gray-600 rounded hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={tilesetStampsForSet.length === 0}
                >
                  Export
                </button>
                <input
                  ref={stampFileInputRef}
                  type="file"
                  accept="application/json"
                  onChange={handleStampImport}
                  className="hidden"
                />
              </div>
              {showAutoStampOptions && (
                <div className="mb-2 p-2 bg-gray-800/70 rounded text-[11px] space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-gray-400">Min tiles</span>
                      <input
                        type="number"
                        min={1}
                        max={128}
                        value={autoStampOptions.minTiles}
                        onChange={(event) =>
                          updateAutoStampOptions({
                            minTiles: Math.max(1, Math.min(128, Number(event.target.value) || 1)),
                          })
                        }
                        className="bg-gray-900 border border-gray-700 rounded px-2 py-1"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-gray-400">Max stamps</span>
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={autoStampOptions.maxStamps}
                        onChange={(event) =>
                          updateAutoStampOptions({
                            maxStamps: Math.max(1, Math.min(50, Number(event.target.value) || 1)),
                          })
                        }
                        className="bg-gray-900 border border-gray-700 rounded px-2 py-1"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-gray-400">Max width</span>
                      <input
                        type="number"
                        min={1}
                        max={64}
                        value={autoStampOptions.maxWidth}
                        onChange={(event) =>
                          updateAutoStampOptions({
                            maxWidth: Math.max(1, Math.min(64, Number(event.target.value) || 1)),
                          })
                        }
                        className="bg-gray-900 border border-gray-700 rounded px-2 py-1"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-gray-400">Max height</span>
                      <input
                        type="number"
                        min={1}
                        max={64}
                        value={autoStampOptions.maxHeight}
                        onChange={(event) =>
                          updateAutoStampOptions({
                            maxHeight: Math.max(1, Math.min(64, Number(event.target.value) || 1)),
                          })
                        }
                        className="bg-gray-900 border border-gray-700 rounded px-2 py-1"
                      />
                    </label>
                  </div>
                  <label className="flex items-center gap-2">
                    <span className="text-gray-400">Ground coverage</span>
                    <input
                      type="number"
                      min={0.4}
                      max={0.95}
                      step={0.05}
                      value={autoStampOptions.groundCoverage}
                      onChange={(event) =>
                        updateAutoStampOptions({
                          groundCoverage: Math.min(0.95, Math.max(0.4, Number(event.target.value) || 0.7)),
                        })
                      }
                      className="w-20 bg-gray-900 border border-gray-700 rounded px-2 py-1"
                    />
                    <span className="text-gray-500">0.4 - 0.95</span>
                  </label>
                </div>
              )}
              {stampCaptureMode && (
                <p className="text-[11px] text-gray-300 mb-2">
                  Drag on the map to select a stamp area.
                </p>
              )}
              {stampCaptureMode && selectionBounds && (
                <div className="space-y-2 mb-2">
                  <div className="text-[10px] text-gray-400">
                    Selection: {selectionBounds.maxCol - selectionBounds.minCol + 1}x
                    {selectionBounds.maxRow - selectionBounds.minRow + 1}
                  </div>
                  <input
                    type="text"
                    value={stampNameDraft}
                    onChange={(event) => setStampNameDraft(event.target.value)}
                    placeholder="Stamp name"
                    className="w-full bg-gray-900 border border-gray-700 text-[11px] px-2 py-1 rounded"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={saveStampFromSelection}
                      className="text-[11px] px-2 py-1 border border-emerald-400 text-emerald-200 rounded hover:bg-emerald-500/10"
                    >
                      Save Stamp
                    </button>
                    <button
                      onClick={() => setStampSelection(null)}
                      className="text-[11px] px-2 py-1 border border-gray-600 rounded hover:border-gray-400"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}
              <label className="flex items-center gap-2 text-[11px] text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={stampSkipEmpty}
                  onChange={(event) => setStampSkipEmpty(event.target.checked)}
                  className="rounded"
                />
                Stamp skips empty tiles
              </label>
              <div className="mt-2 max-h-32 overflow-y-auto pr-1 space-y-1">
                {tilesetStampsForSet.length === 0 ? (
                  <p className="text-[11px] text-gray-400">No stamps yet.</p>
                ) : (
                  tilesetStampsForSet.map((stamp) => (
                    <div key={stamp.id} className="flex items-start gap-2">
                      {tilesetLoaded ? (
                        (() => {
                          const preview = getStampPreviewData(stamp);
                          return (
                            <div
                              className="relative border border-gray-600 bg-gray-900"
                              style={{ width: preview.width, height: preview.height }}
                            >
                              {preview.tiles.map((tile, index) => {
                                const pos = getTilePos(tile.tileId);
                                return (
                                  <div
                                    key={`stamp-thumb-${stamp.id}-${index}`}
                                    className="absolute"
                                    style={{
                                      left: tile.x * preview.previewTileSize,
                                      top: tile.y * preview.previewTileSize,
                                      width: preview.previewTileSize,
                                      height: preview.previewTileSize,
                                      backgroundImage: `url(${tilesetUrl})`,
                                      backgroundPosition: `-${pos.sx * preview.scale}px -${pos.sy * preview.scale}px`,
                                      backgroundSize: `${tilesetCols * tileSize * preview.scale}px ${tilesetRows * tileSize * preview.scale}px`,
                                    }}
                                  />
                                );
                              })}
                            </div>
                          );
                        })()
                      ) : (
                        <div className="w-12 h-12 border border-gray-600 bg-gray-900" />
                      )}
                      <div className="flex-1 space-y-1">
                        {editingStampId === stamp.id ? (
                          <div className="space-y-1">
                            <input
                              value={stampRenameDraft}
                              onChange={(event) => setStampRenameDraft(event.target.value)}
                              className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-[11px]"
                            />
                            <div className="flex gap-1">
                              <button
                                onClick={() => {
                                  renameStamp(stamp.id, stampRenameDraft);
                                  setEditingStampId(null);
                                }}
                                className="px-2 py-1 border border-gray-600 rounded hover:border-gray-400 text-[10px]"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => {
                                  setEditingStampId(null);
                                  setStampRenameDraft('');
                                }}
                                className="px-2 py-1 border border-gray-600 rounded hover:border-gray-400 text-[10px]"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                            setActiveStampId(stamp.id);
                            applyMode('prefabs');
                            }}
                            className={`w-full text-left text-[11px] px-2 py-1 border rounded ${
                              activeStampId === stamp.id
                                ? 'border-yellow-400 bg-yellow-500/10 text-yellow-200'
                                : 'border-gray-600 hover:border-gray-400 text-gray-200'
                            }`}
                          >
                            {stamp.name} <span className="text-gray-500">({stamp.width}x{stamp.height})</span>
                          </button>
                        )}
                      </div>
                      <div className="flex flex-col gap-1">
                        <button
                          onClick={() => {
                            setEditingStampId(stamp.id);
                            setStampRenameDraft(stamp.name);
                          }}
                          className="text-[10px] px-2 py-1 border border-gray-600 rounded hover:border-gray-400"
                          title="Rename stamp"
                        >
                          Rename
                        </button>
                        <button
                          onClick={() => removeStamp(stamp.id)}
                          className="text-[10px] px-2 py-1 border border-gray-600 rounded hover:border-gray-400"
                          title="Delete stamp"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
              {activeStamp && (
                <div className="mt-2 text-[11px] text-gray-300 space-y-2">
                  <div>
                    Active: <span className="text-gray-100">{activeStamp.name}</span> ({activeStamp.width}x{activeStamp.height})
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    <button
                      onClick={() =>
                        setStampRotation((prev) => ((prev + 270) % 360) as StampRotation)
                      }
                      className="px-2 py-1 border border-gray-600 rounded hover:border-gray-400"
                    >
                      Rotate Left
                    </button>
                    <button
                      onClick={() =>
                        setStampRotation((prev) => ((prev + 90) % 360) as StampRotation)
                      }
                      className="px-2 py-1 border border-gray-600 rounded hover:border-gray-400"
                    >
                      Rotate Right
                    </button>
                    <button
                      onClick={() => setStampFlipX((prev) => !prev)}
                      className={`px-2 py-1 border rounded ${
                        stampFlipX ? 'border-yellow-400 text-yellow-200' : 'border-gray-600 hover:border-gray-400'
                      }`}
                    >
                      Flip X
                    </button>
                    <button
                      onClick={() => setStampFlipY((prev) => !prev)}
                      className={`px-2 py-1 border rounded ${
                        stampFlipY ? 'border-yellow-400 text-yellow-200' : 'border-gray-600 hover:border-gray-400'
                      }`}
                    >
                      Flip Y
                    </button>
                    <button
                      onClick={() => {
                        setStampRotation(0);
                        setStampFlipX(false);
                        setStampFlipY(false);
                      }}
                      className="px-2 py-1 border border-gray-600 rounded hover:border-gray-400"
                    >
                      Reset
                    </button>
                  </div>
                  <div className="text-[10px] text-gray-400">
                    Rotation {stampRotation}deg{stampFlipX ? ' | Flip X' : ''}{stampFlipY ? ' | Flip Y' : ''}
                  </div>
                </div>
              )}
            </div>
          )}

          {showObjectPanel && (
            <div className="mb-3 p-2 bg-gray-700 rounded">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-gray-300">Objects / Props</p>
                <button
                  onClick={() =>
                    setObjectCaptureMode((prev) => {
                      const next = !prev;
                      if (next) {
                        setPaletteMode('all');
                        setActiveCategory('all');
                        setBulkTagMode(false);
                        setPaletteSelection(null);
                        setIsPaletteSelecting(false);
                      } else {
                        setObjectPaletteSelection(null);
                        setObjectNameDraft('');
                      }
                      return next;
                    })
                  }
                  className="text-[10px] px-2 py-1 border border-gray-600 rounded hover:border-gray-400"
                >
                  {objectCaptureMode ? 'Cancel' : 'Capture'}
                </button>
              </div>
              <label className="flex items-center gap-2 text-[11px] text-gray-300 mb-2">
                Pack
                <select
                  value={activeObjectPack?.id ?? ''}
                  onChange={(event) => setActiveObjectPackId(event.target.value)}
                  className="flex-1 bg-gray-900 border border-gray-700 text-[11px] px-2 py-1 rounded"
                  disabled={objectPacks.length === 0}
                >
                  {objectPacks.length === 0 ? (
                    <option value="">No packs loaded</option>
                  ) : (
                    objectPacks.map((pack) => (
                      <option key={pack.id} value={pack.id}>
                        {pack.name}
                      </option>
                    ))
                  )}
                </select>
              </label>
              {objectCaptureMode && (
                <div className="space-y-2 mb-2">
                  <p className="text-[11px] text-gray-300">
                    Drag on the tileset below to capture a single-sprite object.
                  </p>
                  {objectSelectionBounds && (
                    <div className="text-[10px] text-gray-400">
                      Selection: {objectSelectionBounds.maxCol - objectSelectionBounds.minCol + 1}x
                      {objectSelectionBounds.maxRow - objectSelectionBounds.minRow + 1} tiles
                    </div>
                  )}
                  <input
                    type="text"
                    value={objectNameDraft}
                    onChange={(event) => setObjectNameDraft(event.target.value)}
                    placeholder="Object name"
                    className="w-full bg-gray-900 border border-gray-700 text-[11px] px-2 py-1 rounded"
                  />
                  <label className="flex items-center gap-2 text-[11px] text-gray-300">
                    Anchor
                    <select
                      value={objectAnchor}
                      onChange={(event) => setObjectAnchor(event.target.value as ObjectAnchor)}
                      className="bg-gray-900 border border-gray-700 text-[11px] px-2 py-1 rounded"
                    >
                      <option value="bottom-left">Bottom-left</option>
                      <option value="top-left">Top-left</option>
                    </select>
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={saveObjectFromSelection}
                      disabled={!objectSelectionBounds}
                      className="text-[11px] px-2 py-1 border border-emerald-400 text-emerald-200 rounded hover:bg-emerald-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Save Object
                    </button>
                    <button
                      onClick={() => setObjectPaletteSelection(null)}
                      className="text-[11px] px-2 py-1 border border-gray-600 rounded hover:border-gray-400"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}
              <div className="mt-1 max-h-32 overflow-y-auto pr-1 space-y-1">
                {tilesetObjectsForSet.length === 0 ? (
                  <p className="text-[11px] text-gray-400">No objects yet.</p>
                ) : (
                  tilesetObjectsForSet.map((obj) => (
                    <div key={obj.id} className="flex items-start gap-2">
                      {tilesetLoaded || obj.imagePath ? (
                        (() => {
                          const preview = getObjectPreviewData(obj);
                          return (
                            <div
                              className="border border-gray-600 bg-gray-900"
                              style={{
                                width: preview.width,
                                height: preview.height,
                                backgroundImage: `url(${preview.imageUrl})`,
                                backgroundPosition: preview.backgroundPosition,
                                backgroundSize: preview.backgroundSize,
                                backgroundRepeat: 'no-repeat',
                              }}
                            />
                          );
                        })()
                      ) : (
                        <div className="w-12 h-12 border border-gray-600 bg-gray-900" />
                      )}
                      <div className="flex-1 space-y-1">
                        {obj.readonly && (
                          <div className="text-[10px] text-gray-500">{obj.packName ?? 'Pack'}</div>
                        )}
                        {editingObjectId === obj.id ? (
                          <div className="space-y-1">
                            <input
                              value={objectRenameDraft}
                              onChange={(event) => setObjectRenameDraft(event.target.value)}
                              className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-[11px]"
                            />
                            <div className="flex gap-1">
                              <button
                                onClick={() => {
                                  renameObject(obj.id, objectRenameDraft);
                                  setEditingObjectId(null);
                                }}
                                className="px-2 py-1 border border-gray-600 rounded hover:border-gray-400 text-[10px]"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => {
                                  setEditingObjectId(null);
                                  setObjectRenameDraft('');
                                }}
                                className="px-2 py-1 border border-gray-600 rounded hover:border-gray-400 text-[10px]"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              selectObjectId(obj.id);
                            }}
                            className={`w-full text-left text-[11px] px-2 py-1 border rounded ${
                              activeObjectId === obj.id
                                ? 'border-yellow-400 bg-yellow-500/10 text-yellow-200'
                                : 'border-gray-600 hover:border-gray-400 text-gray-200'
                            }`}
                          >
                            {obj.name} <span className="text-gray-500">({obj.tileWidth}x{obj.tileHeight})</span>
                          </button>
                        )}
                      </div>
                      <div className="flex flex-col gap-1">
                        <button
                          onClick={() => {
                            if (obj.readonly) return;
                            setEditingObjectId(obj.id);
                            setObjectRenameDraft(obj.name);
                          }}
                          disabled={obj.readonly}
                          className="text-[10px] px-2 py-1 border border-gray-600 rounded hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Rename object"
                        >
                          Rename
                        </button>
                        <button
                          onClick={() => removeObjectDefinition(obj.id)}
                          disabled={obj.readonly}
                          className="text-[10px] px-2 py-1 border border-gray-600 rounded hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Delete object"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
              {activeObject && (
                <div className="mt-2 text-[11px] text-gray-300">
                  Active: <span className="text-gray-100">{activeObject.name}</span> ({activeObject.tileWidth}x{activeObject.tileHeight}) · Anchor {activeObject.anchor}
                </div>
              )}
            </div>
          )}

          {showTilePanel && (
            <div
              className={`border border-gray-600 rounded p-1 max-h-[48vh] overflow-y-auto ${
                objectCaptureMode ? 'overflow-x-auto' : 'overflow-x-hidden'
              }`}
              onContextMenu={(event) => event.preventDefault()}
            >
              <div className="mb-2">
                <p className="text-xs text-[#f3e2b5]/80 mb-2 font-display tracking-wide uppercase">Filters</p>
                <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                  {CATEGORY_FILTERS.map((item) => (
                     <button
                      key={`cat-${item.id}`}
                      onClick={() => setActiveCategory(item.id)}
                      disabled={objectCaptureMode}
                      className={`px-2 py-1.5 border-2 rounded text-[10px] uppercase font-bold tracking-wide transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                        activeCategory === item.id
                          ? 'bg-[#a8683a] border-[#ffd93d] text-[#fff2c4] shadow-[inset_0_0_0_1px_#ffd93d] -translate-y-[1px]'
                          : 'bg-[#5a3a2a] border-[#b88d5e] text-[#f3e2b5] hover:bg-[#6a452f] hover:border-[#cfb084]'
                      }`}
                    >
                      {item.label} <span className="opacity-70">({categoryCounts[item.id]})</span>
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={autoTagUsedTiles}
                    className="flex-1 text-[10px] px-2 py-1.5 bg-[#3b2a21] border border-[#5a4030] text-[#f3e2b5] rounded hover:bg-[#5a4030] uppercase font-bold tracking-wide"
                  >
                    Auto-tag used
                  </button>
                  <span className="text-[9px] text-[#f3e2b5]/60 italic">Terrain/Props</span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() =>
                      setBulkTagMode((prev) => {
                        const next = !prev;
                        if (next) {
                          setPaletteMode('all');
                          setActiveCategory('all');
                        }
                        return next;
                      })
                    }
                    disabled={objectCaptureMode}
                    className={`text-[11px] px-2 py-1 border rounded disabled:opacity-50 disabled:cursor-not-allowed ${
                      bulkTagMode
                        ? 'border-yellow-400 text-yellow-200'
                        : 'border-gray-600 hover:border-gray-400 text-gray-200'
                    }`}
                  >
                    Batch Tag
                  </button>
                  <span className="text-[10px] text-gray-500">
                    {bulkTagMode
                      ? paletteMode === 'all' && activeCategory === 'all'
                        ? `Selected ${paletteSelectionCount}`
                        : 'Switch to All + All categories'
                      : 'Drag to select tiles'}
                  </span>
                </div>
                {bulkTagMode && paletteSelectionCount > 0 && (
                  <div className="mt-2 grid grid-cols-2 gap-1 text-[11px]">
                    {CATEGORY_FILTERS.filter((item) => item.id !== 'all').map((item) => {
                      const category = item.id as TileCategory;
                      return (
                        <button
                          key={`bulk-${item.id}`}
                          onClick={() => applyCategoryToSelection(category)}
                          className="px-2 py-1 border border-gray-600 rounded hover:border-gray-400"
                        >
                          {item.label}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => applyCategoryToSelection(null)}
                      className="px-2 py-1 border border-gray-600 rounded hover:border-gray-400"
                    >
                      Clear
                    </button>
                    <button
                      onClick={() => setPaletteSelection(null)}
                      className="px-2 py-1 border border-gray-600 rounded hover:border-gray-400"
                    >
                      Deselect
                    </button>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 mb-2 text-xs text-gray-300">
                <button
                  onClick={() => setPaletteMode('used')}
                  disabled={objectCaptureMode}
                  className={`px-2 py-1 border disabled:opacity-50 disabled:cursor-not-allowed ${
                    paletteMode === 'used'
                      ? 'bg-yellow-500/20 border-yellow-400 text-yellow-200'
                      : 'bg-gray-800 border-gray-700 hover:border-gray-500'
                  }`}
                >
                  Used ({visibleUsedTileIds.length})
                </button>
                <button
                  onClick={() => setPaletteMode('all')}
                  disabled={objectCaptureMode}
                  className={`px-2 py-1 border disabled:opacity-50 disabled:cursor-not-allowed ${
                    paletteMode === 'all'
                      ? 'bg-yellow-500/20 border-yellow-400 text-yellow-200'
                      : 'bg-gray-800 border-gray-700 hover:border-gray-500'
                  }`}
                >
                  All ({visibleAllTileIds.length})
                </button>
              </div>
              {!tilesetLoaded ? (
                <p className="text-center text-gray-500">Loading tileset...</p>
              ) : paletteMode === 'used' && visibleUsedTileIds.length === 0 ? (
                <div className="text-xs text-gray-400">
                  No used tiles yet. Switch to <span className="text-gray-200">All</span> to pick a tile.
                </div>
              ) : activeCategory !== 'all' && paletteTileIds.length === 0 ? (
                <div className="text-xs text-gray-400">
                  No tiles tagged for {CATEGORY_FILTERS.find((item) => item.id === activeCategory)?.label ?? activeCategory}.
                  Tag tiles above to populate this category.
                </div>
              ) : (
                <div
                  className="grid gap-[1px]"
                  style={{ gridTemplateColumns: `repeat(${objectCaptureMode ? tilesetCols : 8}, ${tileSize}px)` }}
                >
                  {!objectCaptureMode && (
                    <div
                      onClick={() => {
                        if (!bulkTagMode || paletteMode !== 'all' || activeCategory !== 'all') {
                          selectTileId(-1);
                        }
                      }}
                      className={`cursor-pointer border-2 flex items-center justify-center text-xs text-red-400 ${
                        selectedTileId === -1 ? 'border-yellow-400' : 'border-gray-600'
                      }`}
                      style={{ width: tileSize, height: tileSize, backgroundColor: '#333' }}
                      title="Eraser (-1)"
                    >
                      X
                    </div>
                  )}
                  {paletteTileIds.map((tileId) => {
                    const isHiddenTile = hiddenTiles[tileId];
                    const { sx, sy } = getTilePos(tileId);
                    const usedCount = usedTileStats.counts.get(tileId) ?? 0;
                    const isPaletteSelected = paletteSelectionSet.has(tileId);
                    const isObjectSelected = objectSelectionSet.has(tileId);
                    const borderClass = objectCaptureMode && isObjectSelected
                      ? 'border-emerald-400'
                      : isPaletteSelected
                      ? 'border-cyan-400'
                      : selectedTileId === tileId
                      ? 'border-yellow-400'
                      : objectCaptureMode && isHiddenTile
                      ? 'border-gray-700'
                      : 'border-transparent hover:border-gray-500';
                    return (
                      <div
                        key={tileId}
                        onClick={() => {
                          if (objectCaptureMode) return;
                          if (!bulkTagMode || paletteMode !== 'all' || activeCategory !== 'all') {
                            selectTileId(tileId);
                          }
                        }}
                        onPointerDown={(event) => handlePalettePointerDown(event, tileId)}
                        onPointerEnter={() => handlePalettePointerEnter(tileId)}
                        className={`cursor-pointer border-2 ${borderClass}`}
                        style={{
                          width: tileSize,
                          height: tileSize,
                          backgroundColor: isHiddenTile ? '#111827' : undefined,
                          backgroundImage:
                            isHiddenTile && objectCaptureMode ? 'none' : `url(${tilesetUrl})`,
                          backgroundPosition: `-${sx}px -${sy}px`,
                          backgroundSize: `${tilesetCols * tileSize}px ${tilesetRows * tileSize}px`,
                        }}
                        title={
                          isHiddenTile
                            ? `Hidden tile #${tileId}`
                            : paletteMode === 'used'
                            ? `Tile #${tileId} · Used ${usedCount}`
                            : `Tile #${tileId}`
                        }
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <button
          onClick={exportMap}
          className="button mt-3 w-full font-display text-lg tracking-wide"
        >
          <span>📜 Export Map</span>
        </button>
      </div>

      {/* Main Area: Map Editor Canvas - Stardew Valley Parchment Style */}
      <div className="flex-grow overflow-auto p-2 bg-[#e8d4b0] relative">
        <div className="mb-2 px-3 py-2 border-2 border-[#caa26a] bg-[#3b2a21] rounded-md shadow-[0_3px_0_#2a1c15]">
          <div className="flex flex-wrap gap-2 items-center">
            <span className="font-display text-[11px] text-[#f6e2b0] tracking-wide">Mode</span>
            {MODE_PRESETS.map((mode) => (
              <button
                key={`mode-${mode.id}`}
                onClick={() => applyMode(mode.id)}
                className={`px-3 py-1 border-2 rounded-md font-display text-[11px] tracking-wide ${
                  activeMode === mode.id
                    ? 'bg-[#a8683a] border-[#f2d58a] text-[#fff2c4] shadow-[inset_0_0_0_2px_rgba(0,0,0,0.25)]'
                    : 'bg-[#5a3a2a] border-[#b88d5e] text-[#f3e2b5] hover:bg-[#6a452f]'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 mb-2 text-xs text-gray-300">
          <div className="flex items-center gap-1">
            {[
              { id: 'brush', label: 'B', icon: '/ai-town/assets/ui/icons/brush.png' },
              { id: 'eraser', label: 'E', icon: '/ai-town/assets/ui/icons/eraser.png' },
              { id: 'eyedropper', label: 'I', icon: '/ai-town/assets/ui/icons/eyedropper.png' },
              { id: 'stamp', label: 'S', icon: '/ai-town/assets/ui/icons/stamp.png' },
              { id: 'object', label: 'O', icon: '/ai-town/assets/ui/icons/object.png' },
            ].map((tool) => (
              <button
                key={tool.id}
                onClick={() => {
                  if (tool.id === 'stamp') applyMode('prefabs');
                  else if (tool.id === 'object') applyMode('objects');
                  else activateTileTool(tool.id as any);
                }}
                className={`relative w-10 h-10 border-2 rounded active:translate-y-[2px] transition-transform ${
                  (tool.id === 'stamp' && activeMode === 'prefabs') ||
                  (tool.id === 'object' && activeMode === 'objects') ||
                  activeTool === tool.id
                    ? 'bg-[#f6e2b0] border-[#ffd93d] shadow-[0_0_10px_#ffd93d]'
                    : 'bg-[#8b6b4a] border-t-[#a88b6a] border-l-[#a88b6a] border-b-[#5a4030] border-r-[#5a4030] hover:bg-[#9c7a5b]'
                }`}
                title={`${tool.id.charAt(0).toUpperCase() + tool.id.slice(1)} (${tool.label})`}
              >
                <img
                  src={tool.icon}
                  alt={tool.id}
                  className="w-8 h-8 mx-auto rendering-pixelated"
                />
                <span className="absolute bottom-0 right-1 text-[10px] font-bold text-[#4a3728] shadow-white drop-shadow-[0_1px_0_rgba(255,255,255,0.5)]">
                  {tool.label}
                </span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 ml-2 bg-[#3b2a21] p-1 rounded border border-[#5a4030]">
            <span className="text-[#f6e2b0] text-[10px] uppercase font-bold px-1">Layer</span>
            <button
              onClick={() => setActiveLayerIndex(0)}
              className={`px-2 py-0.5 text-[10px] border-2 rounded ${
                activeLayerIndex === 0
                  ? 'bg-[#8b6b4a] border-[#ffd93d] text-[#fff2c4] shadow-[0_0_4px_#ffd93d]'
                  : 'bg-[#5a4030] border-[#6d4c30] text-[#a88b6a] hover:border-[#8b6b4a]'
              }`}
            >
              Base
            </button>
            <button
              onClick={() => setActiveLayerIndex(1)}
              className={`px-2 py-0.5 text-[10px] border-2 rounded ${
                activeLayerIndex === 1
                  ? 'bg-[#8b6b4a] border-[#ffd93d] text-[#fff2c4] shadow-[0_0_4px_#ffd93d]'
                  : 'bg-[#5a4030] border-[#6d4c30] text-[#a88b6a] hover:border-[#8b6b4a]'
              }`}
            >
              Overlay
            </button>
          </div>
          <div className="ml-auto text-[#f6e2b0]/60 text-[10px]">
            Map: {MAP_WIDTH}x{MAP_HEIGHT} tiles | Layers: {bgLayers.length} BG + 1 Collision
          </div>
        </div>
        <div className="mb-2 text-xs text-gray-500">
          {hoverInfo
            ? `X ${hoverInfo.col}  Y ${hoverInfo.row}  |  Tile ${hoverInfo.tileId}  |  Tile Layer ${
                hoverInfo.tileLayerIndex === 0
                  ? 'Base'
                  : hoverInfo.tileLayerIndex === 1
                  ? 'Overlay'
                  : 'None'
              }  |  Collision ${hoverInfo.collisionValue}  |  Active Layer ${
                activeLayerIndex === 0 ? 'Base' : 'Overlay'
              }  |  Tool ${activeToolLabel}`
            : `Hover a tile to inspect | Active Layer ${
                activeLayerIndex === 0 ? 'Base' : 'Overlay'
              } | Tool ${activeToolLabel} | Right click to erase/remove`}
        </div>
        <div
          className="relative inline-block"
          style={{ width: mapPixelWidth, height: mapPixelHeight }}
          onContextMenu={(event) => event.preventDefault()}
          onPointerLeave={() => setHoverInfo(null)}
        >
          <div
            className="absolute inset-0 bg-[#d4c4a0] border-2 border-[#8b6b4a] shadow-xl rounded"
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${MAP_WIDTH}, ${tileSize}px)`,
            }}
          >
            {/* Render each cell */}
            {Array.from({ length: MAP_HEIGHT }).map((_, rIndex) =>
              Array.from({ length: MAP_WIDTH }).map((_, cIndex) => {
                const hasTile = bgLayers.some((layer) => (layer[cIndex]?.[rIndex] ?? -1) >= 0);
                return (
                  <div
                    key={`${rIndex}-${cIndex}`}
                    onPointerDown={(event) => handlePointerDown(event, rIndex, cIndex)}
                    onPointerEnter={() => handlePointerEnter(rIndex, cIndex)}
                    className={`border hover:border-[#ffd93d] hover:shadow-[0_0_8px_rgba(255,217,61,0.5)] cursor-crosshair relative transition-all duration-75 ${
                      hasTile ? 'border-[#8b6b4a]/20' : 'border-[#8b6b4a]/40'
                    }`}
                    style={{
                      width: tileSize,
                      height: tileSize,
                    }}
                  >
                    {/* Render all BG layers in order */}
                    {bgLayers.map((layer, layerIndex) => {
                      const tileId = layer[cIndex]?.[rIndex] ?? -1;
                      if (tileId < 0 || !tilesetLoaded) return null;
                      const pos = getTilePos(tileId);
                      return (
                        <div
                          key={`layer-${layerIndex}`}
                          className="absolute inset-0"
                          style={{
                            backgroundImage: `url(${tilesetUrl})`,
                            backgroundPosition: `-${pos.sx}px -${pos.sy}px`,
                            backgroundSize: `${tilesetCols * tileSize}px ${tilesetRows * tileSize}px`,
                          }}
                        />
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>

          {placedObjectsSorted.length > 0 && (
            <div className="absolute inset-0 pointer-events-none">
              {placedObjectsSorted.map((placement) => {
                const objectDef = objectsById.get(placement.objectId);
                if (!objectDef) return null;
                const bounds = getObjectPixelBounds(objectDef, placement);
                const objectImageUrl = objectDef.imagePath ? resolveAssetPath(objectDef.imagePath) : tilesetUrl;
                const objectPixelWidth = objectDef.pixelWidth ?? objectDef.tileWidth * tileSize;
                const objectPixelHeight = objectDef.pixelHeight ?? objectDef.tileHeight * tileSize;
                const objectOffsetY =
                  objectDef.imagePath && objectDef.anchor === 'bottom-left'
                    ? Math.max(0, bounds.height - objectPixelHeight)
                    : 0;
                return (
                  <div
                    key={placement.id}
                    className="absolute"
                    style={{
                      left: bounds.left,
                      top: bounds.top,
                      width: bounds.width,
                      height: bounds.height,
                      backgroundImage: `url(${objectImageUrl})`,
                      backgroundPosition: objectDef.imagePath
                        ? `0px ${objectOffsetY}px`
                        : `-${objectDef.tileX * tileSize}px -${objectDef.tileY * tileSize}px`,
                      backgroundSize: objectDef.imagePath
                        ? `${objectPixelWidth}px ${objectPixelHeight}px`
                        : `${tilesetCols * tileSize}px ${tilesetRows * tileSize}px`,
                      backgroundRepeat: 'no-repeat',
                    }}
                  />
                );
              })}
            </div>
          )}

          {showAnimatedSprites && (
            <div className="absolute inset-0 pointer-events-none">
              <Stage
                width={mapPixelWidth}
                height={mapPixelHeight}
                options={{ backgroundAlpha: 0, antialias: false }}
              >
                <PixiAnimatedSpritesLayer sprites={animatedSprites} />
              </Stage>
            </div>
          )}

          {showCollision && (
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${MAP_WIDTH}, ${tileSize}px)`,
              }}
            >
              {Array.from({ length: MAP_HEIGHT }).map((_, rIndex) =>
                Array.from({ length: MAP_WIDTH }).map((_, cIndex) => {
                  const collisionValue = collisionLayer[cIndex]?.[rIndex] ?? -1;
                  const overlayClass =
                    collisionValue === COLLISION_WALKABLE
                      ? 'bg-green-500/30'
                      : collisionValue === COLLISION_BLOCKED
                      ? 'bg-red-500/30'
                      : collisionValue !== -1
                      ? 'bg-yellow-500/30'
                      : '';
                  return (
                    <div
                      key={`collision-${rIndex}-${cIndex}`}
                      className={overlayClass}
                      style={{ width: tileSize, height: tileSize }}
                    />
                  );
                })
              )}
            </div>
          )}
          {activeTool === 'stamp' && activeStamp && hoverInfo && transformedStampSize && tilesetLoaded && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: hoverInfo.col * tileSize,
                top: hoverInfo.row * tileSize,
                width: transformedStampSize.width * tileSize,
                height: transformedStampSize.height * tileSize,
                opacity: stampPreviewValid ? 0.7 : 0.4,
              }}
            >
              {stampPreviewTiles.map((tile, index) => {
                const pos = getTilePos(tile.tileId);
                return (
                  <div
                    key={`stamp-preview-${index}`}
                    className="absolute"
                    style={{
                      left: tile.x * tileSize,
                      top: tile.y * tileSize,
                      width: tileSize,
                      height: tileSize,
                      backgroundImage: `url(${tilesetUrl})`,
                      backgroundPosition: `-${pos.sx}px -${pos.sy}px`,
                      backgroundSize: `${tilesetCols * tileSize}px ${tilesetRows * tileSize}px`,
                    }}
                  />
                );
              })}
              <div
                className={`absolute inset-0 border-2 ${
                  stampPreviewValid ? 'border-cyan-300/70' : 'border-red-400/70'
                }`}
              />
            </div>
          )}
          {activeTool === 'object' && activeObject && hoverInfo && (tilesetLoaded || activeObject.imagePath) && objectPreviewBounds && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: objectPreviewBounds.left,
                top: objectPreviewBounds.top,
                width: objectPreviewBounds.width,
                height: objectPreviewBounds.height,
                opacity: objectPreviewValid ? 0.7 : 0.4,
              }}
            >
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage: `url(${activeObject.imagePath ? resolveAssetPath(activeObject.imagePath) : tilesetUrl})`,
                  backgroundPosition: activeObject.imagePath
                    ? `0px ${
                        activeObject.anchor === 'bottom-left'
                          ? Math.max(
                              0,
                              objectPreviewBounds.height -
                                (activeObject.pixelHeight ?? activeObject.tileHeight * tileSize),
                            )
                          : 0
                      }px`
                    : `-${activeObject.tileX * tileSize}px -${activeObject.tileY * tileSize}px`,
                  backgroundSize: activeObject.imagePath
                    ? `${(activeObject.pixelWidth ?? activeObject.tileWidth * tileSize)}px ${(
                        activeObject.pixelHeight ?? activeObject.tileHeight * tileSize
                      )}px`
                    : `${tilesetCols * tileSize}px ${tilesetRows * tileSize}px`,
                  backgroundRepeat: 'no-repeat',
                }}
              />
              <div
                className={`absolute inset-0 border-2 ${
                  objectPreviewValid ? 'border-emerald-300/70' : 'border-red-400/70'
                }`}
              />
            </div>
          )}
          {selectionBounds && (
            <div
              className="absolute pointer-events-none border-2 border-cyan-400/80 bg-cyan-400/10"
              style={{
                left: selectionBounds.minCol * tileSize,
                top: selectionBounds.minRow * tileSize,
                width: (selectionBounds.maxCol - selectionBounds.minCol + 1) * tileSize,
                height: (selectionBounds.maxRow - selectionBounds.minRow + 1) * tileSize,
              }}
            />
          )}
        </div>

        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-auto">
          <div className="flex flex-col items-center gap-1 px-4 py-2 border-4 border-[#6d4c30] bg-[#8b6b4a] rounded-lg shadow-[0_4px_0_#3b2a21,0_8px_10px_rgba(0,0,0,0.5)]">
            <div className="bg-[#3b2a21] px-3 py-0.5 rounded-full border border-[#5a4030] -mt-4 mb-1">
              <span className="font-display text-[10px] text-[#ffd93d] tracking-widest uppercase drop-shadow-[0_1px_0_rgba(0,0,0,1)]">
                {activeMode === 'objects' ? 'Objects' : 'Startups'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {activeMode === 'objects'
                ? quickbarObjectSlots.map((objectId, index) => {
                    const objectDef = objectId ? objectsById.get(objectId) : null;
                    const preview = objectDef ? getObjectPreviewData(objectDef) : null;
                    
                    if (!objectId || !preview) {
                      return (
                        <div
                          key={`quickbar-object-empty-${index}`}
                          className="relative w-10 h-10 border-2 border-[#5a4030] bg-[#3b2a21] shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)] rounded-sm"
                        >
                          <span className="absolute -top-2 left-0.5 text-[8px] text-[#a88b6a] font-bold">{index + 1}</span>
                        </div>
                      );
                    }
                    return (
                      <button
                        key={`quickbar-object-${objectId}`}
                        onClick={() => selectObjectId(objectId)}
                        className={`relative w-10 h-10 border-2 rounded-sm active:translate-y-[1px] transition-all ${
                          activeObjectId === objectId
                            ? 'border-[#ffd93d] bg-[#f6e2b0] shadow-[0_0_8px_#ffd93d]'
                            : 'border-[#6d4c30] bg-[#3b2a21] hover:border-[#8b6b4a]'
                        }`}
                      >
                         <span className="absolute -top-2 left-0.5 text-[8px] text-[#f6e2b0] font-bold shadow-black drop-shadow-[0_1px_0_rgba(0,0,0,0.8)] z-10">{index + 1}</span>
                        <div 
                          className="w-full h-full"
                          style={{
                            backgroundImage: `url(${preview.imageUrl})`,
                            backgroundPosition: preview.backgroundPosition,
                            backgroundSize: preview.backgroundSize,
                            backgroundRepeat: 'no-repeat',
                          }} 
                        />
                      </button>
                    );
                  })
                : quickbarTileSlots.map((tileId, index) => {
                    if (tileId === null || tileId === undefined) {
                      return (
                         <div
                          key={`quickbar-tile-empty-${index}`}
                          className="relative w-10 h-10 border-2 border-[#5a4030] bg-[#3b2a21] shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)] rounded-sm"
                        >
                          <span className="absolute -top-2 left-0.5 text-[8px] text-[#a88b6a] font-bold">{index + 1}</span>
                        </div>
                      );
                    }
                    const pos = getTilePos(tileId);
                    return (
                      <button
                        key={`quickbar-tile-${tileId}`}
                        onClick={() => selectTileId(tileId)}
                        className={`relative w-10 h-10 border-2 rounded-sm active:translate-y-[1px] transition-all ${
                          selectedTileId === tileId
                             ? 'border-[#ffd93d] bg-[#f6e2b0] shadow-[0_0_8px_#ffd93d]'
                            : 'border-[#6d4c30] bg-[#3b2a21] hover:border-[#8b6b4a]'
                        }`}
                      >
                        <span className="absolute -top-2 left-0.5 text-[8px] text-[#f6e2b0] font-bold shadow-black drop-shadow-[0_1px_0_rgba(0,0,0,0.8)] z-10">{index + 1}</span>
                        <div
                          className="w-full h-full rendering-pixelated"
                          style={{
                            backgroundImage: `url(${tilesetUrl})`,
                            backgroundPosition: `-${pos.sx}px -${pos.sy}px`,
                            backgroundSize: `${tilesetCols * tileSize}px ${tilesetRows * tileSize}px`,
                          }}
                        />
                      </button>
                    );
                  })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MapEditor;
