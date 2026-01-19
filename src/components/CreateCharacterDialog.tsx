import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import ReactModal from 'react-modal';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';

const modalStyles = {
  overlay: {
    backgroundColor: 'rgb(0, 0, 0, 75%)',
    zIndex: 12,
  },
  content: {
    top: '50%',
    left: '50%',
    right: 'auto',
    bottom: 'auto',
    marginRight: '-50%',
    transform: 'translate(-50%, -50%)',
    maxWidth: '50%',
    border: '10px solid rgb(23, 20, 33)',
    borderRadius: '0',
    background: 'rgb(35, 38, 58)',
    color: 'white',
    fontFamily: '"Upheaval Pro", "sans-serif"',
  },
};

const REQUIRED_WIDTH = 96;
const REQUIRED_HEIGHT = 128;
const FRAME_WIDTH = 32;
const FRAME_HEIGHT = 32;
const FRAMES_PER_DIRECTION = 3;
const DIRECTIONS = 4;

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export default function CreateCharacterDialog({ isOpen, onClose }: Props) {
  const [displayName, setDisplayName] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const generateUploadUrl = useMutation(api.characterSprites.generateUploadUrl);
  const createSprite = useMutation(api.characterSprites.create);
  const removeSprite = useMutation(api.characterSprites.remove);
  const mySprites = useQuery(api.characterSprites.listMine) ?? [];

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      setDimensions(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    const img = new Image();
    img.onload = () => {
      setDimensions({ width: img.width, height: img.height });
    };
    img.onerror = () => {
      setFileError('Failed to load image.');
      setDimensions(null);
    };
    img.src = objectUrl;
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  const sizeError = useMemo(() => {
    if (!dimensions) return null;
    if (dimensions.width !== REQUIRED_WIDTH || dimensions.height !== REQUIRED_HEIGHT) {
      return `Expected ${REQUIRED_WIDTH}x${REQUIRED_HEIGHT}px PNG.`;
    }
    return null;
  }, [dimensions]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null;
    setFileError(null);
    if (nextFile && nextFile.type !== 'image/png') {
      setFileError('Only PNG files are supported.');
      setFile(null);
      return;
    }
    setFile(nextFile);
  };

  const handleUpload = async () => {
    if (!file) {
      setFileError('Choose a PNG sprite sheet first.');
      return;
    }
    if (file.type !== 'image/png') {
      setFileError('Only PNG files are supported.');
      return;
    }
    if (sizeError) {
      setFileError(sizeError);
      return;
    }
    setIsUploading(true);
    try {
      const uploadUrl = await generateUploadUrl();
      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!uploadResponse.ok) {
        throw new Error('Upload failed.');
      }
      const { storageId } = await uploadResponse.json();
      await createSprite({
        storageId,
        displayName: displayName.trim() || 'Custom Sprite',
        frameWidth: FRAME_WIDTH,
        frameHeight: FRAME_HEIGHT,
        framesPerDirection: FRAMES_PER_DIRECTION,
        directions: DIRECTIONS,
      });
      setDisplayName('');
      setFile(null);
      setFileError(null);
    } catch (error: any) {
      setFileError(error?.message ?? 'Failed to upload sprite.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemove = async (spriteId: string) => {
    await removeSprite({ spriteId });
  };

  return (
    <ReactModal
      isOpen={isOpen}
      onRequestClose={onClose}
      style={modalStyles}
      contentLabel="Create Character"
      ariaHideApp={false}
    >
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-6">
          <h2 className="text-3xl font-display">Create Character</h2>
          <button
            onClick={onClose}
            className="border border-white/30 px-3 py-1 text-xs hover:border-white"
          >
            Close
          </button>
        </div>
        <div className="space-y-2 text-sm text-white/80">
          <p>Upload a 96x128 PNG sprite sheet (3 frames × 4 directions).</p>
          <p>Sprites are private to your account but render across worlds.</p>
        </div>
        <div className="space-y-3">
          <label className="text-xs text-white/70">Display name</label>
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="My Adventurer"
            className="w-full bg-gray-900 border border-gray-700 px-3 py-2 text-sm"
          />
          <label className="text-xs text-white/70">Sprite sheet (PNG)</label>
          <input
            type="file"
            accept="image/png"
            onChange={handleFileChange}
            className="block w-full text-sm text-white/70"
          />
          {(fileError || sizeError) && (
            <p className="text-xs text-red-300">{fileError ?? sizeError}</p>
          )}
          {previewUrl && (
            <div className="flex items-start gap-4">
              <img
                src={previewUrl}
                alt="Sprite preview"
                className="border border-white/20"
                style={{ width: REQUIRED_WIDTH * 2, height: REQUIRED_HEIGHT * 2, imageRendering: 'pixelated' }}
              />
              <div className="text-xs text-white/60 space-y-1">
                <p>Size: {dimensions?.width ?? '?'}x{dimensions?.height ?? '?'}</p>
                <p>Frame: {FRAME_WIDTH}x{FRAME_HEIGHT}</p>
                <p>Layout: {FRAMES_PER_DIRECTION}x{DIRECTIONS}</p>
              </div>
            </div>
          )}
          <button
            onClick={handleUpload}
            disabled={isUploading}
            className="bg-emerald-500/80 hover:bg-emerald-500 px-4 py-2 text-sm font-bold border border-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isUploading ? 'Uploading...' : 'Save Character'}
          </button>
        </div>
        <div className="border-t border-white/10 pt-4">
          <h3 className="text-xl font-display mb-2">Your Characters</h3>
          {mySprites.length === 0 ? (
            <p className="text-sm text-white/60">No custom characters yet.</p>
          ) : (
            <div className="space-y-2">
              {mySprites.map((sprite) => (
                <div key={sprite.spriteId} className="flex items-center gap-3">
                  <div
                    className="border border-white/20"
                    style={{
                      width: 32,
                      height: 32,
                      backgroundImage: sprite.textureUrl ? `url(${sprite.textureUrl})` : undefined,
                      backgroundPosition: '0px 0px',
                      backgroundSize: `${FRAME_WIDTH * FRAMES_PER_DIRECTION}px ${FRAME_HEIGHT * DIRECTIONS}px`,
                      imageRendering: 'pixelated',
                    }}
                  />
                  <div className="flex-1">
                    <p className="text-sm text-white">{sprite.displayName}</p>
                    <p className="text-xs text-white/50">{sprite.spriteId}</p>
                  </div>
                  <button
                    onClick={() => handleRemove(sprite.spriteId)}
                    className="border border-white/20 px-3 py-1 text-xs hover:border-white"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </ReactModal>
  );
}
