import { useTheme } from '../contexts/ThemeContext';
import { Moon, Sun } from 'lucide-react';

export default function ThemeToggle() {
  const { dark, toggleDark } = useTheme();

  return (
    <button
      onClick={toggleDark}
      className="btn btn-ghost btn-icon btn-sm"
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {dark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
