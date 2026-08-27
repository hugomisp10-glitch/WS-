# Wall Street Desk (versão gratuita)

Resumo diário das principais notícias sobre as bolsas dos EUA, organizado por
tipologia (Fed & Macro, Earnings, M&A/IPO, Tech & IA, Índices & Ações,
Regulação & Política), com pesquisa dedicada por empresa/ticker e notícias
guardadas (★) gravadas no teu telemóvel.

**100% gratuito** — sem chave de API, sem conta na Anthropic, sem cartão de
crédito. As notícias vêm de feeds RSS públicos do Google News (que agrega
Bloomberg, CNBC, Reuters, Yahoo Finance, MarketWatch, WSJ, Seeking Alpha e
muitos outros), com link direto para o artigo original em cada notícia.

## Como funciona

- **Frontend**: React + Vite, corre no browser do telemóvel/computador.
- **Backend**: uma função serverless (`api/news.js`) que lê feeds RSS
  públicos do Google News e devolve os resultados já organizados por
  categoria. Não precisa de nenhuma chave nem credenciais.
- **Armazenamento**: `localStorage` do browser — as notícias guardadas (★) e
  a cache do dia ficam gravadas diretamente no dispositivo, sem conta nem
  base de dados.

> Nota: como não há nenhuma IA a resumir ou traduzir as notícias, os títulos
> aparecem tal como foram publicados (maioritariamente em inglês, já que são
> fontes americanas). Isto também significa nunca haver invenções — o que vês
> é exatamente o que a fonte publicou.

## Configuração local

Pré-requisito: [Node.js](https://nodejs.org) 18 ou superior.

```bash
npm install
```

Para testares a app por completo em local (frontend + função serverless),
usa a CLI da Vercel:

```bash
npm install -g vercel
vercel dev
```

Isto abre a app em `http://localhost:3000` com `/api/news` já a funcionar.

> Se correres apenas `npm run dev` (sem `vercel dev`), o frontend abre mas as
> chamadas a `/api/news` falham, porque não há nenhum servidor a responder a
> esse caminho.

## Deploy (para teres a app sempre disponível no telemóvel)

O caminho mais simples é a [Vercel](https://vercel.com) (plano grátis, sem
cartão de crédito):

1. Cria um repositório no GitHub com este código e faz `git push`
2. Em [vercel.com/new](https://vercel.com/new), importa o repositório
3. Clica **Deploy** — não precisas de configurar nenhuma variável de
   ambiente. Em cerca de 1 minuto ficas com um URL público, ex:
   `wall-street-desk.vercel.app`

Outras opções gratuitas com suporte a funções serverless: Netlify,
Cloudflare Pages (precisam de pequenos ajustes ao formato de `api/news.js`).

## Instalar no telemóvel (como se fosse uma app)

Depois do deploy, abre o URL no telemóvel:

- **iPhone (Safari)**: botão de partilha → "Adicionar ao ecrã principal"
- **Android (Chrome)**: menu (⋮) → "Adicionar ao ecrã principal" / "Instalar app"

Fica com ícone próprio, abre em ecrã inteiro (sem barra do browser), e o
armazenamento local (bookmarks, cache do dia) mantém-se entre aberturas.

## Estrutura do projeto

```
wall-street-desk/
├── api/
│   └── news.js          # função serverless — lê RSS público do Google News
├── public/
│   └── manifest.json     # metadados PWA (ícone, nome, cores)
├── src/
│   ├── App.jsx            # toda a lógica e UI da app
│   ├── main.jsx           # ponto de entrada React
│   └── index.css          # estilos base
├── index.html
├── package.json
└── vite.config.js
```

## Personalizar

- **Categorias/consultas de pesquisa**: edita `CATEGORIES` em `src/App.jsx`
  (nomes/cores) e `CATEGORY_QUERIES` em `api/news.js` (o que é pesquisado em
  cada categoria — usa a sintaxe de pesquisa do Google News, ex:
  `when:2d` para limitar a janela temporal).
- **Categorização automática**: a função `inferCategory()` em `api/news.js`
  classifica notícias de empresa por palavras-chave no título — podes ajustar
  a lista de palavras conforme preferires.
- **Cor/tipografia**: tudo em CSS puro dentro do próprio `App.jsx` (bloco
  `<style>`), fácil de ajustar.

## Limitações desta versão gratuita

- Títulos aparecem no idioma original da fonte (normalmente inglês), sem
  tradução nem resumo por IA
- A categorização de notícias de empresa é por palavras-chave simples, não
  tão precisa como classificação por IA
- Depende da disponibilidade do serviço RSS do Google News

Se mais tarde quiseres resumos em português gerados por IA, categorização
mais inteligente ou pesquisa mais ampla, é possível voltar a uma versão que
usa a API da Anthropic (com custo associado, mas com $5 de crédito grátis
para testar) — basta pedires.

## Aviso

Conteúdo agregado automaticamente a partir de fontes públicas — é
informativo e não constitui aconselhamento financeiro. Confirma sempre os
factos importantes na fonte original (o link em cada notícia) antes de
tomares decisões de investimento.
