import StarField from './StarField';
import ShootingStars from './ShootingStars';

// Decorative star field for public/landing pages only.
// The gradient backdrop comes from the `.landing-bg` class so it adapts
// to the active theme; this layer only adds the stars.
export default function FallingStarsBackground() {
  return (
    <div aria-hidden="true" className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
      <StarField />
      <ShootingStars />
    </div>
  );
}
