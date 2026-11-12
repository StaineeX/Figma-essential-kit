# FIGAI — Export to Illustrator

## Finalidade

Plugin real encontrado no pacote FIGAI 0.1.0 para exportar dados do Figma para uso no Illustrator.

## Recursos confirmados pelo código

- Interface HTML do plugin (`figma-plugin/dist/ui.html`).
- Controlador compilado (`figma-plugin/dist/code.js`).
- Arquivo de importação para Illustrator (`illustrator/FIGAI Import.jsx`).
- Exemplo FIGAI em `sample/end-to-end.figai`.

## Instalar e executar

No Figma Desktop, use **Plugins → Development → Import plugin from manifest…** e selecione `figma-plugin/manifest.json`. Execute pelo menu de plugins de desenvolvimento. O arquivo JSX é usado no fluxo do Illustrator, não é o entrypoint do Figma.

## Limitações conhecidas

O pacote contém o build distribuído do plugin; não há código-fonte de desenvolvimento do controlador nesta cópia. O processamento depende da compatibilidade do formato exportado com o script do Illustrator.

## Dependências

Não há dependências NPM declaradas no pacote. Requer Figma Desktop para o plugin e Illustrator para o script JSX.
