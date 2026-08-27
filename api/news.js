// Função serverless (compatível com Vercel) que devolve notícias das bolsas
// dos EUA a partir de feeds RSS PÚBLICOS E GRATUITOS do Google News — sem
// chave de API, sem custos, sem conta na Anthropic.
//
// GET /api/news                     -> resumo diário por categoria
// GET /api/news?company=Microsoft   -> notícias sobre uma empresa/ticker
//
// O Google News RSS agrega automaticamente artigos de Bloomberg, CNBC,
// Reuters, Yahoo Finance, MarketWatch, WSJ, Seeking Alpha e muitos outros —
// cada item já vem com o link direto para a fonte original.

const CATEGORY_QUERIES = [
  { id: "macro", q: "Federal Reserve interest rates inflation stock market when:2d" },
  { id: "earnings", q: "quarterly earnings results stocks when:2d" },
  { id: "ipo", q: "IPO stock market merger acquisition when:5d" },
  { id: "tech", q: "AI Nvidia tech stocks Nasdaq when:2d" },
  { id: "indices", q: "S&P 500 Dow Jones Nasdaq stock market today when:1d" },
  { id: "regulacao", q: "SEC regulation stock market policy Congress when:5d" },
];

export default async function handler(req, res) {
  try {
    const company = (req.query.company || "").toString().trim().slice(0, 60);

    let items;
    if (company) {
      const raw = await fetchGoogleNewsRss(`"${company}" stock when:14d`);
      items = raw.slice(0, 12).map((it) => ({
        ...it,
        category: inferCategory(it.title),
        companies: [company],
      }));
    } else {
      const results = await Promise.all(
        CATEGORY_QUERIES.map(async (cat) => {
          const raw = await fetchGoogleNewsRss(cat.q);
          return raw.slice(0, 6).map((it) => ({ ...it, category: cat.id, companies: [] }));
        })
      );
      items = results.flat();
    }

    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1800");
    res.status(200).json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message || "Erro desconhecido ao procurar notícias." });
  }
}

async function fetchGoogleNewsRss(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    query
  )}&hl=en-US&gl=US&ceid=US:en`;

  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; WallStreetDesk/1.0)" },
  });
  if (!response.ok) {
    throw new Error(`Google News RSS respondeu HTTP ${response.status}`);
  }
  const xml = await response.text();
  return parseRssItems(xml);
}

function parseRssItems(xml) {
  const blocks = xml.split("<item>").slice(1);
  const items = [];

  for (const block of blocks) {
    const rawTitle = extractTag(block, "title");
    const rawLink = extractTag(block, "link");
    const pubDate = extractTag(block, "pubDate");
    const sourceMatch = block.match(/<source[^>]*>([^<]*)<\/source>/);

    if (!rawTitle) continue;

    const source = sourceMatch ? decodeEntities(stripCdata(sourceMatch[1])) : "Google News";
    let title = decodeEntities(stripCdata(rawTitle));
    // O Google News costuma juntar "Título - Nome da Fonte" no <title>;
    // como já temos a fonte em separado, removemos o sufixo duplicado.
    if (source && title.endsWith(` - ${source}`)) {
      title = title.slice(0, -(source.length + 3));
    }

    const link = rawLink ? decodeEntities(stripCdata(rawLink)).trim() : "";
    const isoDate = pubDate ? safeIsoDate(pubDate) : "";

    items.push({
      id: `${slugify(title)}-${Math.random().toString(36).slice(2, 9)}`,
      title,
      summary: "",
      source,
      time: isoDate,
      url: link,
      themes: [],
    });
  }

  return items;
}

function inferCategory(title) {
  const t = title.toLowerCase();
  if (/\bfed\b|federal reserve|interest rate|inflation|powell|treasury yield|jobs report|gdp/.test(t))
    return "macro";
  if (/earnings|quarterly|results|beats estimates|misses estimates|guidance|revenue/.test(t))
    return "earnings";
  if (/\bipo\b|merger|acquisition|acquire|takeover|buyout|deal to buy/.test(t)) return "ipo";
  if (/\bai\b|artificial intelligence|nvidia|chip|semiconductor|software|cloud computing/.test(t))
    return "tech";
  if (/\bsec\b|regulat|lawsuit|antitrust|congress|senate|tariff/.test(t)) return "regulacao";
  return "indices";
}

function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1].trim() : "";
}

function stripCdata(s) {
  const m = s.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return m ? m[1] : s;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function safeIsoDate(pubDate) {
  const d = new Date(pubDate);
  return isNaN(d.getTime()) ? "" : d.toISOString();
}

function slugify(str) {
  return (str || "item")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40);
}
