# Print Exporter Pro

Plugin do Figma para exportar frames como PDFs preparados para produção gráfica, com sangria física, marcas de corte e exportação em lote.

## O que ele faz

- Exporta a seleção atual ou todos os frames de primeiro nível da página.
- Gera um PDF por frame, com nomes seguros e sem colisões.
- Mantém a arte vetorial nativa do Figma.
- Aplica sangria e marcas de corte como elementos vetoriais.
- Mantém **5 mm físicos de sangria**, independentemente do tamanho original do frame.
- Redimensiona proporcionalmente a arte no preset de referência **20 × 7 cm**.
- Mantém o documento original intacto: a composição de impressão é temporária.

## Padrão de saída

O preset **Gráfica** segue o material de referência:

| Item | Valor |
| --- | --- |
| Área final | 20 × 7 cm |
| Sangria | 5 mm por lado |
| Área com sangria | 21 × 8 cm |
| Marcas de corte | 8 marcas vetoriais |
| Escala | proporcional, sem distorção |

Na interface, o tamanho aparece como **5 mm · igual ao modelo**. O nome descreve a sangria; o tamanho físico continua sendo 20 × 7 cm.

## Instalação no Figma

1. Baixe ou clone este repositório.
2. Abra o Figma Desktop.
3. Acesse **Plugins → Development → Import plugin from manifest**.
4. Selecione `manifest.json`.
5. Execute **Print Exporter Pro** em **Plugins → Development**.

## Como usar

1. Selecione um ou mais frames no Figma.
2. Abra o plugin e escolha o preset **Gráfica**.
3. Confirme **5 mm · igual ao modelo** no tamanho da página.
4. Clique em **Exportar PDF**.

Para vários folders, use **Página atual** e mantenha os frames no mesmo arquivo do Figma.

## Desenvolvimento

Requisitos: Node.js com suporte a `node:test`.

```bash
npm test
npm run check
```

O `check` valida a sintaxe do controlador e executa toda a suíte de testes.

## Estrutura

```text
├── manifest.json       # Configuração do plugin no Figma
├── src/
│   ├── code.js         # Controlador e composição do PDF
│   ├── code.test.js    # Testes do controlador
│   ├── ui.html         # Interface do plugin
│   └── ui.contract.test.js
├── manifest.test.js
└── package.json
```

## Limitações conhecidas

- A opção CMYK indica a intenção de saída, mas o exportador nativo do Figma não converte as cores para CMYK real.
- O PDF não recebe automaticamente `TrimBox` ou `BleedBox`.
- O preset de referência recusa frames com proporção diferente de 20 × 7 cm para evitar distorção.
- Elementos que já estão cortados na borda do frame precisam estar preparados para sangria no arquivo original.

## Repositório

[github.com/StaineeX/print-exporter-pro](https://github.com/StaineeX/print-exporter-pro)

## Integração com o Bleed Pro (API `printkit`)

O Bleed Pro grava na cópia de impressão um *shared plugin data* que qualquer plugin pode ler:

- namespace `printkit`, chave `sheet`
- JSON `{ version: 1, source: "bleed-pro", ppi, trim: { x, y, width, height }, bleed: { top, right, bottom, left }, slug, guides }`

Ao exportar uma cópia com esses dados, o Print Exporter Pro a exporta como está (sangria e marcas do Bleed Pro), esconde a camada de guias indicada em `guides` e converte o tamanho usando `ppi`.
