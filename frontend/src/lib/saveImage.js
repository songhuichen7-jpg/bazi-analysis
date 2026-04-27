import html2canvas from 'html2canvas';

export function isMobileUserAgent(ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '')) {
  return /iPhone|iPad|iPod|Android/i.test(ua);
}

export async function renderCardToDataUrl(node) {
  const canvas = await html2canvas(node, {
    scale: 2,
    useCORS: true,
    backgroundColor: null,
    logging: false,
  });
  return canvas.toDataURL('image/png');
}

export function triggerDownload(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function showLongPressOverlay(dataUrl) {
  const overlay = document.createElement('div');
  overlay.className = 'save-overlay';
  overlay.innerHTML = `
    <div class="save-overlay-inner">
      <img src="${dataUrl}" alt="长按保存" />
      <p>长按图片保存到相册</p>
      <button type="button" class="close">关闭</button>
    </div>
  `;
  overlay.querySelector('.close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

export async function saveCardAsImage(node, { typeId, cosmicName, onTrack } = {}) {
  const dataUrl = await renderCardToDataUrl(node);
  if (isMobileUserAgent()) {
    showLongPressOverlay(dataUrl);
  } else {
    triggerDownload(dataUrl, `chabazi-${typeId || ''}-${cosmicName || ''}.png`);
  }
  if (onTrack) onTrack();
}
