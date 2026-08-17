// nyt-scraper-api.js
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

// User-Agent to avoid blocks
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Config
const CONFIG = {
  homepage: 'https://www.nytimes.com/',
  maxArticles: 10, // Limit to avoid rate limiting
  timeout: 10000,
  delayBetweenRequests: 1000 // 1 second delay
};

/**
 * Delay helper
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetch HTML with headers
 */
const fetchHTML = async (url) => {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: CONFIG.timeout
    });
    return response.data;
  } catch (error) {
    console.error(`Error fetching ${url}:`, error.message);
    return null;
  }
};

/**
 * Extract article links from homepage
 */
const extractArticleLinks = (html) => {
  const $ = cheerio.load(html);
  const articles = [];

  // Find all article containers
  $('div.story-wrapper, div[data-tpl="sli"]').each((i, element) => {
    if (articles.length >= CONFIG.maxArticles) return false;

    const $el = $(element);
    
    // Find the main link
    const $link = $el.find('a[data-tpl="l"], a.tpl-lbl');
    const href = $link.attr('href');
    
    // Skip if no href or not a valid article
    if (!href || !href.includes('/2026/') || href.includes('/live/')) {
      return;
    }

    // Get headline
    const headline = $link.find('p.indicate-hover').text().trim() || 
                    $link.text().trim();

    // Get summary
    const summary = $el.find('p.summary-class, .css-sarx3u p').text().trim();

    // Get read time
    const readTime = $el.find('p[data-ttr]').text().trim() || 
                     $el.find('.css-e6rebf').text().trim();

    // Get "LIVE" badge
    const isLive = $el.find('span.css-1cn1oj4:contains("LIVE")').length > 0;

    // Get timestamp if available
    const timestamp = $el.find('time').attr('datetime') || '';

    // Build full URL
    const fullUrl = href.startsWith('http') ? href : `https://www.nytimes.com${href}`;

    // Skip duplicates
    if (articles.some(a => a.url === fullUrl)) return;

    articles.push({
      url: fullUrl,
      headline,
      summary,
      readTime,
      isLive,
      timestamp,
      publishedDate: timestamp ? new Date(timestamp).toISOString() : null
    });
  });

  return articles;
};

/**
 * Extract article content
 */
const extractArticleContent = (html, url) => {
  const $ = cheerio.load(html);
  
  // Remove unwanted elements
  $('script, style, noscript, iframe, .css-1r9ysjz, .css-ntag6f, [data-testid="StandardAd"]').remove();

  // Get headline (multiple possible selectors)
  const headline = $('h1[data-testid="headline"], h1.css-1jxfp2t, h1.e1jsehar0').text().trim() || 
                   $('h1').first().text().trim();

  // Get byline/author
  const byline = $('a[data-testid="byline"], span.css-1baulvz a').text().trim() || '';

  // Get published date
  const publishedDate = $('time[data-testid="timestamp"]').attr('datetime') || 
                        $('time').first().attr('datetime') || '';

  // Get article body
  const bodySelectors = [
    'section[name="articleBody"] p',
    'div[data-testid="article-body"] p',
    '.css-1fanzo5 p',
    '.css-53u6y8 p',
    'article p'
  ];

  let paragraphs = [];
  for (const selector of bodySelectors) {
    const found = $(selector);
    if (found.length > 0) {
      paragraphs = found.map((i, el) => $(el).text().trim()).get();
      break;
    }
  }

  // Fallback: get all paragraphs not in header/footer
  if (paragraphs.length === 0) {
    paragraphs = $('p').map((i, el) => {
      const text = $(el).text().trim();
      if (text.length > 50 && !$(el).closest('header, footer, nav').length) {
        return text;
      }
      return null;
    }).get().filter(Boolean);
  }

  // Get main image
  const imageUrl = $('figure picture img, figure img, .css-1qj0kt9 img, .css-1ovi921 img')
    .first()
    .attr('src') || '';

  // Get image caption
  const imageCaption = $('figure figcaption, .css-1p5yz2j').text().trim() || '';

  // Get word count estimate
  const wordCount = paragraphs.join(' ').split(/\s+/).length;

  return {
    headline,
    byline,
    publishedDate,
    paragraphs: paragraphs.slice(0, 50), // Limit to 50 paragraphs
    wordCount,
    imageUrl,
    imageCaption,
    contentPreview: paragraphs.join(' ').slice(0, 500) + '...',
    url
  };
};

/**
 * Main API endpoint
 */
app.get('/api/nyt', async (req, res) => {
  try {
    // 1. Fetch homepage
    console.log('📰 Fetching NYT homepage...');
    const homepageHtml = await fetchHTML(CONFIG.homepage);
    
    if (!homepageHtml) {
      return res.status(500).json({ error: 'Failed to fetch homepage' });
    }

    // 2. Extract article links
    console.log('🔍 Extracting article links...');
    const articles = extractArticleLinks(homepageHtml);
    
    if (articles.length === 0) {
      return res.status(404).json({ error: 'No articles found' });
    }

    console.log(`✅ Found ${articles.length} articles`);

    // 3. Fetch each article (with optional depth parameter)
    const depth = parseInt(req.query.depth) || 0; // 0 = links only, 1 = partial, 2 = full content
    const maxFetch = parseInt(req.query.limit) || CONFIG.maxArticles;

    let results = [];
    let fetchCount = 0;

    for (const article of articles) {
      if (fetchCount >= maxFetch) break;
      if (depth === 0) {
        // Just return the article metadata
        results.push(article);
      } else {
        // Fetch article content
        console.log(`📄 Fetching article ${fetchCount + 1}/${Math.min(articles.length, maxFetch)}: ${article.headline.slice(0, 40)}...`);
        
        const articleHtml = await fetchHTML(article.url);
        
        if (articleHtml) {
          const content = extractArticleContent(articleHtml, article.url);
          results.push({
            ...article,
            content
          });
        } else {
          results.push({
            ...article,
            content: { error: 'Failed to fetch article content' }
          });
        }
        
        fetchCount++;
        await delay(CONFIG.delayBetweenRequests);
      }
    }

    // 4. Send response
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      totalFound: articles.length,
      totalFetched: results.length,
      depth: depth === 0 ? 'links_only' : depth === 1 ? 'partial' : 'full',
      articles: results
    });

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    config: {
      maxArticles: CONFIG.maxArticles,
      timeout: CONFIG.timeout,
      delay: CONFIG.delayBetweenRequests
    }
  });
});

/**
 * Start server
 */
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║  📰 NYT Scraper API                      ║
║  Running on http://localhost:${PORT}       ║
║                                          ║
║  Endpoints:                              ║
║  - GET /api/nyt                         ║
║    Query params:                        ║
║    ?depth=0|1|2  (default: 0)           ║
║    ?limit=5      (max articles)         ║
║  - GET /health                          ║
╚══════════════════════════════════════════╝
  `);
});

module.exports = app;