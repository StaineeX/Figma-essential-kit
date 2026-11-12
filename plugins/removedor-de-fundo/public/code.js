let selectionRequest = 0;

async function sendSelection(includeBytes = false) {
  const node = figma.currentPage.selection[0];
  if (!node || typeof node.exportAsync !== 'function') {
    figma.ui.postMessage({ type: 'selection-available', available: false });
    return;
  }

  figma.ui.postMessage({ type: 'selection-available', available: true });
  if (!includeBytes) return;

  const requestId = ++selectionRequest;
  try {
    const bytes = await node.exportAsync({ format: 'PNG' });
    if (requestId !== selectionRequest) return;
    figma.ui.postMessage({ type: 'selection-image', bytes, name: `${node.name}.png` });
  } catch {
    figma.ui.postMessage({ type: 'selection-available', available: false });
  }
}

function insertImage(message) {
  const image = figma.createImage(new Uint8Array(message.bytes));
  const node = figma.createRectangle();
  node.name = message.name.replace(/\.[^/.]+$/, '') + ' · sem fundo';
  node.resize(message.width, message.height);
  node.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: 'FILL' }];
  node.x = figma.viewport.center.x - message.width / 2;
  node.y = figma.viewport.center.y - message.height / 2;
  figma.currentPage.appendChild(node);
  figma.currentPage.selection = [node];
  figma.viewport.scrollAndZoomIntoView([node]);
  figma.notify('Imagem sem fundo inserida.');
}

figma.on('selectionchange', () => sendSelection());
figma.ui.onmessage = (message) => {
  if (message.type === 'ui-ready') sendSelection();
  if (message.type === 'request-selection') sendSelection(true);
  if (message.type === 'insert-image') insertImage(message);
  if (message.type === 'close') figma.closePlugin();
};

figma.showUI(__html__.replace('content="standalone"', 'content="figma-plugin"'), {
  width: 380,
  height: 760,
  themeColors: true,
});

