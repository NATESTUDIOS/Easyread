// api/nyt-scraper.js
// NYT Scraper - Pure scraping API, no database

import { Router } from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const router = Router();

// ============================================
// CONFIGURATION
// ============================================

const NYT_HOMEPAGE = 'https://www.nytimes.com/';
const NYT_MAX_ARTICLES = parseInt(process.env.NYT_MAX_ARTICLES) || 10;
const NYT_DELAY_BETWEEN_REQUESTS = parseInt(process.env.NYT_DELAY) || 1000;
const NYT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES) || 3;

// ============================================
// LOGGING
// ============================================

function log(message, type = "info") {
  const timestamp = new Date().toISOString();
  const prefix = {
    info: "📘",
    success: "✅",
    error: "❌",
    warn: "⚠️",
    fetch: "🌐",
    extract: "📄",
    nyt: "📰"
  }[type] || "📘";
  console.log(`${timestamp} ${prefix} ${message}`);
}

// ============================================
// HELPERS
// ============================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch HTML with proper headers
 */
async function fetchHTML(url, timeout = 30000) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': NYT_USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: timeout
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return await response.text();
    } catch (error) {
      log(`Fetch attempt ${attempt} failed: ${error.message}`, "warn");
      if (attempt === MAX_RETRIES) {
        log(`Failed to fetch ${url}: ${error.message}`, "error");
        return null;
      }
      await sleep(2000 * attempt);
    }
  }
  return null;
}

/**
 * Extract article links from NYT homepage
 */
function extractNYTArticleLinks(html) {
  const $ = cheerio.load(html);
  const articles = [];

  $('div.story-wrapper, div[data-tpl="sli"]').each((i, element) => {
    if (articles.length >= NYT_MAX_ARTICLES) return false;

    const $el = $(element);
    
    const $link = $el.find('a[data-tpl="l"], a.tpl-lbl');
    const href = $link.attr('href');
    
    if (!href) return;
    
    // Skip non-article links
    if (!href.includes('/2026/') && !href.includes('/live/')) {
      return;
    }

    const headline = $link.find('p.indicate-hover').text().trim() || 
                    $link.text().trim();

    const summary = $el.find('p.summary-class, .css-sarx3u p').text().trim();

    const readTime = $el.find('p[data-ttr]').text().trim() || 
                     $el.find('.css-e6rebf').text().trim();

    const isLive = $el.find('span.css-1cn1oj4:contains("LIVE")').length > 0;

    const timestamp = $el.find('time').attr('datetime') || '';

    const fullUrl = href.startsWith('http') ? href : `https://www.nytimes.com${href}`;

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
}

/**
 * Extract full article content
 */
function extractArticleContent(html, url) {
  const $ = cheerio.load(html);
  
  // Remove unwanted elements
  $('script, style, noscript, iframe, .css-1r9ysjz, .css-ntag6f, [data-testid="StandardAd"]').remove();

  const headline = $('h1[data-testid="headline"], h1.css-1jxfp2t, h1.e1jsehar0').text().trim() || 
                   $('h1').first().text().trim();

  const byline = $('a[data-testid="byline"], span.css-1baulvz a').text().trim() || '';

  const publishedDate = $('time[data-testid="timestamp"]').attr('datetime') || 
                        $('time').first().attr('datetime') || '';

  // Extract body paragraphs
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

  // Fallback: get all paragraphs
  if (paragraphs.length === 0) {
    paragraphs = $('p').map((i, el) => {
      const text = $(el).text().trim();
      if (text.length > 50 && !$(el).closest('header, footer, nav').length) {
        return text;
      }
      return null;
    }).get().filter(Boolean);
  }

  const imageUrl = $('figure picture img, figure img, .css-1qj0kt9 img, .css-1ovi921 img')
    .first()
    .attr('src') || '';

  const imageCaption = $('figure figcaption, .css-1p5yz2j').text().trim() || '';

  const fullText = paragraphs.join(' ');
  const wordCount = fullText.split(/\s+/).length;

  return {
    headline: headline || "No headline found",
    byline,
    publishedDate,
    fullText,
    paragraphs: paragraphs.slice(0, 50),
    wordCount,
    imageUrl,
    imageCaption,
    contentPreview: fullText.slice(0, 500) + '...',
    url
  };
}

// ============================================
// ROUTES
// ============================================

/**
 * GET /api/nyt
 * Get articles from NYT homepage
 * 
 * Query params:
 * - depth: 0 = links only, 1 = partial (preview), 2 = full content (default: 1)
 * - limit: max articles to fetch (default: 10)
 */
router.get("/", async (req, res) => {
  const { depth = 1, limit = NYT_MAX_ARTICLES } = req.query;

  const startTime = Date.now();
  log(`📰 NYT scrape started (depth: ${depth}, limit: ${limit})`, "nyt");

  try {
    // 1. Fetch homepage
    log("🌐 Fetching NYT homepage...", "fetch");
    const homepageHtml = await fetchHTML(NYT_HOMEPAGE);
    
    if (!homepageHtml) {
      return res.status(500).json({
        success: false,
        error: "Failed to fetch NYT homepage"
      });
    }

    // 2. Extract article links
    log("🔍 Extracting article links...", "extract");
    const articleLinks = extractNYTArticleLinks(homepageHtml);
    
    if (articleLinks.length === 0) {
      return res.status(404).json({
        success: false,
        error: "No articles found on NYT homepage"
      });
    }

    log(`✅ Found ${articleLinks.length} articles`, "success");

    // 3. Limit articles
    const maxFetch = Math.min(parseInt(limit) || NYT_MAX_ARTICLES, articleLinks.length);
    const articlesToFetch = articleLinks.slice(0, maxFetch);

    let results = [];
    let fetchCount = 0;
    let failedCount = 0;

    // 4. Fetch article content based on depth
    if (parseInt(depth) === 0) {
      // Links only
      results = articlesToFetch;
    } else {
      // Fetch content
      for (const article of articlesToFetch) {
        fetchCount++;
        log(`📄 Fetching article ${fetchCount}/${articlesToFetch.length}: ${article.headline.slice(0, 40)}...`, "fetch");
        
        const articleHtml = await fetchHTML(article.url);
        
        if (articleHtml) {
          const content = extractArticleContent(articleHtml, article.url);
          
          if (parseInt(depth) === 1) {
            // Partial: include preview and metadata
            results.push({
              ...article,
              content: {
                headline: content.headline,
                byline: content.byline,
                publishedDate: content.publishedDate,
                wordCount: content.wordCount,
                contentPreview: content.contentPreview,
                imageUrl: content.imageUrl,
                imageCaption: content.imageCaption,
                paragraphCount: content.paragraphs.length
              }
            });
          } else {
            // Full: include all content
            results.push({
              ...article,
              content: {
                headline: content.headline,
                byline: content.byline,
                publishedDate: content.publishedDate,
                fullText: content.fullText,
                paragraphs: content.paragraphs,
                wordCount: content.wordCount,
                imageUrl: content.imageUrl,
                imageCaption: content.imageCaption
              }
            });
          }
        } else {
          failedCount++;
          results.push({
            ...article,
            error: "Failed to fetch article content"
          });
        }
        
        // Delay between requests to avoid rate limiting
        if (fetchCount < articlesToFetch.length) {
          await sleep(NYT_DELAY_BETWEEN_REQUESTS);
        }
      }
    }

    const elapsedTime = Date.now() - startTime;

    // 5. Send response
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      elapsedTime: `${elapsedTime}ms`,
      totalFound: articleLinks.length,
      totalFetched: results.length,
      totalFailed: failedCount,
      depth: parseInt(depth) === 0 ? 'links_only' : parseInt(depth) === 1 ? 'partial' : 'full',
      articles: results
    });

    log(`✅ Completed in ${elapsedTime}ms`, "success");

  } catch (error) {
    log(`❌ Error: ${error.message}`, "error");
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/nyt/links
 * Get only article links (fastest)
 */
router.get("/links", async (req, res) => {
  const { limit = NYT_MAX_ARTICLES } = req.query;

  try {
    const homepageHtml = await fetchHTML(NYT_HOMEPAGE);
    
    if (!homepageHtml) {
      return res.status(500).json({
        success: false,
        error: "Failed to fetch NYT homepage"
      });
    }

    const articleLinks = extractNYTArticleLinks(homepageHtml);
    const maxFetch = Math.min(parseInt(limit) || NYT_MAX_ARTICLES, articleLinks.length);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      totalFound: articleLinks.length,
      totalReturned: maxFetch,
      articles: articleLinks.slice(0, maxFetch)
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/nyt/article
 * Fetch a single article by URL
 * 
 * Query params:
 * - url: full NYT article URL (required)
 */
router.get("/article", async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({
      success: false,
      error: "URL parameter is required"
    });
  }

  // Validate URL
  try {
    new URL(url);
  } catch {
    return res.status(400).json({
      success: false,
      error: "Invalid URL format"
    });
  }

  try {
    log(`📄 Fetching single article: ${url}`, "fetch");
    const articleHtml = await fetchHTML(url);
    
    if (!articleHtml) {
      return res.status(500).json({
        success: false,
        error: "Failed to fetch article"
      });
    }

    const content = extractArticleContent(articleHtml, url);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      article: {
        url: url,
        ...content
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/nyt/health
 * Health check endpoint
 */
router.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    service: "NYT Scraper API",
    timestamp: new Date().toISOString(),
    config: {
      maxArticles: NYT_MAX_ARTICLES,
      delay: NYT_DELAY_BETWEEN_REQUESTS,
      maxRetries: MAX_RETRIES
    }
  });
});

// ============================================
// EXPORT ROUTER
// ============================================

export default router;