# QR Code Nativo

## Finalidade

Gerar QR codes no Figma com formas nativas (retângulos e elipses), sem importar SVG.

## Recursos confirmados pelo código

- Três formatações: **Quadrado**, **Pontos** e **Arredondado**.
- Texto ou URL com acentos e emoji (UTF-8), versões 1 a 40.
- Níveis de correção L, M, Q e H.
- Tamanho em px, cor do QR, cor de fundo ou fundo transparente.
- Cria um frame com o grupo "Módulos", editável e recolorível.

## Instalar e executar

No Figma Desktop, importe `manifest.json` em **Plugins → Development → Import plugin from manifest…** e execute **QR Code Nativo** pelo mesmo menu.

## Teste

`test.js` gera QR codes, rasteriza e decodifica com jsQR:

```bash
npm install --prefix <pasta> jsqr@1.4.0
node test.js <pasta>
```

## Limitações conhecidas

Os estilos Pontos e Arredondado devem ser conferidos com a câmera do celular antes de impressão. QR codes grandes geram muitas camadas.

## Dependências

Nenhuma dependência em tempo de execução; requer Figma Desktop.
