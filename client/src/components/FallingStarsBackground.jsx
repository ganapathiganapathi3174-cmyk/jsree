import { useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';

function getStarCount() {
  if (typeof window === 'undefined') return 28;
  const isMobile = window.innerWidth < 768;
  if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return isMobile ? 12 : 22;
  }
  return isMobile ? 16 : 30;
}

export default function FallingStarsBackground() {
  const { dark } = useTheme();

  const stars = useMemo(() => {
    const count = getStarCount();
    return Array.from({ length: count }, (_, i) => {
      const shooting = i < Math.ceil(count / 6);
      return {
        id: i,
        left: Math.random() * 100,
        top: Math.random() * 100,
        size: shooting ? 2.5 : 1 + Math.random() * 2.4,
        duration: shooting ? 7 + Math.random() * 5 : 14 + Math.random() * 18,
        delay: Math.random() * -22,
        opacity: shooting ? 0.9 : 0.25 + Math.random() * 0.55,
        twinkle: 2.5 + Math.random() * 3.5,
        isShooting: shooting,
      };
    });
  }, []);

  const isReduced = useMemo(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  );

  return (
    <div className="jsree-sky" aria-hidden="true">
      {!isReduced && (
        <div className="jsree-sky-glow" />
      )}
      <div className={`jsree-sky-stars ${isReduced ? 'jsree-reduced' : ''}`}>
        {stars.map((s) =>
          s.isShooting ? (
            <span
              key={s.id}
              className="jsree-shooting-star"
              style={{
                left: `${s.left}%`,
                top: `${s.top}%`,
                animationDuration: `${s.duration}s`,
                animationDelay: `${s.delay}s`,
                opacity: s.opacity,
              }}
            />
          ) : (
            <span
              key={s.id}
              className="jsree-star"
              style={{
                left: `${s.left}%`,
                top: `${s.top}%`,
                width: `${s.size}px`,
                height: `${s.size}px`,
                animationDuration: `${s.twinkle}s`,
                animationDelay: `${s.delay}s`,
                opacity: s.opacity,
              }}
            />
          )
        )}
      </div>
      {dark && <div className="jsree-sky-vignette" />}
    </div>
  );
}
