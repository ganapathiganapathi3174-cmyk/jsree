import { useTheme } from '../contexts/ThemeContext';

export default function FallingStarsBackground() {
  const { dark } = useTheme();

  return (
    <div aria-hidden="true" className="fixed inset-0 z-0 overflow-hidden bg-surface pointer-events-none">
      <div
        className="absolute inset-0"
        style={{
          background: dark
            ? 'linear-gradient(180deg, #0f172a 0%, #1e293b 100%)'
            : 'radial-gradient(1000px 480px at 10% -10%, rgba(124, 58, 237, 0.20), transparent 65%), radial-gradient(800px 420px at 90% 0%, rgba(139, 92, 246, 0.18), transparent 60%), radial-gradient(1100px 550px at 50% 115%, rgba(167, 139, 250, 0.16), transparent 65%), #E9E4F7',
        }}
      />
    </div>
  );
}