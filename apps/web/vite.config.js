import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react(),{
    name:'offline-asset-manifest',
    generateBundle(_options,bundle){this.emitFile({type:'asset',fileName:'offline-assets.json',source:JSON.stringify(Object.keys(bundle).filter(name=>/\.(js|css|woff2?)$/.test(name)).map(name=>`/${name}`))});},
  }],
  server: { port: 5173 },
});
