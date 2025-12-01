import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  level: number; // 0 to 255 roughly
  color: string;
  label: string;
}

export const Visualizer: React.FC<VisualizerProps> = ({ level, color, label }) => {
  const bars = 5;
  // Normalize level 0-1
  const normalized = Math.min(1, level / 50); 
  
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="h-24 flex items-end gap-1">
        {Array.from({ length: bars }).map((_, i) => {
          // Add some randomness and height based on volume
          const height = Math.max(10, normalized * 100 * (0.8 + Math.random() * 0.4));
          return (
            <div
              key={i}
              className={`w-4 rounded-t-sm transition-all duration-75 ${color}`}
              style={{ 
                height: `${height}%`,
                opacity: normalized > 0.1 ? 1 : 0.3
              }}
            />
          );
        })}
      </div>
      <span className="text-xs font-mono uppercase tracking-widest text-gray-400">{label}</span>
    </div>
  );
};