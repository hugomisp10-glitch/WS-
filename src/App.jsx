import { useState, useEffect, useMemo, useCallback } from "react";
import { Search, Star, X, RotateCcw, RefreshCw, Newspaper, AlertCircle, ExternalLink } from "lucide-react";

// ---------------------------------------------------------------------------
// Sempre que a app abre (ou quando carregas em "Atualizar"), é feita uma
// chamada à API da Anthropic com web search ativo, que pesquisa os principais
// sites de bolsa (Bloomberg, CNBC, Reuters, Yahoo Finance, MarketWatch,
// Seeking Alpha) e devolve um snapshot estruturado das notícias mais
// relevantes do dia. O resultado fica em cache local (por dia) para não
// pesquisar de novo a cada abertura no mesmo dia — há sempre um botão
// "Atualizar" para forçar uma pesquisa nova.
// ---------------------------------------------------------------------------

const CATEGORIES = [
  { id: "macro", label: "Fed & Macro", accent: "#D4A24C" },
  { id: "earnings", label: "Earnings", accent: "#6FAE7C" },
  { id: "ipo", label: "M&A / IPO", accent: "#8E7CC3" },
  { id: "tech", label: "Tech & IA", accent: "#4A9DB8" },
  { id: "indices", label: "Índices & Ações", accent: "#C1666B" },
  { id: "regulacao", label: "Regulação & Política", accent: "#B0894F" },
];

const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

// Snapshot inicial — usado apenas se a pesquisa em direto falhar e não
// houver nenhuma versão em cache guardada anteriormente.
const FALLBACK_ITEMS = [
  {
    id: "fallback-1",
    category: "indices",
    title: "A app está prestes a procurar as notícias mais recentes",
    summary:
      "Assim que a pesquisa em direto terminar, este cartão é substituído pelas notícias reais de hoje sobre as bolsas dos EUA.",
    source: "Wall Street Desk",
    time: "agora",
    companies: [],
    themes: ["Sistema"],
  },
];

const SYSTEM_PROMPT = `És um agregador de notícias financeiras. Pesquisa na web pelas notícias mais importantes e recentes sobre as bolsas dos EUA (Wall Street, S&P 500, Nasdaq, Dow Jones). Faz VÁRIAS pesquisas com termos diferentes (ex: "stock market news today", "Wall Street today", "S&P 500 today", "Fed news", "earnings this week", "IPO news") para garantires boa cobertura, em vez de te limitares a uma única pesquisa. Usa como fontes: Bloomberg, CNBC, Reuters, Yahoo Finance, MarketWatch, Wall Street Journal, Seeking Alpha, Barron's, Investing.com, Business Insider, Motley Fool, Benzinga, Axios e Fortune — usa qualquer uma delas que aparecer nos resultados, não te limites às primeiras.

Devolve APENAS um array JSON puro (sem markdown, sem \`\`\`, sem texto antes ou depois), com EXATAMENTE 8 itens — nem mais, nem menos, para garantires que consegues terminar a resposta — cada um com exatamente estes campos:
- "category": um destes valores exatos -> "macro" (Fed/taxas/inflação/macroeconomia), "earnings" (resultados empresariais), "ipo" (IPOs e fusões/aquisições), "tech" (tecnologia e IA), "indices" (índices e ações em destaque), "regulacao" (regulação e política)
- "title": título curto em português de Portugal, factual, sem sensacionalismo (máximo 12 palavras)
- "summary": 1 frase curta em português de Portugal, no máximo 18 palavras
- "source": nome do meio de comunicação de onde veio a notícia
- "time": indicação temporal curta (ex: "há 3h", "hoje", "21 ago")
- "url": o link direto e exato para o artigo original, tal como aparece nos resultados de pesquisa (nunca inventes um link — se não tiveres a certeza do URL exato, usa string vazia "")
- "companies": array com no máximo 3 nomes de empresas/tickers relevantes (pode ser vazio)
- "themes": array com 1 a 2 temas curtos em português (ex: "Fed", "IA", "Earnings")

Sê conciso em todos os campos de texto — a resposta tem de caber num orçamento curto de tokens. Prioriza diversidade entre as 6 categorias em vez de concentrar tudo numa só. Não inventes números ou factos — só reporta o que encontrares nas pesquisas. Termina sempre o array corretamente fechado com "]".`;

function slugify(str) {
  return (str || "item")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40);
}

// Tenta reparar um array JSON que possa ter ficado cortado a meio
// (ex: resposta truncada por limite de tokens), aproveitando os
// objetos que já ficaram completos.
function repairJsonArray(raw) {
  let depth = 0;
  let lastGoodIndex = -1;
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === "\\") {
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) lastGoodIndex = i;
    }
  }
  if (lastGoodIndex === -1) return null;
  return raw.slice(0, lastGoodIndex + 1) + "]";
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function timeAgo(iso) {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "agora mesmo";
  if (mins < 60) return `há ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `há ${hrs}h`;
  return new Date(iso).toLocaleDateString("pt-PT");
}

function buildCompanySystemPrompt(term) {
  return `És um agregador de notícias financeiras. Pesquisa na web pelas notícias mais recentes e relevantes sobre "${term}" (empresa cotada nos EUA) — resultados, ações, analistas, movimentos do título, negócios, produtos, litígios, etc. Faz VÁRIAS pesquisas com termos diferentes para maximizar a cobertura, por exemplo: "${term} stock news", "${term} stock price", "${term} earnings", "${term} analyst rating", "${term} news this week" — não te limites a uma única pesquisa, mesmo que as primeiras não devolvam muito. Usa qualquer uma destas fontes que aparecer nos resultados: Bloomberg, CNBC, Reuters, Yahoo Finance, MarketWatch, Wall Street Journal, Seeking Alpha, Barron's, Investing.com, Business Insider, Motley Fool, Benzinga, Axios, Fortune, TechCrunch, TheStreet.

Alarga a janela temporal aos últimos 14 dias se não encontrares notícias apenas de hoje — não deixes o resultado vazio só porque não há nada nas últimas 24h.

Devolve APENAS um array JSON puro (sem markdown, sem \`\`\`, sem texto antes ou depois), com até 8 itens sobre "${term}" (o máximo que conseguires encontrar de genuinamente relevante, mínimo 1), cada um com exatamente estes campos:
- "category": um destes valores exatos -> "macro", "earnings", "ipo", "tech", "indices", "regulacao" (o que melhor descrever a notícia)
- "title": título curto em português de Portugal, factual (máximo 12 palavras)
- "summary": 1 frase curta em português de Portugal, no máximo 18 palavras
- "source": nome do meio de comunicação de onde veio a notícia
- "time": indicação temporal curta (ex: "há 3h", "hoje", "21 ago")
- "url": o link direto e exato para o artigo original, tal como aparece nos resultados de pesquisa (nunca inventes um link — se não tiveres a certeza do URL exato, usa string vazia "")
- "companies": array com no máximo 3 nomes de empresas/tickers relevantes, incluindo sempre "${term}"
- "themes": array com 1 a 2 temas curtos em português

Se, mesmo depois de várias pesquisas com termos diferentes, não encontrares NADA sobre "${term}", devolve um array vazio []. Nunca inventes notícias, factos ou links. Sê conciso — a resposta tem de caber num orçamento curto de tokens. Termina sempre o array corretamente fechado com "]".`;
}

// Faz o parsing (com reparo automático) de uma resposta de texto que
// deve conter um array JSON de notícias, e normaliza os campos.
function parseNewsResponse(data) {
  if (data && data.type === "error") {
    throw new Error(`API error — ${data.error?.message || "desconhecido"}`);
  }

  const textBlocks = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  if (!textBlocks.trim()) {
    throw new Error(
      `Sem texto na resposta (stop_reason: ${data.stop_reason || "?"}, blocos: ${(data.content || [])
        .map((b) => b.type)
        .join(",")})`
    );
  }

  const cleaned = textBlocks.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  const jsonStr = start === -1 ? null : cleaned.slice(start, end === -1 ? undefined : end + 1);

  let parsed = null;
  if (jsonStr) {
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      const repaired = repairJsonArray(cleaned.slice(start));
      if (repaired) {
        try {
          parsed = JSON.parse(repaired);
        } catch (e2) {
          throw new Error(`JSON inválido mesmo após reparo: ${e2.message}`);
        }
      } else {
        throw new Error(`JSON inválido: ${parseErr.message}`);
      }
    }
  } else {
    throw new Error(`Resposta sem array JSON. Início do texto: "${cleaned.slice(0, 120)}"`);
  }

  return parsed
    .filter((it) => it && it.title)
    .map((it, idx) => ({
      id: `${slugify(it.title)}-${idx}-${Date.now().toString(36)}`,
      category: CATEGORY_IDS.includes(it.category) ? it.category : "indices",
      title: String(it.title),
      summary: String(it.summary || ""),
      source: String(it.source || "Fonte desconhecida"),
      time: String(it.time || ""),
      url: typeof it.url === "string" && it.url.startsWith("http") ? it.url : "",
      companies: Array.isArray(it.companies) ? it.companies.slice(0, 6) : [],
      themes: Array.isArray(it.themes) ? it.themes.slice(0, 4) : [],
    }))
    .slice(0, 16);
}

async function callNewsApi(systemPrompt, userMessage) {
  const response = await fetch("/api/news", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemPrompt, userMessage }),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} — ${bodyText.slice(0, 200)}`);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Armazenamento local no telemóvel/browser (localStorage). Substitui o
// window.storage disponível apenas dentro de artifacts do Claude — aqui os
// dados ficam guardados diretamente no dispositivo onde a app corre (persiste
// entre sessões, incluindo quando adicionada ao ecrã principal como PWA).
// ---------------------------------------------------------------------------
const storage = {
  async get(key) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return null;
      return { key, value: raw };
    } catch (e) {
      return null;
    }
  },
  async set(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return { key, value };
    } catch (e) {
      console.error("localStorage indisponível ou cheio", e);
      return null;
    }
  },
};

export default function WallStreetDesk() {
  const [items, setItems] = useState(FALLBACK_ITEMS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const [query, setQuery] = useState("");
  const [activeThemes, setActiveThemes] = useState([]);
  const [activeCategory, setActiveCategory] = useState("all");
  const [bookmarks, setBookmarks] = useState([]);
  const [showBookmarkedOnly, setShowBookmarkedOnly] = useState(false);

  const [companyResults, setCompanyResults] = useState(null);
  const [companySearchTerm, setCompanySearchTerm] = useState("");
  const [companyLoading, setCompanyLoading] = useState(false);
  const [companyError, setCompanyError] = useState(null);

  const fetchLatestNews = useCallback(async (force) => {
    setLoading(true);
    setError(null);
    try {
      const data = await callNewsApi(
        SYSTEM_PROMPT,
        "Gera agora o snapshot das notícias mais recentes sobre as bolsas dos EUA."
      );
      const normalized = parseNewsResponse(data);
      if (normalized.length === 0) throw new Error("Sem itens no resultado");

      const nowIso = new Date().toISOString();
      setItems(normalized);
      setLastUpdated(nowIso);

      try {
        await storage.set(
          SNAPSHOT_KEY,
          JSON.stringify({ date: todayKey(), items: normalized, updatedAt: nowIso })
        );
      } catch (storageErr) {
        console.error("Não foi possível guardar o snapshot em cache", storageErr);
      }
    } catch (e) {
      console.error("Falha ao procurar notícias em direto", e);
      setError(
        "Não foi possível procurar notícias novas agora. " +
          (force ? "A manter a versão atual. " : "A mostrar a última versão guardada, se existir. ") +
          `Detalhe: ${e.message}`
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const searchCompanyNews = useCallback(async (term) => {
    const clean = term.trim();
    if (!clean) return;
    setCompanyLoading(true);
    setCompanyError(null);
    setCompanySearchTerm(clean);
    try {
      const data = await callNewsApi(
        buildCompanySystemPrompt(clean),
        `Procura notícias recentes sobre "${clean}".`
      );
      const normalized = parseNewsResponse(data);
      if (normalized.length === 0) {
        setCompanyError(`Não foram encontradas notícias recentes sobre "${clean}". Tenta o nome completo da empresa ou o ticker (ex: "Microsoft" ou "MSFT").`);
        setCompanyResults(null);
      } else {
        setCompanyResults(normalized);
      }
    } catch (e) {
      console.error("Falha ao procurar notícias da empresa", e);
      setCompanyError(`Não foi possível procurar notícias sobre "${clean}". Detalhe: ${e.message}`);
      setCompanyResults(null);
    } finally {
      setCompanyLoading(false);
    }
  }, []);

  const clearCompanySearch = () => {
    setCompanyResults(null);
    setCompanySearchTerm("");
    setCompanyError(null);
    setQuery("");
  };


  // Arranque: tenta cache do dia; caso contrário, pesquisa em direto.
  useEffect(() => {
    (async () => {
      try {
        const cached = await storage.get(SNAPSHOT_KEY);
        if (cached && cached.value) {
          const parsed = JSON.parse(cached.value);
          if (parsed.date === todayKey() && Array.isArray(parsed.items) && parsed.items.length) {
            setItems(parsed.items);
            setLastUpdated(parsed.updatedAt);
            setLoading(false);
            return;
          }
        }
      } catch (e) {
        // sem cache disponível — segue para pesquisa em direto
      }
      fetchLatestNews(false);
    })();

    (async () => {
      try {
        const res = await storage.get(BOOKMARK_KEY);
        if (res && res.value) setBookmarks(JSON.parse(res.value));
      } catch (e) {
        // sem bookmarks guardados ainda
      }
    })();
  }, [fetchLatestNews]);

  const toggleBookmark = async (id) => {
    const next = bookmarks.includes(id)
      ? bookmarks.filter((b) => b !== id)
      : [...bookmarks, id];
    setBookmarks(next);
    try {
      await storage.set(BOOKMARK_KEY, JSON.stringify(next));
    } catch (e) {
      console.error("Não foi possível guardar o bookmark", e);
    }
  };

  const allThemes = useMemo(() => {
    const set = new Set();
    items.forEach((item) => (item.themes || []).forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [items]);

  const toggleTheme = (theme) => {
    setActiveThemes((prev) =>
      prev.includes(theme) ? prev.filter((t) => t !== theme) : [...prev, theme]
    );
  };

  const clearFilters = () => {
    setQuery("");
    setActiveThemes([]);
    setActiveCategory("all");
    setShowBookmarkedOnly(false);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (activeCategory !== "all" && item.category !== activeCategory) return false;
      if (showBookmarkedOnly && !bookmarks.includes(item.id)) return false;
      if (
        activeThemes.length > 0 &&
        !activeThemes.some((t) => (item.themes || []).includes(t))
      )
        return false;
      if (q) {
        const haystack = (
          item.title +
          " " +
          item.summary +
          " " +
          (item.companies || []).join(" ")
        ).toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [items, query, activeThemes, activeCategory, showBookmarkedOnly, bookmarks]);

  const grouped = useMemo(() => {
    return CATEGORIES.map((cat) => ({
      ...cat,
      items: filtered.filter((i) => i.category === cat.id),
    })).filter((cat) => cat.items.length > 0);
  }, [filtered]);

  const hasActiveFilters =
    query || activeThemes.length > 0 || activeCategory !== "all" || showBookmarkedOnly;

  const headlineTicker = items.slice(0, 6);

  return (
    <div className="wsd-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

        * { box-sizing: border-box; }

        .wsd-root {
          min-height: 100vh;
          background: #0E1420;
          background-image:
            radial-gradient(ellipse 80% 50% at 50% -20%, rgba(212,162,76,0.10), transparent),
            repeating-linear-gradient(180deg, rgba(255,255,255,0.012) 0px, rgba(255,255,255,0.012) 1px, transparent 1px, transparent 3px);
          color: #E8E6DF;
          font-family: 'Inter', sans-serif;
          padding-bottom: 4rem;
        }

        .wsd-header {
          padding: 2rem 1.25rem 1.25rem;
          max-width: 1100px;
          margin: 0 auto;
        }

        .wsd-eyebrow {
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.7rem;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: #D4A24C;
          margin-bottom: 0.5rem;
        }

        .wsd-title {
          font-family: 'Fraunces', serif;
          font-weight: 600;
          font-size: clamp(1.8rem, 5vw, 2.6rem);
          line-height: 1.05;
          margin: 0 0 0.4rem;
          color: #F3F1E9;
        }

        .wsd-subtitle {
          color: #8891A3;
          font-size: 0.92rem;
          max-width: 640px;
          line-height: 1.5;
        }

        .wsd-status-row {
          display: flex;
          align-items: center;
          gap: 0.7rem;
          margin-top: 1rem;
          flex-wrap: wrap;
        }

        .wsd-status-text {
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.75rem;
          color: #5B6478;
        }

        .wsd-refresh-btn {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.78rem;
          font-weight: 600;
          background: rgba(212,162,76,0.1);
          border: 1px solid rgba(212,162,76,0.35);
          color: #D4A24C;
          border-radius: 999px;
          padding: 0.4rem 0.8rem;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .wsd-refresh-btn:hover { background: rgba(212,162,76,0.18); }
        .wsd-refresh-btn:disabled { opacity: 0.55; cursor: default; }
        .wsd-refresh-btn svg.spin { animation: wsd-spin 0.9s linear infinite; }
        @keyframes wsd-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        .wsd-error-banner {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          background: rgba(193,102,107,0.1);
          border: 1px solid rgba(193,102,107,0.35);
          color: #D98F93;
          font-size: 0.8rem;
          padding: 0.55rem 0.8rem;
          border-radius: 8px;
          margin-top: 0.9rem;
        }

        /* Ticker */
        .wsd-ticker-wrap {
          border-top: 1px solid rgba(255,255,255,0.08);
          border-bottom: 1px solid rgba(255,255,255,0.08);
          background: #0A0F19;
          overflow: hidden;
          position: relative;
        }
        .wsd-ticker-wrap::before, .wsd-ticker-wrap::after {
          content: '';
          position: absolute;
          top: 0; bottom: 0;
          width: 40px;
          z-index: 2;
          pointer-events: none;
        }
        .wsd-ticker-wrap::before { left: 0; background: linear-gradient(90deg, #0A0F19, transparent); }
        .wsd-ticker-wrap::after { right: 0; background: linear-gradient(270deg, #0A0F19, transparent); }
        .wsd-ticker-track {
          display: flex;
          width: max-content;
          animation: wsd-scroll 42s linear infinite;
          padding: 0.6rem 0;
        }
        @media (prefers-reduced-motion: reduce) {
          .wsd-ticker-track { animation: none; }
        }
        @keyframes wsd-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        .wsd-ticker-item {
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.78rem;
          white-space: nowrap;
          padding: 0 1.5rem;
          display: flex;
          align-items: baseline;
          gap: 0.5rem;
          border-right: 1px solid rgba(255,255,255,0.08);
          color: #A9B0BF;
        }
        .wsd-ticker-item b { color: #D4A24C; font-weight: 600; }

        /* Controls */
        .wsd-controls {
          max-width: 1100px;
          margin: 1.5rem auto 0;
          padding: 0 1.25rem;
          display: flex;
          flex-direction: column;
          gap: 0.9rem;
        }

        .wsd-search {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          background: #161D2E;
          border: 1px solid rgba(255,255,255,0.09);
          border-radius: 10px;
          padding: 0.65rem 0.9rem;
        }
        .wsd-search input {
          background: transparent;
          border: none;
          outline: none;
          color: #E8E6DF;
          font-family: 'Inter', sans-serif;
          font-size: 0.92rem;
          width: 100%;
        }
        .wsd-search input::placeholder { color: #5B6478; }
        .wsd-search svg { color: #5B6478; flex-shrink: 0; }

        .wsd-company-search-btn {
          font-family: 'Inter', sans-serif;
          font-size: 0.78rem;
          font-weight: 600;
          white-space: nowrap;
          background: #D4A24C;
          color: #0E1420;
          border: none;
          border-radius: 7px;
          padding: 0.4rem 0.7rem;
          cursor: pointer;
          flex-shrink: 0;
        }
        .wsd-company-search-btn:hover { background: #E3B563; }
        .wsd-company-search-btn:disabled { opacity: 0.6; cursor: default; }

        .wsd-company-section {
          background: rgba(212,162,76,0.05);
          border: 1px solid rgba(212,162,76,0.25);
          border-radius: 12px;
          padding: 1.1rem;
          margin-bottom: 2rem;
        }
        .wsd-company-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.6rem;
          margin-bottom: 0.9rem;
          flex-wrap: wrap;
        }
        .wsd-company-title {
          font-family: 'Fraunces', serif;
          font-weight: 600;
          font-size: 1.15rem;
          color: #D4A24C;
        }
        .wsd-company-back {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          font-size: 0.8rem;
          color: #8891A3;
          background: none;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 999px;
          padding: 0.35rem 0.7rem;
          cursor: pointer;
        }
        .wsd-company-back:hover { color: #E8E6DF; }

        .wsd-cat-row {
          display: flex;
          gap: 0.5rem;
          overflow-x: auto;
          padding-bottom: 0.2rem;
        }
        .wsd-cat-btn {
          font-family: 'Inter', sans-serif;
          font-size: 0.82rem;
          font-weight: 600;
          white-space: nowrap;
          padding: 0.45rem 0.85rem;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.1);
          background: transparent;
          color: #A9B0BF;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .wsd-cat-btn:hover { border-color: rgba(255,255,255,0.25); color: #E8E6DF; }
        .wsd-cat-btn.active {
          background: #E8E6DF;
          border-color: #E8E6DF;
          color: #0E1420;
        }

        .wsd-theme-row {
          display: flex;
          gap: 0.45rem;
          flex-wrap: wrap;
        }
        .wsd-chip {
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.72rem;
          padding: 0.3rem 0.65rem;
          border-radius: 6px;
          border: 1px solid rgba(74,157,184,0.35);
          background: rgba(74,157,184,0.08);
          color: #7FB8CC;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .wsd-chip:hover { border-color: rgba(74,157,184,0.7); }
        .wsd-chip.active {
          background: #4A9DB8;
          border-color: #4A9DB8;
          color: #0E1420;
          font-weight: 600;
        }

        .wsd-util-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem;
          flex-wrap: wrap;
        }

        .wsd-bookmark-toggle {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.8rem;
          color: #A9B0BF;
          background: none;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 999px;
          padding: 0.4rem 0.75rem;
          cursor: pointer;
        }
        .wsd-bookmark-toggle.active {
          border-color: #D4A24C;
          color: #D4A24C;
          background: rgba(212,162,76,0.08);
        }

        .wsd-clear {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          font-size: 0.8rem;
          color: #8891A3;
          background: none;
          border: none;
          cursor: pointer;
          padding: 0.3rem 0;
        }
        .wsd-clear:hover { color: #E8E6DF; }

        /* Content */
        .wsd-content {
          max-width: 1100px;
          margin: 0 auto;
          padding: 1.75rem 1.25rem 0;
        }

        .wsd-section { margin-bottom: 2.2rem; }
        .wsd-section-head {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          margin-bottom: 0.9rem;
        }
        .wsd-section-dot {
          width: 9px; height: 9px; border-radius: 50%;
          flex-shrink: 0;
        }
        .wsd-section-title {
          font-family: 'Fraunces', serif;
          font-weight: 600;
          font-size: 1.25rem;
          color: #F3F1E9;
        }
        .wsd-section-count {
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.72rem;
          color: #5B6478;
        }

        .wsd-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 0.9rem;
        }

        .wsd-card {
          background: #161D2E;
          border: 1px solid rgba(255,255,255,0.07);
          border-left: 3px solid var(--accent);
          border-radius: 10px;
          padding: 1.1rem 1.15rem;
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
          transition: border-color 0.15s ease;
        }
        .wsd-card:hover { border-color: rgba(255,255,255,0.18); }

        .wsd-card-top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 0.6rem;
        }
        .wsd-card-title {
          font-family: 'Inter', sans-serif;
          font-weight: 600;
          font-size: 0.98rem;
          line-height: 1.35;
          color: #F0EFE9;
        }
        .wsd-star-btn {
          background: none;
          border: none;
          cursor: pointer;
          color: #5B6478;
          flex-shrink: 0;
          padding: 0.1rem;
        }
        .wsd-star-btn.active { color: #D4A24C; }

        .wsd-card-summary {
          font-size: 0.85rem;
          color: #A9B0BF;
          line-height: 1.55;
        }

        .wsd-card-meta {
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.7rem;
          color: #5B6478;
          display: flex;
          justify-content: space-between;
          gap: 0.5rem;
          margin-top: 0.1rem;
        }

        .wsd-card-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem;
        }
        .wsd-tag {
          font-size: 0.68rem;
          padding: 0.2rem 0.5rem;
          border-radius: 5px;
          background: rgba(255,255,255,0.05);
          color: #8891A3;
        }
        .wsd-tag.company {
          background: rgba(212,162,76,0.1);
          color: #D4A24C;
        }

        .wsd-card-link {
          font-family: 'Inter', sans-serif;
          font-size: 0.78rem;
          font-weight: 600;
          color: #4A9DB8;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
          margin-top: 0.1rem;
        }
        .wsd-card-link:hover { text-decoration: underline; }

        .wsd-empty {
          text-align: center;
          padding: 4rem 1rem;
          color: #5B6478;
        }
        .wsd-empty svg { margin-bottom: 0.75rem; opacity: 0.5; }

        .wsd-footer {
          max-width: 1100px;
          margin: 2rem auto 0;
          padding: 1.25rem 1.25rem 0;
          border-top: 1px solid rgba(255,255,255,0.07);
          font-size: 0.75rem;
          color: #5B6478;
          line-height: 1.6;
        }
      `}</style>

      <header className="wsd-header">
        <div className="wsd-eyebrow">Resumo diário · Bolsas dos EUA</div>
        <h1 className="wsd-title">Wall Street Desk</h1>
        <p className="wsd-subtitle">
          Sempre que abres a app, é feita uma pesquisa em direto nos principais sites de
          bolsa — Bloomberg, CNBC, Reuters, Yahoo Finance, MarketWatch, Wall Street
          Journal e Seeking Alpha — e o resumo é organizado por tipologia de notícia.
        </p>

        <div className="wsd-status-row">
          <button
            className="wsd-refresh-btn"
            onClick={() => fetchLatestNews(true)}
            disabled={loading}
          >
            <RefreshCw size={13} className={loading ? "spin" : ""} />
            {loading ? "A procurar…" : "Atualizar agora"}
          </button>
          {!loading && lastUpdated && (
            <span className="wsd-status-text">Atualizado {timeAgo(lastUpdated)}</span>
          )}
          {!loading && !lastUpdated && !error && (
            <span className="wsd-status-text">Ainda sem pesquisa feita</span>
          )}
        </div>

        {error && (
          <div className="wsd-error-banner">
            <AlertCircle size={15} />
            <span>{error}</span>
          </div>
        )}
      </header>

      {headlineTicker.length > 0 && (
        <div className="wsd-ticker-wrap">
          <div className="wsd-ticker-track">
            {[0, 1].map((rep) => (
              <div key={rep} style={{ display: "flex" }}>
                {headlineTicker.map((it, idx) => (
                  <div className="wsd-ticker-item" key={`${rep}-${idx}`}>
                    <b>{it.source}</b>
                    <span>{it.title}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="wsd-controls">
        <div className="wsd-search">
          <Search size={16} />
          <input
            type="text"
            placeholder="Nome da empresa ou ticker (ex: Nvidia, TSLA)…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") searchCompanyNews(query);
            }}
          />
          {query && (
            <button
              onClick={() => {
                setQuery("");
                if (companyResults) clearCompanySearch();
              }}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#5B6478" }}
              aria-label="Limpar pesquisa"
            >
              <X size={15} />
            </button>
          )}
          {query.trim() && (
            <button
              className="wsd-company-search-btn"
              onClick={() => searchCompanyNews(query)}
              disabled={companyLoading}
            >
              {companyLoading ? "A procurar…" : `Procurar "${query.trim()}"`}
            </button>
          )}
        </div>

        <div className="wsd-cat-row">
          <button
            className={`wsd-cat-btn ${activeCategory === "all" ? "active" : ""}`}
            onClick={() => setActiveCategory("all")}
          >
            Todos
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              className={`wsd-cat-btn ${activeCategory === cat.id ? "active" : ""}`}
              onClick={() => setActiveCategory(cat.id)}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="wsd-util-row">
          <div className="wsd-theme-row">
            {allThemes.map((theme) => (
              <button
                key={theme}
                className={`wsd-chip ${activeThemes.includes(theme) ? "active" : ""}`}
                onClick={() => toggleTheme(theme)}
              >
                {theme}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <button
              className={`wsd-bookmark-toggle ${showBookmarkedOnly ? "active" : ""}`}
              onClick={() => setShowBookmarkedOnly((v) => !v)}
            >
              <Star size={13} fill={showBookmarkedOnly ? "#D4A24C" : "none"} />
              Guardadas ({bookmarks.length})
            </button>
            {hasActiveFilters && (
              <button className="wsd-clear" onClick={clearFilters}>
                <RotateCcw size={13} /> Limpar filtros
              </button>
            )}
          </div>
        </div>
      </div>

      <main className="wsd-content">
        {(companyLoading || companyResults || companyError) && (
          <div className="wsd-company-section">
            <div className="wsd-company-head">
              <span className="wsd-company-title">
                {companyLoading
                  ? `A procurar notícias sobre "${companySearchTerm}"…`
                  : `Notícias sobre "${companySearchTerm}"${companyResults ? ` (${companyResults.length})` : ""}`}
              </span>
              <button className="wsd-company-back" onClick={clearCompanySearch}>
                <X size={13} /> Voltar ao resumo diário
              </button>
            </div>

            {companyLoading && (
              <div className="wsd-empty" style={{ padding: "2rem 1rem" }}>
                <RefreshCw size={22} className="spin" />
              </div>
            )}

            {companyError && !companyLoading && (
              <div className="wsd-error-banner" style={{ marginTop: 0 }}>
                <AlertCircle size={15} />
                <span>{companyError}</span>
              </div>
            )}

            {!companyLoading && companyResults && (
              <div className="wsd-grid">
                {companyResults.map((item) => {
                  const catMeta = CATEGORIES.find((c) => c.id === item.category) || CATEGORIES[4];
                  return (
                    <article className="wsd-card" style={{ "--accent": catMeta.accent }} key={item.id}>
                      <div className="wsd-card-top">
                        <div className="wsd-card-title">{item.title}</div>
                        <button
                          className={`wsd-star-btn ${bookmarks.includes(item.id) ? "active" : ""}`}
                          onClick={() => toggleBookmark(item.id)}
                          aria-label="Guardar notícia"
                        >
                          <Star size={17} fill={bookmarks.includes(item.id) ? "#D4A24C" : "none"} />
                        </button>
                      </div>
                      <p className="wsd-card-summary">{item.summary}</p>
                      <div className="wsd-card-tags">
                        {(item.companies || []).map((c) => (
                          <span className="wsd-tag company" key={c}>{c}</span>
                        ))}
                        {(item.themes || []).map((t) => (
                          <span className="wsd-tag" key={t}>{t}</span>
                        ))}
                      </div>
                      {item.url && (
                        <a
                          className="wsd-card-link"
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Ler notícia completa <ExternalLink size={12} />
                        </a>
                      )}
                      <div className="wsd-card-meta">
                        <span>{item.source}</span>
                        <span>{item.time}</span>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {loading && items === FALLBACK_ITEMS ? (
          <div className="wsd-empty">
            <RefreshCw size={28} className="spin" />
            <p>A procurar as notícias mais recentes sobre as bolsas dos EUA…</p>
          </div>
        ) : grouped.length === 0 ? (
          <div className="wsd-empty">
            <Newspaper size={32} />
            <p>Sem notícias para estes filtros. Tenta limpar a pesquisa ou os temas selecionados.</p>
          </div>
        ) : (
          grouped.map((cat) => (
            <section className="wsd-section" key={cat.id}>
              <div className="wsd-section-head">
                <span className="wsd-section-dot" style={{ background: cat.accent }} />
                <h2 className="wsd-section-title">{cat.label}</h2>
                <span className="wsd-section-count">{cat.items.length} notícia{cat.items.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="wsd-grid">
                {cat.items.map((item) => (
                  <article className="wsd-card" style={{ "--accent": cat.accent }} key={item.id}>
                    <div className="wsd-card-top">
                      <div className="wsd-card-title">{item.title}</div>
                      <button
                        className={`wsd-star-btn ${bookmarks.includes(item.id) ? "active" : ""}`}
                        onClick={() => toggleBookmark(item.id)}
                        aria-label="Guardar notícia"
                      >
                        <Star size={17} fill={bookmarks.includes(item.id) ? "#D4A24C" : "none"} />
                      </button>
                    </div>
                    <p className="wsd-card-summary">{item.summary}</p>
                    <div className="wsd-card-tags">
                      {(item.companies || []).map((c) => (
                        <span className="wsd-tag company" key={c}>{c}</span>
                      ))}
                      {(item.themes || []).map((t) => (
                        <span className="wsd-tag" key={t}>{t}</span>
                      ))}
                    </div>
                    {item.url && (
                      <a
                        className="wsd-card-link"
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Ler notícia completa <ExternalLink size={12} />
                      </a>
                    )}
                    <div className="wsd-card-meta">
                      <span>{item.source}</span>
                      <span>{item.time}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))
        )}
      </main>

      <footer className="wsd-footer">
        Snapshot gerado por pesquisa em direto na web, informativo — não constitui
        aconselhamento financeiro. Confirma sempre os factos importantes na fonte
        original antes de tomar decisões. As notícias guardadas (★) e o cache diário
        ficam gravados neste dispositivo.
      </footer>
    </div>
  );
}
