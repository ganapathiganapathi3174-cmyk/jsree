import { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    if (saved !== null) {
      try {
        return JSON.parse(saved);
      } catch {
        /* fall through to default */
      }
    }
    // Default: dark — the product's identity theme.
    return true;
  });

  useEffect(() => {
    localStorage.setItem('darkMode', JSON.stringify(dark));
    if (dark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [dark]);

  const toggleDark = () => setDark((prev) => !prev);

  return (
    <ThemeContext.Provider value={{ dark, toggleDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  // Safe fallback if a component is ever rendered outside the provider.
  return ctx ?? { dark: true, toggleDark: () => {} };
};
