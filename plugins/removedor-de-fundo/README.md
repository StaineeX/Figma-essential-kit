# Remove BG Pro

## Finalidade

Remover o fundo de uma imagem selecionada no Figma usando processamento local na interface do plugin.

## Recursos confirmados pelo código

- Importa uma seleção rasterizável do Figma.
- Processa um arquivo por vez, com limite de 20 MB.
- Envia o PNG processado de volta e cria uma camada no documento.
- Usa `@imgly/background-removal` e `onnxruntime-web`.

## Instalar e executar

O manifest aponta para o build existente em `dist/`. No Figma Desktop, importe `manifest.json` e execute **Remove BG Pro** em **Plugins → Development**. Para reconstruir após alterar o código: `npm install` e `npm run build`.

## Limitações conhecidas

Não há processamento em lote, pincel manual, login ou armazenamento em nuvem. Na primeira execução, o navegador baixa e armazena em cache os modelos/WASM; o processamento pode demorar.

## Dependências

Node.js/NPM para reconstrução; `@imgly/background-removal` 1.7.0, `onnxruntime-web` 1.21.0 e Vite 8.3.8. O manifest permite acesso a `https://staticimgly.com`.
