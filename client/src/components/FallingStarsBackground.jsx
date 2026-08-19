import StarField from './StarField';
import ShootingStars from './ShootingStars';

export default function FallingStarsBackground() {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-0 overflow-hidden pointer-events-none"
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 20% 20%, rgba(59, 130, 246, 0.12), transparent 32%), radial-gradient(circle at 80% 10%, rgba(139, 92, 246, 0.10), transparent 32%), radial-gradient(circle at 50% 100%, rgba(30, 58, 138, 0.18), transparent 45%), linear-gradient(180deg, #020617 0%, #080D24 50%, #020617 100%)',
        }}
      />
      <StarField />
      <ShootingStars />
    </div>
  );
}
