# Essential Kit Figma

Kit de ferramentas criadas para agilizar produção gráfica, tratamento de imagens e organização de arquivos no Figma.

![Essential Kit Figma](assets/essential-kit-figma.svg)

## Plugins incluídos

| Plugin | Para que serve |
|---|---|
| **Bleed Pro** | Configura sangria interna e externa em milímetros ou centímetros para materiais de impressão. |
| **Removedor de Fundo** | Remove o fundo de imagens e prepara elementos para uso em layouts. |
| **FigAI Pranchetas** | Cria e organiza pranchetas de forma rápida no Figma. |
| **FigAI** | Reúne recursos assistidos por IA para apoiar tarefas de criação. |
| **Print Exporter Pro** | Exporta arquivos para impressão com configurações de corte e sangria. |

## Instalação no Figma

1. Baixe o plugin desejado na pasta correspondente.
2. Extraia o arquivo ZIP.
3. Abra o Figma Desktop.
4. Acesse **Plugins → Development → Import plugin from manifest…**.
5. Selecione o arquivo `manifest.json` da pasta do plugin.
6. Execute o plugin pelo menu **Plugins → Development**.

> A importação local é necessária porque estes plugins são distribuídos como plugins de desenvolvimento do Figma. Para publicar na comunidade do Figma, é necessário fazer uma submissão separada pela conta do autor.

## Estrutura

Cada plugin fica em sua própria pasta, com o código, o `manifest.json` e um README específico. Assim, é possível instalar, testar e atualizar cada ferramenta sem misturar os projetos.

## Observações

- Use a versão mais recente de cada pasta.
- Faça uma cópia do arquivo antes de exportações importantes.
- O resultado da remoção de fundo pode variar conforme a imagem original.
- Os recursos de IA dependem da configuração e da implementação de cada versão do plugin.

## Licença

Projeto pessoal de StaineeX. Consulte a licença e os avisos de cada plugin antes de redistribuir ou publicar versões modificadas.
