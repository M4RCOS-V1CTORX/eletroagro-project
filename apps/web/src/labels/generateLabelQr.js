import qrcode from 'qrcode-generator';

export function createLabelQrPng(url) {
  const code = qrcode(0, 'M');
  code.addData(url, 'Byte');
  code.make();

  // Four blank modules on every edge keep the code readable by phone cameras.
  const margin = 4;
  const count = code.getModuleCount();
  const cellSize = Math.max(4, Math.floor(768 / (count + margin * 2)));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = (count + margin * 2) * cellSize;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Não foi possível gerar a imagem neste navegador.');

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000000';
  for (let row = 0; row < count; row++) {
    for (let column = 0; column < count; column++) {
      if (code.isDark(row, column)) {
        context.fillRect((column + margin) * cellSize, (row + margin) * cellSize, cellSize, cellSize);
      }
    }
  }
  return canvas.toDataURL('image/png');
}

export function downloadLabelQr(dataUrl, publicId) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = `origem-${publicId.slice(0, 12)}.png`;
  document.body.append(link);
  link.click();
  link.remove();
}
