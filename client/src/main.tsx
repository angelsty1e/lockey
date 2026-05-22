import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { SetupGate } from './auth/SetupGate';
import { ToastProvider } from './components/Toast';
import { configureMotion } from './utils/motion';
import './styles.css';

configureMotion();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <SetupGate>
          <AuthProvider>
            <App />
          </AuthProvider>
        </SetupGate>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
