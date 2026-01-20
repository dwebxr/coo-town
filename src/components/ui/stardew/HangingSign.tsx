import React from 'react';

interface HangingSignProps {
  text?: string;
  className?: string;
  scale?: number;
}

const SIGN_ASSET = '/ai-town/assets/ui/stardew/hanging_sign.png';

export const HangingSign: React.FC<HangingSignProps> = ({ text = "TILES", className = '', scale = 1 }) => {
  return (
    <div 
      className={`relative inline-block ${className}`}
      style={{
        width: '180px', // Approximate width based on asset aspect ratio
        height: '90px',
        backgroundImage: `url(${SIGN_ASSET})`,
        backgroundSize: 'contain',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
        transform: `scale(${scale})`,
        transformOrigin: 'top center',
        zIndex: 20
      }}
    >
      <div className="absolute inset-0 flex items-center justify-center pt-4">
        <span 
          className="font-display font-bold text-[#3e2723] text-xl tracking-widest uppercase drop-shadow-[0_1px_0_rgba(255,255,255,0.3)]"
          style={{ fontFamily: '"Press Start 2P", cursive, sans-serif' }} // Fallback font
        >
          {text}
        </span>
      </div>
    </div>
  );
};
