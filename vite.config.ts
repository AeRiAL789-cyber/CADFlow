import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// pdfjs ships its worker as a separate ESM file; Vite resolves it via the
// `?url` import used in PdfConverter, so no special worker plugin is needed.
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // pdfjs-dist must not be pre-bundled in a way that strips the worker entry.
    include: ['pdfjs-dist'],
  },
  build: {
    target: 'es2020',
  },
});
