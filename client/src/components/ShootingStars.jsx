import { useMemo } from 'react';

const SHOOTING_STAR_COUNT = 7;

function rand(min, max) {
  return min + Math.random() * (max - min);
}

export default function ShootingStars() {
  const stars = useMemo(
    () =>
      Array.from({ length: SHOOTING_STAR_COUNT }).map((_, i) => ({
        id: i,
        left: rand(55, 100),
        top: rand(0, 45),
        duration: rand(2.5, 4.5),
        delay: rand(5, 24),
      })),
    []
  );

  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
      {stars.map((s) => (
        <div
          key={s.id}
          className="shooting-star"
          style={{
            left: `${s.left}%`,
            top: `${s.top}%`,
            animationDuration: `${s.duration}s`,
            animationDelay: `${s.delay}s`,
          }}
        >
          <span className="star-head" />
        </div>
      ))}
    </div>
  );
}
