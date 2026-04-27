import html2canvas from 'html2canvas';

// Spec: PM/specs/03_卡片与分享系统.md
//   1080×1440 (3:4 portrait, @2x) — best fit for 朋友圈
const TARGET_WIDTH = 1080;

export function isMobileUserAgent(ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '')) {
  return /iPhone|iPad|iPod|Android/i.test(ua);
}

export async function renderCardToDataUrl(node) {
  // Pin the export width to TARGET_WIDTH regardless of the on-screen size.
  // The card is laid out 3:4 (aspect-ratio in CSS), so 1080 wide → 1440 tall.
  const rect = node.getBoundingClientRect();
  const scale = rect.width > 0 ? TARGET_WIDTH / rect.width : 2;

  const canvas = await html2canvas(node, {
    scale,
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
    triggerDownload(dataUrl, `youshi-${typeId || ''}-${cosmicName || ''}.png`);
  }
  if (onTrack) onTrack();
}
