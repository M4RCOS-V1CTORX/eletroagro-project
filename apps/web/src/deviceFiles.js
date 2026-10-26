import {getApiContext} from './apiClient.js';
import {deviceFile,saveDeviceFile} from './offlineStore.js';
export async function archivePdf(doc,name){if(typeof window==='undefined'||!getApiContext())return;return saveDeviceFile(getApiContext(),{id:name,name,mimeType:'application/pdf',blob:doc.output('blob'),kind:'pdf'});}
export async function savePdfToDevice(doc,name){await archivePdf(doc,name);doc.save(name);}
export async function storeAttachment(context,attachment){
  if(!attachment.content_data)return;const match=/^data:([^;,]+);base64,(.+)$/.exec(attachment.content_data);if(!match)return;const raw=atob(match[2]),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));await saveDeviceFile(context,{id:attachment.id,name:attachment.file_name,mimeType:attachment.mime_type,blob:new Blob([bytes],{type:attachment.mime_type}),kind:'attachment',serviceOrderId:attachment.service_order_id});
}
export async function openDeviceAttachment(id){const file=await deviceFile(getApiContext(),id);if(!file)throw new Error('Este arquivo ainda não foi armazenado no aparelho. Prepare o modo offline com internet.');const url=URL.createObjectURL(file.blob);window.open(url,'_blank','noopener,noreferrer');setTimeout(()=>URL.revokeObjectURL(url),60000);}
