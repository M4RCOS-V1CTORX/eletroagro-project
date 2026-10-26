import {useEffect,useRef} from 'react';
export function useSyncRefresh(callback){
  const latest=useRef(callback);latest.current=callback;
  useEffect(()=>{const refresh=()=>latest.current();window.addEventListener('eletroagro:offline-synced',refresh);window.addEventListener('eletroagro:offline-queue',refresh);return()=>{window.removeEventListener('eletroagro:offline-synced',refresh);window.removeEventListener('eletroagro:offline-queue',refresh);};},[]);
}
