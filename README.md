# Essential Kit Figma

Coleção de plugins locais para agilizar produção gráfica, tratamento de imagens e preparação de arquivos no Figma. Os arquivos deste repositório são os projetos encontrados no computador, preservados sem alteração da lógica.

![Essential Kit Figma](assets/essential-kit-figma.svg)

## Plugins encontrados

| Plugin | Para que serve |
|---|---|
| **Bleed Pro** | Configura sangria interna e externa em milímetros ou centímetros para materiais de impressão. |
| **Remove BG Pro** | Remove o fundo de uma imagem selecionada usando processamento local. |
| **FigAI Pranchetas** | Cria e organiza pranchetas de forma rápida no Figma. |
| **FigAI** | Reúne recursos assistidos por IA para apoiar tarefas de criação. |
| **Print Exporter Pro** | Exporta arquivos para impressão com configurações de corte e sangria. |

## Instalação geral

1. Clone ou baixe este repositório.
2. Abra o Figma Desktop.
3. Acesse **Plugins → Development → Import plugin from manifest…**.
4. Selecione o `manifest.json` dentro da pasta do plugin desejado (os caminhos exatos estão nos READMEs individuais).
5. Execute o plugin pelo menu **Plugins → Development**.

> Estes plugins devem ser usados como plugins de desenvolvimento. A importação local pelo `manifest.json` é necessária; a publicação na Figma Community é um processo separado.

## Importar um plugin local pelo manifest.json

No Figma Desktop, abra **Plugins → Development → Import plugin from manifest…**, navegue até a pasta do plugin e selecione seu `manifest.json`. Depois, execute-o em **Plugins → Development**. Se o código-fonte for alterado, reimporte ou recarregue o plugin conforme o fluxo do Figma.

## Estrutura

Cada plugin fica em sua própria pasta, com seus arquivos reais, o `manifest.json` e um README específico. Não há pastas vazias nem arquivos misturados entre plugins.

```text
plugins/
├── bleed-pro/
├── removedor-de-fundo/
├── figai/
├── figai-pranchetas/
└── print-exporter-pro/
```

## Observações

- Os cinco plugins listados acima foram encontrados e copiados para este repositório.
- Cada pasta informa limitações e dependências confirmadas pelo código.
- Faça uma cópia do arquivo antes de exportações importantes.

## Licença

Projeto pessoal de StaineeX. Consulte a licença e os avisos de cada plugin antes de redistribuir ou publicar versões modificadas.
