import { useEffect } from 'react';

// Existing dialogs keep their own state and actions. This supplies keyboard behavior
// consistently, including dialogs stacked over a sale or customer form.
export function useDialogAccessibility() {
  useEffect(()=>{
    const selector='[role="dialog"][aria-modal="true"]';
    const focusable='button:not(:disabled),a[href],input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),iframe,[tabindex]:not([tabindex="-1"])';
    const visible=element=>element.getClientRects().length>0;
    const order=new Map();let sequence=0;let current=null;
    const overflow=document.body.style.overflow;
    function update(){
      const dialogs=[...document.querySelectorAll(selector)].filter(visible);
      for(const dialog of dialogs)if(!order.has(dialog))order.set(dialog,{index:++sequence,previous:document.activeElement});
      const next=dialogs.sort((a,b)=>order.get(a).index-order.get(b).index).at(-1)||null;
      if(next!==current){
        const previous=current;current=next;
        if(next){
          next.tabIndex=-1;
          if(!next.hasAttribute('aria-label')&&!next.hasAttribute('aria-labelledby')){const heading=next.querySelector('h2');if(heading){heading.id ||= `dialog-title-${order.get(next).index}`;next.setAttribute('aria-labelledby',heading.id);}}
          if(!next.contains(document.activeElement))(next.querySelector('[autofocus]')||next).focus({preventScroll:true});
        }else if(previous){const trigger=order.get(previous)?.previous;if(trigger?.isConnected)trigger.focus({preventScroll:true});}
      }
      document.body.style.overflow=dialogs.length?'hidden':overflow;
    }
    function keydown(event){
      if(!current)return;
      if(event.key==='Escape'){
        const close=current.querySelector('button[aria-label^="Fechar"]');
        if(close&&!close.disabled){event.preventDefault();event.stopPropagation();close.click();}
      }
      if(event.key==='Tab'){
        const targets=[...current.querySelectorAll(focusable)].filter(visible);
        const first=targets[0],last=targets.at(-1);
        if(!first){event.preventDefault();current.focus();}
        else if(event.shiftKey&&(document.activeElement===first||!targets.includes(document.activeElement))){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&(document.activeElement===last||!targets.includes(document.activeElement))){event.preventDefault();first.focus();}
      }
    }
    const observer=new MutationObserver(update);observer.observe(document.body,{subtree:true,childList:true});
    document.addEventListener('keydown',keydown,true);update();
    return()=>{observer.disconnect();document.removeEventListener('keydown',keydown,true);document.body.style.overflow=overflow;};
  },[]);
}
