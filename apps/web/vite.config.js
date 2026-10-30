import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

export default defineConfig({
  plugins: [react(),{
    name:'offline-asset-manifest',
    generateBundle(_options,bundle){this.emitFile({type:'asset',fileName:'offline-assets.json',source:JSON.stringify(Object.keys(bundle).filter(name=>/\.(js|css|woff2?)$/.test(name)).map(name=>`/${name}`))});},
    writeBundle(options,bundle){
      const worker=readFileSync(new URL('./public/service-worker.js',import.meta.url),'utf8');
      const version=createHash('sha256').update(worker).update(JSON.stringify(Object.keys(bundle).sort())).digest('hex').slice(0,16);
      writeFileSync(resolve(options.dir,'service-worker.js'),worker.replace("'eletroagro-shell-v5'",`'eletroagro-shell-${version}'`));
    },
  }],
  server: { port: 5173 },
});
