import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { armGLProbe } from './glProbe.js';
import './styles.css';

// Patched before anything creates a context, so no blit escapes the count.
armGLProbe();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
