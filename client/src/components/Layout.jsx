import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import Sidebar from './Sidebar';
import Navbar from './Navbar';

export default function Layout({ children, isAdmin }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const { dark } = useTheme();

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className={`flex h-screen ${dark ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        isAdmin={isAdmin}
        currentPath={location.pathname}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Navbar
          onMenuToggle={() => setSidebarOpen((prev) => !prev)}
          isAdmin={isAdmin}
        />
        <main className={`flex-1 overflow-y-auto p-4 sm:p-6 ${dark ? 'bg-gray-900' : 'bg-gray-50'}`}>
          {children}
        </main>
      </div>
    </div>
  );
}
