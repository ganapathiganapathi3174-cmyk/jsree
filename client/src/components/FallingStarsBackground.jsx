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
            : 'radial-gradient(900px 420px at 15% -10%, rgba(124, 58, 237, 0.10), transparent 65%), radial-gradient(700px 380px at 90% 0%, rgba(139, 92, 246, 0.08), transparent 60%), #F7F5FC',
        }}
      />
    </div>
  );
}