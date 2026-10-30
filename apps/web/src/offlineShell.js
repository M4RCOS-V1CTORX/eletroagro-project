export async function ensureOfflineShell({timeout=20000}={}){
  if(!navigator.serviceWorker)throw new Error('Este navegador não oferece reabertura offline.');
  const registration=await navigator.serviceWorker.register('/service-worker.js');
  // Updates run independently; the handshake below only accepts a complete cache.
  registration.update().catch(()=>{});
  const deadline=Date.now()+timeout;
  const entry=document.querySelector('script[type="module"][src]')?.src;
  while(Date.now()<deadline){
    const worker=navigator.serviceWorker.controller;
    if(worker){
      const ready=await new Promise(resolve=>{
        const channel=new MessageChannel();
        const finish=value=>{clearTimeout(timer);channel.port1.close();channel.port2.close();resolve(value);};
        const timer=setTimeout(()=>finish(false),Math.min(1000,Math.max(1,deadline-Date.now())));
        channel.port1.onmessage=event=>finish(event.data?.ready===true);
        try{worker.postMessage({type:'VERIFY_OFFLINE_SHELL',entry},[channel.port2]);}catch{finish(false);}
      });
      if(ready)return;
    }
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Os arquivos do aplicativo ainda não estão prontos para reabrir offline. Mantenha a conexão, recarregue e prepare novamente.');
}
