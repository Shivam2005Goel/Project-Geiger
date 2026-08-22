'use client';

import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function AnimatedBackground() {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return (
    <div className="fixed inset-0 z-[-1] overflow-hidden bg-[#050505]">
      {/* Animated Grid */}
      <div 
        className="absolute inset-0 opacity-[0.15]"
        style={{
          backgroundImage: `
            linear-gradient(to right, #4f4f4f 1px, transparent 1px),
            linear-gradient(to bottom, #4f4f4f 1px, transparent 1px)
          `,
          backgroundSize: '4rem 4rem',
          maskImage: 'radial-gradient(ellipse 60% 60% at 50% 50%, #000 70%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 60% 60% at 50% 50%, #000 70%, transparent 100%)',
        }}
      />
      
      {/* Mouse Follow Glow */}
      <motion.div
        className="absolute w-[600px] h-[600px] rounded-full blur-[120px] pointer-events-none"
        animate={{
          x: mousePosition.x - 300,
          y: mousePosition.y - 300,
        }}
        transition={{
          type: 'tween',
          ease: 'easeOut',
          duration: 0.5
        }}
        style={{
          background: 'radial-gradient(circle, rgba(59,130,246,0.15) 0%, rgba(147,51,234,0.05) 50%, transparent 100%)'
        }}
      />

      {/* Floating Orbs */}
      <motion.div
        animate={{
          y: [0, -50, 0],
          x: [0, 30, 0],
          scale: [1, 1.1, 1],
        }}
        transition={{
          duration: 15,
          repeat: Infinity,
          ease: "easeInOut"
        }}
        className="absolute top-[20%] left-[20%] w-[400px] h-[400px] bg-blue-600/10 rounded-full blur-[100px]"
      />
      
      <motion.div
        animate={{
          y: [0, 60, 0],
          x: [0, -40, 0],
          scale: [1, 1.2, 1],
        }}
        transition={{
          duration: 20,
          repeat: Infinity,
          ease: "easeInOut"
        }}
        className="absolute bottom-[20%] right-[20%] w-[500px] h-[500px] bg-purple-600/10 rounded-full blur-[120px]"
      />
    </div>
  );
}
