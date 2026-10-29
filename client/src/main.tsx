import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import './styles/index.css';
import App from './App';
import { queryClient } from './lib/query';
import { refreshSession } from './api/http';
import { useAuth } from './stores/auth';
import { ConfirmProvider, Toaster } from './components/ui';

// Au chargement : le cookie de refresh (HttpOnly) donne un nouveau jeton d'accès, gardé en mémoire uniquement.
void refreshSession().then((ok) => { if (!ok) useAuth.getState().clear(); });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ConfirmProvider>
          <App />
          <Toaster />
        </ConfirmProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
