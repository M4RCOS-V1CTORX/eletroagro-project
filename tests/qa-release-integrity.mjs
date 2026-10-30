import {readFile,readdir,stat,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const folder=new URL('../tmp/offline-20261030/',import.meta.url),root=new URL('release-final/',folder);
const assets=JSON.parse(await readFile(new URL('offline-assets.json',root),'utf8'));
for(const asset of assets){assert(asset.startsWith('/assets/'));assert((await stat(new URL(asset.slice(1),root))).isFile());}
const worker=await readFile(new URL('service-worker.js',root),'utf8');assert.match(worker,/eletroagro-shell-[a-f0-9]{16}/);
const files=['index.html','service-worker.js','offline-assets.json','manifest.webmanifest','favicon.svg','logo-eletroagro.jpeg',...(await readdir(new URL('assets/',root))).map(name=>'assets/'+name)];
const hashes={};
for(const file of files){const content=await readFile(new URL(file,root));if(file.endsWith('.js'))assert(!/globalThis\.__qa|qa-local|qa-user|isolated-auth-and-observability/.test(content.toString()),'QA code in release: '+file);hashes[file]=createHash('sha256').update(content).digest('hex');}
const result={result:'PASS',assets:assets.length,files:files.length,qaInstrumentationAbsent:true,workerCache:worker.match(/eletroagro-shell-[a-f0-9]{16}/)[0],sha256:hashes};
await writeFile(new URL('release-integrity.json',folder),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,sha256:'stored in release-integrity.json'},null,2));
