figma.showUI(__html__, { width: 360, height: 480, themeColors: true });

var PX_PER_CM = 96 / 2.54;
var GUIDES_NAME = 'Guias — bloqueadas';

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

function addGuideBox(parent, name, x, y, width, height, color) {
  addGuideBar(parent, name + ' superior', x, y - 0.5, width, 1, color);
  addGuideBar(parent, name + ' inferior', x, y + height - 0.5, width, 1, color);
  addGuideBar(parent, name + ' esquerda', x - 0.5, y, 1, height, color);
  addGuideBar(parent, name + ' direita', x + width - 0.5, y, 1, height, color);
}

async function createPlan(data) {
  // Medida digitada = tamanho final (corte). A prancheta ganha a sangria em volta.
  var width = toPx(data.width, data.unit);
  var height = toPx(data.height, data.unit);
  var bleedMm = Number(data.bleedMm);
  if (!isFinite(bleedMm) || bleedMm < 0) throw new Error('A sangria precisa ser zero ou maior.');
  var bleed = bleedMm / 10 * PX_PER_CM;
  // The UI receives the total margin; split it between both sides.
  var margin = toPx(data.marginCm, 'cm') / 2;
  var folds = Math.max(0, Math.floor(Number(data.folds) || 0));
  var panels = folds + 1;
  if (width - margin * 2 <= 0 || height - margin * 2 <= 0) throw new Error('A margem precisa caber dentro da prancheta.');
  var panelWidth = (width - margin * 2) / panels;
  var totalWidth = width + bleed * 2;
  var totalHeight = height + bleed * 2;

  var frame = figma.createFrame();
  frame.name = data.name || 'FIGAI Prancheta';
  frame.resize(totalWidth, totalHeight);
  frame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];

  // Text nodes require an explicit font load in the Figma Plugin API.
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });

  var guideGroup = figma.createFrame();
  guideGroup.name = GUIDES_NAME;
  guideGroup.x = 0; guideGroup.y = 0; guideGroup.resize(totalWidth, totalHeight);
  guideGroup.fills = [];
  guideGroup.clipsContent = false;
  frame.appendChild(guideGroup);
  if (bleed > 0) addGuideBox(guideGroup, 'Sangria', 0.5, 0.5, totalWidth - 1, totalHeight - 1, { r: 0.92, g: 0.22, b: 0.31 });
  addGuideBox(guideGroup, 'Corte', bleed, bleed, width, height, { r: 0.02, g: 0.55, b: 0.99 });
  addGuideBox(guideGroup, 'Margem', bleed + margin, bleed + margin, width - margin * 2, height - margin * 2, { r: 0.1, g: 0.45, b: 0.9 });

  for (var i = 1; i < panels; i++) {
    addGuideBar(guideGroup, 'Dobra ' + i, bleed + margin + panelWidth * i - 0.5, 0, 1, totalHeight, { r: 0.9, g: 0.25, b: 0.1 });
  }

  // Legenda fica dentro das guias: some na exportação junto com elas.
  addText(guideGroup, 'FIGAI Pranchetas • ' + data.name + ' • ' + panels + ' painel(is)', bleed + margin, bleed + height - margin + 8, 10);
  guideGroup.locked = true;

  // "API" printkit: o Print Exporter Pro lê o corte, esconde as guias e põe as marcas.
  frame.setSharedPluginData('printkit', 'sheet', JSON.stringify({
    version: 1,
    source: 'figai-pranchetas',
    ppi: 96,
    trim: { x: bleed, y: bleed, width: width, height: height },
    bleed: { top: bleed, right: bleed, bottom: bleed, left: bleed },
    slug: 0,
    guides: GUIDES_NAME,
  }));

  figma.currentPage.selection = [frame];
  figma.viewport.scrollAndZoomIntoView([frame]);
  return { width: width, height: height, panels: panels, bleedMm: bleedMm };
}

figma.ui.onmessage = async function (message) {
  if (message.type === 'cancel') { figma.closePlugin(); return; }
  if (message.type !== 'create') return;
  try {
    var result = await createPlan(message.data);
    figma.notify('Prancheta criada: ' + Math.round(result.width) + ' × ' + Math.round(result.height) + ' px + ' + result.bleedMm + ' mm de sangria');
  } catch (error) {
    figma.ui.postMessage({ type: 'error', message: error.message });
  }
};
