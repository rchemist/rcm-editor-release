import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../../src/styles/tokens.css';
import '../../../../src/styles/editor.css';
import '../playground.css';
import { PrintPreviewApp } from './PrintPreviewApp';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <PrintPreviewApp />
    </StrictMode>,
  );
}
