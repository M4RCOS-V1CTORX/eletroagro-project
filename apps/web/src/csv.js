export function csvCell(value){let text=String(value??'');if(/^[\s\u0000-\u001f]*[=+\-@]/.test(text)&&!/^\s*-?\d+(?:[.,]\d+)?\s*$/.test(text))text="'"+text;return`"${text.replaceAll('"','""')}"`;}
export const csvRows=rows=>'\ufeff'+rows.map(row=>row.map(csvCell).join(';')).join('\r\n');
