figma.showUI(__html__, { width: 360, height: 430, themeColors: true });

var PX_PER_CM = 96 / 2.54;

function toPx(value, unit) {
  value = Number(value);
  if (!isFinite(value) || value <= 0) throw new Error('As medidas devem ser maiores que zero.');
  if (unit === 'm') return value * 100 * PX_PER_CM;
  if (unit === 'cm') return value * PX_PER_CM;
  return value;
}

function addText(parent, characters, x, y, size) {
  var font = { family: 'Inter', style: 'Regular' };
  var text = figma.createText();
  text.fontName = font;
  text.fontSize = size || 12;
  text.characters = characters;
  text.x = x;
  text.y = y;
  parent.appendChild(text);
  return text;
}

function addGuideBar(parent, name, x, y, width, height, color) {
  var bar = figma.createRectangle();
  bar.name = name;
  bar.x = x; bar.y = y; bar.resize(Math.max(1, width), Math.max(1, height));
  bar.fills = [{ type: 'SOLID', color: color, opacity: 0.75 }];
  parent.appendChild(bar);
  return bar;
}

async function createPlan(data) {
  var width = toPx(data.width, data.unit);
  var height = toPx(data.height, data.unit);
  // The UI receives the total margin; split it between both sides.
  var margin = toPx(data.marginCm, 'cm') / 2;
  var folds = Math.max(0, Math.floor(Number(data.folds) || 0));
  var panels = folds + 1;
  var totalWidth = width;
  var totalHeight = height;
  var usableWidth = totalWidth - margin * 2;
  if (usableWidth <= 0 || totalHeight - margin * 2 <= 0) throw new Error('A margem precisa caber dentro da prancheta.');
  var panelWidth = usableWidth / panels;
  var frame = figma.createFrame();
  frame.name = data.name || 'FIGAI Prancheta';
  frame.resize(totalWidth, totalHeight);
  frame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];

  // Text nodes require an explicit font load in the Figma Plugin API.
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });

  var guideGroup = figma.createFrame();
  guideGroup.name = 'Guias — bloqueadas';
  guideGroup.x = 0; guideGroup.y = 0; guideGroup.resize(totalWidth, totalHeight);
  guideGroup.fills = [];
  guideGroup.clipsContent = false;
  frame.appendChild(guideGroup);
  var guideColor = { r: 0.1, g: 0.45, b: 0.9 };
  addGuideBar(guideGroup, 'Margem superior', margin, margin - 0.5, totalWidth - margin * 2, 1, guideColor);
  addGuideBar(guideGroup, 'Margem inferior', margin, totalHeight - margin - 0.5, totalWidth - margin * 2, 1, guideColor);
  addGuideBar(guideGroup, 'Margem esquerda', margin - 0.5, margin, 1, totalHeight - margin * 2, guideColor);
  addGuideBar(guideGroup, 'Margem direita', totalWidth - margin - 0.5, margin, 1, totalHeight - margin * 2, guideColor);

  for (var i = 1; i < panels; i++) {
    addGuideBar(guideGroup, 'Dobra ' + i, margin + panelWidth * i - 0.5, 0, 1, totalHeight, { r: 0.9, g: 0.25, b: 0.1 });
  }

  guideGroup.locked = true;

  addText(frame, 'FIGAI Pranchetas • ' + data.name + ' • ' + panels + ' painel(is)', margin, totalHeight - margin + 8, 10);
  figma.currentPage.selection = [frame];
  figma.viewport.scrollAndZoomIntoView([frame]);
  return { width: totalWidth, height: totalHeight, panels: panels };
}

figma.ui.onmessage = async function (message) {
  if (message.type === 'cancel') { figma.closePlugin(); return; }
  if (message.type !== 'create') return;
  try {
    var result = await createPlan(message.data);
    figma.notify('Prancheta criada: ' + Math.round(result.width) + ' × ' + Math.round(result.height) + ' px');
  } catch (error) {
    figma.ui.postMessage({ type: 'error', message: error.message });
  }
};
