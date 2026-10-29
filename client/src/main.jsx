import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            background: 'rgb(var(--surface))',
            color: 'rgb(var(--ink))',
            border: '1px solid rgb(var(--line) / 0.9)',
            borderRadius: '10px',
            fontSize: '14px',
            boxShadow: 'var(--shadow-elevation)',
          },
          success: { iconTheme: { primary: '#16A34A', secondary: 'rgb(var(--surface))' } },
          error: { iconTheme: { primary: '#DC2626', secondary: 'rgb(var(--surface))' } },
        }}
      />
    </BrowserRouter>
  </React.StrictMode>
);
