import { useMemo } from 'react';

const STAR_COUNT = 80;

function rand(min, max) {
  return min + Math.random() * (max - min);
}

export default function StarField() {
  const stars = useMemo(
    () =>
      Array.from({ length: STAR_COUNT }).map((_, i) => ({
        id: i,
        left: rand(0, 100),
        top: rand(0, 100),
        size: rand(1, 2.6),
        duration: rand(2.8, 6.5),
        delay: rand(0, 6),
      })),
    []
  );

  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
      {stars.map((s) => (
        <span
          key={s.id}
          className="star"
          style={{
            left: `${s.left}%`,
            top: `${s.top}%`,
            width: `${s.size}px`,
            height: `${s.size}px`,
            opacity: 0.4,
            animationDuration: `${s.duration}s`,
            animationDelay: `-${s.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
