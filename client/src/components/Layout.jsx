import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Navbar from './Navbar';

export default function Layout({ children, isAdmin }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setSidebarOpen(false);
    // Reset scroll position on navigation — a new page always starts at the top.
    const main = document.getElementById('main-scroll');
    if (main) main.scrollTop = 0;
  }, [location.pathname]);

  return (
    <div className="flex h-screen bg-canvas overflow-hidden">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        isAdmin={isAdmin}
        currentPath={location.pathname}
      />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Navbar onMenuToggle={() => setSidebarOpen((prev) => !prev)} isAdmin={isAdmin} />
        <main id="main-scroll" className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          <div className="max-w-shell mx-auto">{children}</div>
        </main>
      </div>
    </div>
  );
}
