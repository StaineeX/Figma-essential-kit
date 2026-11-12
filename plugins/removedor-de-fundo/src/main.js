import { removeBackground } from '@imgly/background-removal';

import { formatFileSize, refineAlpha } from './image-utils.mjs';
import './styles.css';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  dropzone: $('#dropzone'),
  chooseButton: $('#choose-button'),
  fileInput: $('#file-input'),
  closeButton: $('#close-button'),
  selectionButton: $('#selection-button'),
  resetButton: $('#reset-button'),
  insertButton: $('#insert-button'),
  exportButton: $('#export-button'),
  previewCard: $('#preview-card'),
  previewEmpty: $('#preview-empty'),
  previewContent: $('#preview-content'),
  originalImage: $('#original-image'),
  resultImage: $('#result-image'),
  comparisonView: $('#comparison-view'),
  comparisonResult: $('#comparison-result'),
  resultBackdrop: $('#result-backdrop'),
  splitRange: $('#split-range'),
  fileName: $('#file-name'),
  fileMeta: $('#file-meta'),
  previewStatus: $('#preview-status'),
  statusMessage: $('#status-message'),
  edgeRange: $('#edge-range'),
  edgeValue: $('#edge-value'),
  customColor: $('#custom-color'),
  customSwatch: $('#custom-swatch'),
  colorPickerRow: $('#color-picker-row'),
};

const state = {
  sourceFile: null,
  sourceUrl: null,
  originalBlobUrl: null,
  resultBlob: null,
  resultUrl: null,
  processedUrl: null,
  processedCanvas: null,
  background: 'transparent',
  customColor: elements.customColor.value,
  refinement: 0,
  renderToken: 0,
  jobId: 0,
  pluginMode: document.querySelector('meta[name="remove-bg-runtime"]')?.content === 'figma-plugin',
};

function setStatus(message, tone = 'neutral') {
  elements.statusMessage.textContent = message;
  elements.statusMessage.dataset.tone = tone;
  elements.previewStatus.textContent = message;
}

function setBusy(isBusy) {
  elements.chooseButton.disabled = isBusy;
  elements.fileInput.disabled = isBusy;
  elements.edgeRange.disabled = isBusy || !state.resultBlob;
  elements.exportButton.disabled = isBusy || !state.processedCanvas;
  elements.insertButton.disabled = isBusy || !state.processedCanvas || !state.pluginMode;
  elements.previewCard.classList.toggle('is-processing', isBusy);
}

function revokeUrl(key) {
  if (state[key]) {
    URL.revokeObjectURL(state[key]);
    state[key] = null;
  }
}

function resetResult() {
  revokeUrl('resultUrl');
  revokeUrl('processedUrl');
  state.resultBlob = null;
  state.processedCanvas = null;
  elements.resultImage.removeAttribute('src');
  elements.edgeRange.disabled = true;
  elements.exportButton.disabled = true;
  elements.insertButton.disabled = true;
  elements.comparisonResult.classList.remove('has-result');
}

function clearImage() {
  state.jobId += 1;
  revokeUrl('sourceUrl');
  revokeUrl('originalBlobUrl');
  resetResult();
  state.sourceFile = null;
  elements.fileInput.value = '';
  elements.previewEmpty.hidden = false;
  elements.previewContent.hidden = true;
  elements.previewCard.classList.remove('has-image', 'is-processing');
  elements.fileName.textContent = 'Nenhuma imagem';
  elements.fileMeta.textContent = '—';
  setStatus('Escolha uma imagem para começar.');
  setBusy(false);
}

function imageFile(file) {
  return Boolean(file && file.type.startsWith('image/'));
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Não foi possível ler esta imagem.'));
    image.src = url;
  });
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Falha ao gerar a prévia PNG.'))), 'image/png');
  });
}

async function renderProcessedPreview() {
  if (!state.resultBlob) return;
  const token = ++state.renderToken;
  const image = await loadImage(state.resultUrl);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const refined = refineAlpha(context.getImageData(0, 0, canvas.width, canvas.height), state.refinement);
  const refinedImageData = context.createImageData(canvas.width, canvas.height);
  refinedImageData.data.set(refined.data);
  context.putImageData(refinedImageData, 0, 0);
  const blob = await canvasBlob(canvas);
  if (token !== state.renderToken) return;

  revokeUrl('processedUrl');
  state.processedCanvas = canvas;
  state.processedUrl = URL.createObjectURL(blob);
  elements.resultImage.src = state.processedUrl;
  elements.comparisonResult.classList.add('has-result');
  elements.exportButton.disabled = false;
  elements.insertButton.disabled = !state.pluginMode;
}

function sendToFigma(message) {
  if (state.pluginMode) window.parent.postMessage({ pluginMessage: message }, '*');
}

function updatePreviewBackground() {
  const color = state.background === 'custom' ? state.customColor : state.background === 'white' ? '#ffffff' : 'transparent';
  elements.resultBackdrop.style.background = color;
  elements.customSwatch.style.background = state.customColor;
  elements.colorPickerRow.hidden = state.background !== 'custom';
}

async function runBackgroundRemoval(file, jobId) {
  setBusy(true);
  setStatus('Preparando o motor local…', 'processing');
  resetResult();

  try {
    const resultBlob = await removeBackground(file, {
      output: { format: 'image/png' },
      progress: (key, current, total) => {
        const progress = total ? Math.round((current / total) * 100) : 0;
        const label = key.includes('fetch') ? 'Baixando modelo local…' : key.includes('inference') ? 'Removendo o fundo…' : 'Refinando o recorte…';
        setStatus(`${label} ${progress}%`, 'processing');
      },
    });
    if (jobId !== state.jobId) return;
    state.resultBlob = resultBlob;
    state.resultUrl = URL.createObjectURL(state.resultBlob);
    await renderProcessedPreview();
    setStatus('Pronto para exportar.', 'success');
  } catch (error) {
    if (jobId !== state.jobId) return;
    resetResult();
    console.error(error);
    setStatus(`Não foi possível remover o fundo: ${error.message || 'erro desconhecido.'}`, 'error');
  } finally {
    if (jobId !== state.jobId) return;
    setBusy(false);
    elements.edgeRange.disabled = !state.resultBlob;
    elements.exportButton.disabled = !state.processedCanvas;
  }
}

async function handleFile(file) {
  if (!imageFile(file)) {
    setStatus('Escolha um arquivo de imagem JPG, PNG, WEBP ou AVIF.', 'error');
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    setStatus('A imagem precisa ter no máximo 20 MB.', 'error');
    return;
  }

  clearImage();
  state.sourceFile = file;
  state.sourceUrl = URL.createObjectURL(file);
  state.originalBlobUrl = state.sourceUrl;
  elements.originalImage.src = state.sourceUrl;
  elements.fileName.textContent = file.name;
  elements.fileMeta.textContent = formatFileSize(file.size);
  elements.previewEmpty.hidden = true;
  elements.previewContent.hidden = false;
  elements.previewCard.classList.add('has-image');
  setStatus('Imagem carregada. Iniciando recorte local…', 'processing');
  await runBackgroundRemoval(file, state.jobId);
}

function updateSplit() {
  elements.comparisonView.style.setProperty('--split', `${elements.splitRange.value}%`);
}

function updateRefinement() {
  state.refinement = Number(elements.edgeRange.value);
  elements.edgeValue.textContent = `${state.refinement}%`;
  if (state.resultBlob) renderProcessedPreview().catch((error) => setStatus(error.message, 'error'));
}

async function exportPng() {
  if (!state.processedCanvas) return;
  const canvas = document.createElement('canvas');
  canvas.width = state.processedCanvas.width;
  canvas.height = state.processedCanvas.height;
  const context = canvas.getContext('2d');
  if (state.background !== 'transparent') {
    context.fillStyle = state.background === 'white' ? '#ffffff' : state.customColor;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(state.processedCanvas, 0, 0);
  const blob = await canvasBlob(canvas);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${state.sourceFile.name.replace(/\.[^/.]+$/, '')}-sem-fundo.png`;
  link.click();
  URL.revokeObjectURL(url);
  setStatus('PNG exportado.', 'success');
}

async function insertIntoFigma() {
  if (!state.processedCanvas || !state.pluginMode) return;
  const blob = await canvasBlob(state.processedCanvas);
  sendToFigma({
    type: 'insert-image',
    bytes: new Uint8Array(await blob.arrayBuffer()),
    width: state.processedCanvas.width,
    height: state.processedCanvas.height,
    name: state.sourceFile?.name || 'remove-bg',
  });
  setStatus('Recorte enviado para o Figma.', 'success');
}

elements.chooseButton.addEventListener('click', () => elements.fileInput.click());
elements.dropzone.addEventListener('click', (event) => {
  if (event.target !== elements.chooseButton && event.target !== elements.selectionButton) elements.fileInput.click();
});
elements.dropzone.addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target === elements.dropzone) {
    event.preventDefault();
    elements.fileInput.click();
  }
});
elements.fileInput.addEventListener('change', (event) => handleFile(event.target.files[0]));
elements.dropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
  elements.dropzone.classList.add('is-dragging');
});
elements.dropzone.addEventListener('dragleave', () => elements.dropzone.classList.remove('is-dragging'));
elements.dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  elements.dropzone.classList.remove('is-dragging');
  handleFile(event.dataTransfer.files[0]);
});
elements.closeButton.addEventListener('click', () => {
  if (state.pluginMode) sendToFigma({ type: 'close' });
  else clearImage();
});
elements.selectionButton.addEventListener('click', () => sendToFigma({ type: 'request-selection' }));
elements.resetButton.addEventListener('click', () => {
  elements.edgeRange.value = 0;
  state.refinement = 0;
  elements.edgeValue.textContent = '0%';
  elements.splitRange.value = 50;
  updateSplit();
  $$('input[name="background"]')[0].checked = true;
  state.background = 'transparent';
  updatePreviewBackground();
  if (state.resultBlob) renderProcessedPreview();
});
elements.splitRange.addEventListener('input', updateSplit);
elements.edgeRange.addEventListener('input', updateRefinement);
$$('input[name="background"]').forEach((input) => input.addEventListener('change', (event) => {
  state.background = event.target.value;
  updatePreviewBackground();
}));
elements.customColor.addEventListener('input', (event) => {
  state.customColor = event.target.value;
  updatePreviewBackground();
});
elements.exportButton.addEventListener('click', () => exportPng().catch((error) => setStatus(error.message, 'error')));
elements.insertButton.addEventListener('click', () => insertIntoFigma().catch((error) => setStatus(error.message, 'error')));

window.addEventListener('message', (event) => {
  const message = event.data?.pluginMessage;
  if (!message) return;
  if (message.type === 'selection-available') {
    elements.selectionButton.hidden = !message.available;
    if (message.available) setStatus('Seleção do Figma disponível.', 'success');
  }
  if (message.type === 'selection-image') {
    const blob = new Blob([message.bytes], { type: 'image/png' });
    handleFile(new File([blob], message.name || 'selecao.png', { type: 'image/png' }));
  }
});

updatePreviewBackground();
updateSplit();
sendToFigma({ type: 'ui-ready' });

