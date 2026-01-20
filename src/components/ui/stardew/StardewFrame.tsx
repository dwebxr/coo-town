import React from 'react';

interface StardewFrameProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  style?: React.CSSProperties;
}

const ASSET_PATH = '/ai-town/assets/ui/stardew/wood_frame_9slice.png';

export const StardewFrame: React.FC<StardewFrameProps> = ({ children, className = '', title, style }) => {
  return (
    <div
      className={`relative p-4 ${className}`}
      style={{
        border: '18px solid transparent', // Adjust width of the border slice
        borderImageSource: `url(${ASSET_PATH})`,
        borderImageSlice: '33% fill', // 9-slice: 1/3 cut usually works for these 3x3 grids
        borderImageRepeat: 'stretch',
        imageRendering: 'pixelated',
        ...style,
      }}
    >
      {title && (
        <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-[#aa6e3e] border-2 border-[#5a3821] px-3 py-1 rounded shadow-md z-10">
          <span className="text-[#ffe6b5] font-bold text-sm drop-shadow-[0_2px_0_rgba(0,0,0,0.5)] font-display uppercase tracking-widest">
            {title}
          </span>
        </div>
      )}
      <div className="relative z-0">
        {children}
      </div>
    </div>
  );
};
