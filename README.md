# Pares de Placas

Ferramenta web que monta imagens comparativas **Dia 1 × Dia 5** de placas de Petri a partir das fotos.
As etiquetas são lidas por OCR e as placas são pareadas pelo identificador e pelo número.

Tudo roda no navegador (JavaScript + WebAssembly), então funciona no **GitHub Pages**, que não tem servidor.
As fotos não saem do computador de quem usa.

## Como usar

1. Monte um `.zip` com as fotos do **Dia 1** e outro com as fotos do **Dia 5**.
2. Abra a página, arraste cada zip para a área do seu dia e clique em **Processar**.
   O primeiro uso baixa cerca de 15 MB de bibliotecas, que depois ficam em cache.
3. Confira a galeria: em cada imagem, a placa de cima tem que ter o mesmo número da de baixo.
4. Se alguma leitura sair errada, corrija na **Revisão** e clique em **Atualizar imagens**.
   Itens em amarelo pedem atenção. Quando um ID aparece em um dia só e é parecido com um ID do outro dia, o sistema sugere unificar os dois.
5. Clique em **Baixar todos (.zip)**. O arquivo traz uma pasta `Pares/`, com um JPG por par, e o `sem_par.txt`.

## Regras

- Cada foto pode ter qualquer quantidade de placas. Cada etiqueta (retângulo preto) vira uma placa.
- A foto é girada automaticamente até as etiquetas ficarem legíveis.
- O número da placa vem da etiqueta, não da posição na foto.
- As placas são pareadas como 1 com 1 e 2 com 2.
- Amostras com mais de duas placas viram vários arquivos, por exemplo `B104_1-2.jpg` e `B104_3-4.jpg`.
- Cada imagem final tem 1600×1600 px: Dia 1 em cima, Dia 5 embaixo e o identificador no topo.
- No nome do arquivo, `:` vira `_`.

## Como funciona

| Etapa | Arquivo | Técnica |
|---|---|---|
| Leitura do zip | `js/main.js` | JSZip |
| Etiquetas e orientação | `js/vision.js` | OpenCV.js: máscara de preto neutro, que separa a etiqueta das folhas escuras, mais `minAreaRect`. A posição do número grande indica o lado de cima da etiqueta. |
| OCR | `js/ocr.js` | Tesseract.js: uma linha para o ID e um caractere para o número |
| Correção do ID | `js/ids.js` | Reconstrói o formato `TT-EDG-ddd[.d]_X.Y[=N]` (pontos e separadores perdidos no OCR) |
| Placas | `js/vision.js` | `HoughCircles`, com o raio esperado estimado pelo tamanho da etiqueta |
| Pareamento | `js/pairing.js` | Agrupa por ID e número |
| Imagem final | `js/render.js` | Canvas |

## Publicar no GitHub Pages

1. Crie um repositório e envie estes arquivos. A pasta `test-data/` é ignorada pelo git.
2. No GitHub, vá em **Settings → Pages → Build and deployment**, escolha **Deploy from a branch**, branch `main` e pasta `/ (root)`.
3. A página fica em `https://<usuario>.github.io/<repositorio>/`.

## Rodar localmente

```bash
python -m http.server 8000
# abra http://localhost:8000
```

Para testar sem clicar, use `?d1=<url-do-zip-dia1>&d5=<url-do-zip-dia5>`. Os dois zips são carregados e processados automaticamente.
