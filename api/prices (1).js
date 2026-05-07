// /api/prices.js — Yahoo Finance closing prices proxy
// Avoids CORS issues with direct browser calls

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=3600'); // 1hr cache at edge

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { tickers } = req.query; // ?tickers=MSFT,NVDA,AAPL

  if (!tickers) {
    return res.status(400).json({ error: 'tickers param required. E.g. ?tickers=MSFT,NVDA' });
  }

  const tickerList = tickers.split(',').map(t => t.trim().toUpperCase()).filter(Boolean).slice(0, 20);

  const results = {};
  const errors = {};

  await Promise.all(tickerList.map(async (ticker) => {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d&includePrePost=false`;
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible)',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!r.ok) {
        errors[ticker] = `HTTP ${r.status}`;
        return;
      }

      const data = await r.json();
      const result = data?.chart?.result?.[0];

      if (!result) {
        errors[ticker] = 'No data';
        return;
      }

      const meta = result.meta;
      const quotes = result.indicators?.quote?.[0];
      const timestamps = result.timestamp;

      if (!quotes || !timestamps) {
        errors[ticker] = 'No quotes';
        return;
      }

      // Get last valid close
      const closes = quotes.close;
      let lastClose = null;
      let lastDate = null;

      for (let i = closes.length - 1; i >= 0; i--) {
        if (closes[i] !== null && closes[i] !== undefined) {
          lastClose = closes[i];
          lastDate = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
          break;
        }
      }

      results[ticker] = {
        price: lastClose ? Math.round(lastClose * 100) / 100 : null,
        date: lastDate,
        currency: meta.currency || 'USD',
        name: meta.longName || meta.shortName || ticker,
        change: meta.regularMarketChangePercent ? Math.round(meta.regularMarketChangePercent * 100) / 100 : null,
      };
    } catch (e) {
      errors[ticker] = e.message;
    }
  }));

  return res.status(200).json({
    prices: results,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
    timestamp: new Date().toISOString(),
  });
}
