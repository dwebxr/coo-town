import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { DEFAULT_NAME } from './constants';

const resolveOwnerId = async (ctx: { auth: { getUserIdentity: () => Promise<{ tokenIdentifier?: string } | null> } }) => {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.tokenIdentifier ?? DEFAULT_NAME;
};

const buildSpriteResponse = async (
  ctx: { storage: { getUrl: (storageId: string) => Promise<string | null> } },
  sprite: {
    spriteId: string;
    displayName: string;
    storageId: string;
    frameWidth: number;
    frameHeight: number;
    framesPerDirection: number;
    directions: number;
    isCustom: boolean;
    ownerId: string;
    createdAt: number;
  },
) => {
  const textureUrl = await ctx.storage.getUrl(sprite.storageId);
  return {
    ...sprite,
    textureUrl,
  };
};

const createSpriteId = () => `custom_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export const generateUploadUrl = mutation({
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const list = query({
  handler: async (ctx) => {
    const sprites = await ctx.db.query('characterSprites').collect();
    return await Promise.all(sprites.map((sprite) => buildSpriteResponse(ctx, sprite)));
  },
});

export const listMine = query({
  handler: async (ctx) => {
    const ownerId = await resolveOwnerId(ctx);
    const sprites = await ctx.db
      .query('characterSprites')
      .withIndex('ownerId', (q) => q.eq('ownerId', ownerId))
      .collect();
    return await Promise.all(sprites.map((sprite) => buildSpriteResponse(ctx, sprite)));
  },
});

export const create = mutation({
  args: {
    storageId: v.string(),
    displayName: v.string(),
    frameWidth: v.number(),
    frameHeight: v.number(),
    framesPerDirection: v.number(),
    directions: v.number(),
  },
  handler: async (ctx, args) => {
    const ownerId = await resolveOwnerId(ctx);
    const displayName = args.displayName.trim() || 'Custom Sprite';
    if (args.frameWidth !== 32 || args.frameHeight !== 32) {
      throw new Error('Only 32x32 frame sprites are supported right now.');
    }
    if (args.framesPerDirection !== 3 || args.directions !== 4) {
      throw new Error('Only 3x4 sprite sheets are supported right now.');
    }
    const url = await ctx.storage.getUrl(args.storageId);
    if (!url) {
      throw new Error('Invalid storage ID.');
    }
    const spriteId = createSpriteId();
    await ctx.db.insert('characterSprites', {
      spriteId,
      displayName,
      storageId: args.storageId,
      frameWidth: args.frameWidth,
      frameHeight: args.frameHeight,
      framesPerDirection: args.framesPerDirection,
      directions: args.directions,
      isCustom: true,
      ownerId,
      createdAt: Date.now(),
    });
    return { spriteId };
  },
});

export const remove = mutation({
  args: {
    spriteId: v.string(),
  },
  handler: async (ctx, args) => {
    const ownerId = await resolveOwnerId(ctx);
    const sprite = await ctx.db
      .query('characterSprites')
      .withIndex('spriteId', (q) => q.eq('spriteId', args.spriteId))
      .unique();
    if (!sprite) {
      return;
    }
    if (sprite.ownerId !== ownerId) {
      throw new Error('Not authorized to delete this sprite.');
    }
    await ctx.storage.delete(sprite.storageId);
    await ctx.db.delete(sprite._id);
  },
});
