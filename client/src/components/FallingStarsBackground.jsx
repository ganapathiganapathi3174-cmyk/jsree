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
            : 'radial-gradient(900px 420px at 12% -10%, rgba(124, 58, 237, 0.16), transparent 65%), radial-gradient(700px 380px at 92% 0%, rgba(139, 92, 246, 0.13), transparent 60%), radial-gradient(1000px 500px at 50% 115%, rgba(167, 139, 250, 0.12), transparent 65%), #F1EEF9',
        }}
      />
    </div>
  );
}