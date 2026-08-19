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
            : 'radial-gradient(900px 420px at 15% -10%, rgba(37, 99, 235, 0.08), transparent 65%), radial-gradient(700px 380px at 90% 0%, rgba(2, 132, 199, 0.06), transparent 60%), #F6F8FC',
        }}
      />
    </div>
  );
}