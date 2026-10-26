const signatures={
  'image/jpeg':bytes=>bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff,
  'image/png':bytes=>bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
  'image/webp':bytes=>bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP',
  'application/pdf':bytes=>bytes.subarray(0,5).toString()==='%PDF-',
};
export function validateAttachment(body){
  const size=Number(body.byteSize),match=typeof body.contentData==='string'&&/^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(body.contentData);
  if(!match||!signatures[body.mimeType]||match[1]!==body.mimeType||!Number.isInteger(size)||size<1||size>2097152||body.contentData.length>3000000)return false;
  const bytes=Buffer.from(match[2],'base64');
  return bytes.length===size&&bytes.toString('base64')===match[2]&&signatures[body.mimeType](bytes);
}
