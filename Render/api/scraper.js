// scraper.js
// EasyRead Scraper - Complete standalone service for Render

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import crypto from 'crypto';

// ============================================
// CONFIGURATION
// ============================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROCESSOR_URL = process.env.PROCESSOR_URL || 'http://localhost:3000/api/processor';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const SCRAPER_INTERVAL = parseInt(process.env.SCRAPER_INTERVAL) || 10000; // 10 seconds
const BATCH_SIZE = parseInt(process.env.SCRAPER_BATCH_SIZE) || 3;
const MAX_RETRIES = parseInt(process.env.SCRAPER_MAX_RETRIES) || 3;
const MIN_WORD_COUNT = 200;
const MAX_WORD_COUNT = 10000;
const REFRESH_INTERVAL_DAYS = 14;

// ============================================
// SUPABASE CLIENT
// ============================================

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// ============================================
// LOGGING
// ============================================

function log(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = {
    info: '📘',
    success: '✅',
    error: '❌',
    warn: '⚠️',
    fetch: '🌐',
    extract: '📄',
    save: '💾',
    process: '⚙️'
  }[type] || '📘';
  console.log(`${timestamp} ${prefix} ${message}`);
}

// ============================================
// MAIN SCRAPER LOOP
// ============================================

async function main() {
  log('🕷️ EasyRead Scraper Started', 'info');
  log(`📦 Batch Size: ${BATCH_SIZE}`, 'info');
  log(`⏱️ Interval: ${SCRAPER_INTERVAL}ms`, 'info');
  log(`🔄 Max Retries: ${MAX_RETRIES}`, 'info');
  log(`📤 Processor: ${PROCESSOR_URL}`, 'info');

  while (true) {
    try {
      await processPendingJobs();
    } catch (error) {
      log(`Scraper loop error: ${error.message}`, 'error');
    }
    await sleep(SCRAPER_INTERVAL);
  }
}

// ============================================
// PROCESS PENDING JOBS
// ============================================

async function processPendingJobs() {
  // Get pending jobs from database
  const { data: jobs, error } = await supabase
    .from('processing_jobs')
    .select('*')
    .eq('status', 'pending')
    .order('started_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    log(`Failed to fetch jobs: ${error.message}`, 'error');
    return;
  }

  if (!jobs || jobs.length === 0) {
    return;
  }

  log(`📋 Found ${jobs.length} pending jobs`, 'info');

  for (const job of jobs) {
    await processJob(job);
  }
}

// ============================================
// PROCESS SINGLE JOB
// ============================================

async function processJob(job) {
  const jobId = job.job_id;
  log(`🔄 Processing job ${jobId}: ${job.url || 'No URL'}`, 'info');

  try {
    // === STAGE 1: FETCH ===
    await updateJobStage(jobId, 'fetch', 'pending');
    const fetchResult = await fetchContent(job.url);
    
    if (!fetchResult.success) {
      await failJob(jobId, 'fetch', fetchResult.error);
      return;
    }
    await updateJobStage(jobId, 'fetch', 'success');
    log(`✅ Fetch successful: ${job.url}`, 'fetch');

    // === STAGE 2: EXTRACT ===
    await updateJobStage(jobId, 'extract', 'pending');
    const extractResult = await extractContent(fetchResult.html, job.url);
    
    if (!extractResult.success) {
      await failJob(jobId, 'extract', extractResult.error);
      return;
    }
    await updateJobStage(jobId, 'extract', 'success');
    log(`✅ Extracted: ${extractResult.wordCount} words, "${extractResult.title}"`, 'extract');

    // === STAGE 3: QUALITY ===
    await updateJobStage(jobId, 'quality', 'pending');
    const qualityResult = checkQuality(extractResult);
    
    if (!qualityResult.success) {
      await failJob(jobId, 'quality', qualityResult.error);
      return;
    }
    await updateJobStage(jobId, 'quality', 'success');
    log(`✅ Quality check passed: ${extractResult.wordCount} words`, 'info');

    // === STAGE 4: DUPLICATE ===
    await updateJobStage(jobId, 'duplicate_check', 'pending');
    const duplicateResult = await checkDuplicate(extractResult.textContent);
    
    if (!duplicateResult.success) {
      await failJob(jobId, 'duplicate_check', duplicateResult.error);
      return;
    }
    await updateJobStage(jobId, 'duplicate_check', 'success');

    if (duplicateResult.isDuplicate) {
      log(`⚠️ Duplicate content found: ${duplicateResult.existingArticle.canonical_title}`, 'warn');
      // Still save but mark as duplicate? Or skip? We'll save with a note.
    }

    // === STAGE 5: STORAGE ===
    await updateJobStage(jobId, 'storage', 'pending');
    const article = await saveArticle(job, extractResult, duplicateResult);
    
    if (!article) {
      await failJob(jobId, 'storage', 'Failed to save article');
      return;
    }
    await updateJobStage(jobId, 'storage', 'success');
    log(`✅ Article saved: ${article.article_id}`, 'save');

    // === STAGE 6: PROCESSING ===
    await updateJobStage(jobId, 'processing', 'pending');
    const processResult = await sendToProcessor(article, job);
    
    if (!processResult.success) {
      await failJob(jobId, 'processing', processResult.error);
      return;
    }
    await updateJobStage(jobId, 'processing', 'success');
    log(`✅ Sent to processor: ${article.article_id}`, 'process');

    // === STAGE 7: EMBEDDING ===
    // (Handled by processor, but we track it)
    await updateJobStage(jobId, 'embedding', 'pending');

    // === STAGE 8: COMPLETE ===
    await completeJob(jobId, article.article_id);
    log(`✅ Job ${jobId} completed successfully`, 'success');

  } catch (error) {
    log(`❌ Job ${jobId} failed: ${error.message}`, 'error');
    await failJob(jobId, 'error', error.message);
  }
}

// ============================================
// STAGE 1: FETCH CONTENT
// ============================================

async function fetchContent(url) {
  if (!url) {
    return { success: false, error: 'No URL provided' };
  }

  // Validate URL
  try {
    new URL(url);
  } catch {
    return { success: false, error: 'Invalid URL format' };
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      log(`🌐 Fetching: ${url} (attempt ${attempt}/${MAX_RETRIES})`, 'fetch');

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive'
        },
        timeout: 30000
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      const contentType = response.headers.get('content-type') || '';

      // Check if it's HTML
      if (!contentType.includes('text/html') && !html.trim().startsWith('<!DOCTYPE')) {
        return { success: false, error: 'Not an HTML page' };
      }

      return { success: true, html, url, statusCode: response.status };

    } catch (error) {
      log(`Fetch attempt ${attempt} failed: ${error.message}`, 'warn');
      if (attempt === MAX_RETRIES) {
        return { success: false, error: error.message };
      }
      await sleep(2000 * attempt); // Exponential backoff
    }
  }
}

// ============================================
// STAGE 2: EXTRACT CONTENT
// ============================================

async function extractContent(html, url) {
  try {
    const $ = cheerio.load(html);

    // --- Extract Title ---
    let title = $('title').first().text().trim();
    if (!title) {
      title = $('h1').first().text().trim() || 'Untitled';
    }

    // --- Extract Meta Description ---
    let description = $('meta[name="description"]').attr('content') || '';
    description = description.trim();

    // --- Remove Noise Elements ---
    const noiseSelectors = [
      'script', 'style', 'noscript', 'iframe',
      'nav', 'header', 'footer',
      '.ad', '.ads', '.advertisement', '.adsbygoogle',
      '.social-share', '.share-buttons', '.sharing',
      '.comments', '.comment-section', '.comment-list',
      '.sidebar', '.side-bar', '.widget-area',
      '.newsletter', '.subscribe', '.subscription',
      '.cookie-banner', '.cookie-consent', '.cookie-notice',
      '.popup', '.modal', '.overlay',
      '.related-posts', '.similar-posts', '.recommended',
      '.author-bio', '.about-author', '.about-the-author',
      '.breadcrumb', '.breadcrumbs'
    ];
    $(noiseSelectors.join(',')).remove();

    // Remove empty elements
    $('*').each((i, el) => {
      if ($(el).text().trim() === '' && $(el).children().length === 0) {
        $(el).remove();
      }
    });

    // --- Find Main Content ---
    let mainContent = null;
    const contentSelectors = [
      'article', '.article', '.post',
      '.post-content', '.post-content-area',
      '.entry-content', '.entry-content-area',
      '.content-main', '.content',
      '.read-content-box', '.center-sec',
      '.single-content', '.page-content',
      'main', '#main-content', '#content'
    ];

    for (const selector of contentSelectors) {
      const el = $(selector);
      if (el.length > 0 && el.text().trim().length > 100) {
        mainContent = el;
        break;
      }
    }

    if (!mainContent || mainContent.text().trim().length < 100) {
      mainContent = $('body');
    }

    // --- Extract Text ---
    let textContent = mainContent.text()
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();

    if (textContent.length < 100) {
      textContent = $('body').text()
        .replace(/\s+/g, ' ')
        .replace(/\n\s*\n/g, '\n\n')
        .trim();
    }

    // --- Extract HTML ---
    let htmlContent = mainContent.html() || '';

    // Clean up HTML
    htmlContent = htmlContent
      .replace(/\s+/g, ' ')
      .replace(/>\s+</g, '><')
      .trim();

    // --- Calculate Word Count ---
    const wordCount = textContent.split(/\s+/).filter(w => w.length > 0).length;

    // --- Extract Domain ---
    let domain = '';
    try {
      const urlObj = new URL(url);
      domain = urlObj.hostname.replace('www.', '');
    } catch {
      domain = '';
    }

    // --- Extract Published Date ---
    let publishedAt = null;
    const dateSelectors = [
      'meta[property="article:published_time"]',
      'meta[name="article.published"]',
      'meta[name="pubdate"]',
      'meta[name="publish_date"]',
      'time[datetime]',
      '.published-date',
      '.post-date',
      '.entry-date'
    ];

    for (const selector of dateSelectors) {
      const el = $(selector);
      if (el.length > 0) {
        const dateAttr = el.attr('content') || el.attr('datetime') || '';
        if (dateAttr) {
          const parsedDate = new Date(dateAttr);
          if (!isNaN(parsedDate)) {
            publishedAt = parsedDate.toISOString();
            break;
          }
        }
        const dateText = el.text().trim();
        if (dateText) {
          const parsedDate = new Date(dateText);
          if (!isNaN(parsedDate)) {
            publishedAt = parsedDate.toISOString();
          }
        }
      }
    }

    // If no date found, use current date
    if (!publishedAt) {
      // Try to find any date pattern in the content
      const dateMatch = textContent.match(/(\d{1,2}\s+\w+\s+\d{4}|\d{4}-\d{2}-\d{2}|\w+\s+\d{1,2},?\s+\d{4})/i);
      if (dateMatch) {
        const parsedDate = new Date(dateMatch[0]);
        if (!isNaN(parsedDate)) {
          publishedAt = parsedDate.toISOString();
        }
      }
    }

    return {
      success: true,
      title,
      description,
      textContent,
      htmlContent: htmlContent.substring(0, 50000),
      wordCount,
      domain,
      url,
      publishedAt
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================
// STAGE 3: QUALITY CHECK
// ============================================

function checkQuality(extractResult) {
  const { wordCount, textContent, title } = extractResult;

  // Check minimum words
  if (wordCount < MIN_WORD_COUNT) {
    return {
      success: false,
      error: `Content too short: ${wordCount} words (minimum ${MIN_WORD_COUNT})`
    };
  }

  // Check for meaningful content (not just gibberish)
  const words = textContent.split(/\s+/).filter(w => w.length > 2);
  const uniqueWords = new Set(words);
  
  if (uniqueWords.size < 10) {
    return {
      success: false,
      error: 'Content lacks meaningful vocabulary (too few unique words)'
    };
  }

  // Check for duplicate content (repetitive text)
  const wordFrequency = {};
  let totalWords = 0;
  for (const word of words) {
    wordFrequency[word] = (wordFrequency[word] || 0) + 1;
    totalWords++;
  }

  // If a single word appears too often (>30% of content), might be spam
  const maxFrequency = Math.max(...Object.values(wordFrequency));
  if (maxFrequency / totalWords > 0.3) {
    return {
      success: false,
      error: 'Content appears to be spam or keyword-stuffed'
    };
  }

  // Determine processing mode
  let processingMode = 'normal';
  if (wordCount > 10000 && wordCount <= 50000) {
    processingMode = 'inspect';
  } else if (wordCount > 50000) {
    processingMode = 'chunk';
  }

  return {
    success: true,
    wordCount,
    processingMode,
    quality: wordCount >= 1000 ? 'high' : 'medium',
    uniqueWords: uniqueWords.size
  };
}

// ============================================
// STAGE 4: DUPLICATE CHECK
// ============================================

async function checkDuplicate(textContent) {
  try {
    const contentHash = generateHash(textContent);

    const { data: existing, error } = await supabase
      .from('articles')
      .select('article_id, canonical_title, slug, content_hash, version, retrieved_at')
      .eq('content_hash', contentHash)
      .limit(1);

    if (error) throw error;

    if (existing && existing.length > 0) {
      return {
        success: true,
        isDuplicate: true,
        contentHash,
        existingArticle: existing[0]
      };
    }

    return {
      success: true,
      isDuplicate: false,
      contentHash
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================
// STAGE 5: SAVE ARTICLE
// ============================================

async function saveArticle(job, extractResult, duplicateResult) {
  try {
    const { title, textContent, htmlContent, domain, url, publishedAt, wordCount } = extractResult;
    const { contentHash, isDuplicate, existingArticle } = duplicateResult;

    // Generate slug
    const slug = generateSlug(title);

    // Check if slug exists
    let finalSlug = slug;
    let counter = 1;
    while (true) {
      const { data: existing } = await supabase
        .from('articles')
        .select('slug')
        .eq('slug', finalSlug)
        .limit(1);
      
      if (!existing || existing.length === 0) break;
      finalSlug = `${slug}-${counter}`;
      counter++;
    }

    // Determine processing mode
    let processingMode = 'normal';
    if (wordCount > 10000 && wordCount <= 50000) {
      processingMode = 'inspect';
    } else if (wordCount > 50000) {
      processingMode = 'chunk';
    }

    // Detect categories
    const categories = await detectCategories(title, textContent);

    // If duplicate, check if content has changed
    if (isDuplicate && existingArticle) {
      log(`📋 Updating existing article ${existingArticle.article_id} (version ${existingArticle.version})`, 'warn');

      // Check if content has changed (simple check - if word count differs significantly)
      const existingWordCount = (textContent.split(/\s+/).length);
      if (Math.abs(existingWordCount - wordCount) > 500) {
        // Content changed, create new version
        await supabase
          .from('article_versions')
          .insert({
            article_id: existingArticle.article_id,
            content: textContent,
            source_snapshot: {
              html: htmlContent,
              url: url,
              scraped_at: new Date().toISOString()
            },
            change_reason: 'Content updated'
          });

        // Update article
        const { data: updated, error: updateError } = await supabase
          .from('articles')
          .update({
            base_content: textContent,
            word_count: wordCount,
            version: existingArticle.version + 1,
            updated_at: new Date().toISOString(),
            next_refresh_at: new Date(Date.now() + REFRESH_INTERVAL_DAYS * 24 * 60 * 60 * 1000).toISOString()
          })
          .eq('article_id', existingArticle.article_id)
          .select()
          .single();

        if (updateError) throw updateError;
        return updated;
      }

      // No changes, just update refresh date
      await supabase
        .from('articles')
        .update({
          retrieved_at: new Date().toISOString(),
          next_refresh_at: new Date(Date.now() + REFRESH_INTERVAL_DAYS * 24 * 60 * 60 * 1000).toISOString()
        })
        .eq('article_id', existingArticle.article_id);

      return existingArticle;
    }

    // Create new article
    const { data: article, error: insertError } = await supabase
      .from('articles')
      .insert({
        canonical_title: title,
        slug: finalSlug,
        base_content: textContent,
        summary: '', // Will be filled by processor
        source_url: url,
        source_domain: domain,
        categories: categories,
        content_hash: contentHash,
        word_count: wordCount,
        version: 1,
        status: 'processing',
        source_title: title,
        source_published_at: publishedAt,
        retrieved_at: new Date().toISOString(),
        next_refresh_at: new Date(Date.now() + REFRESH_INTERVAL_DAYS * 24 * 60 * 60 * 1000).toISOString()
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // Save version
    await supabase
      .from('article_versions')
      .insert({
        article_id: article.article_id,
        content: textContent,
        source_snapshot: {
          html: htmlContent,
          url: url,
          scraped_at: new Date().toISOString()
        },
        change_reason: 'Initial scrape'
      });

    // Update job with article_id
    await supabase
      .from('processing_jobs')
      .update({ article_id: article.article_id })
      .eq('job_id', job.job_id);

    return article;

  } catch (error) {
    log(`Save error: ${error.message}`, 'error');
    return null;
  }
}

// ============================================
// STAGE 6: SEND TO PROCESSOR
// ============================================

async function sendToProcessor(article, job) {
  try {
    log(`📤 Sending article ${article.article_id} to processor...`, 'process');

    // Determine processing mode based on word count
    let processingMode = 'normal';
    if (article.word_count > 10000 && article.word_count <= 50000) {
      processingMode = 'inspect';
    } else if (article.word_count > 50000) {
      processingMode = 'chunk';
    }

    const payload = {
      article_id: article.article_id,
      job_id: job.job_id,
      content: article.base_content,
      title: article.canonical_title,
      url: article.source_url,
      domain: article.source_domain,
      word_count: article.word_count,
      processing_mode: processingMode,
      categories: article.categories
    };

    const response = await fetch(PROCESSOR_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': ADMIN_API_KEY || ''
      },
      body: JSON.stringify(payload),
      timeout: 60000 // 60 seconds
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Processor returned ${response.status}: ${text.substring(0, 100)}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Processor failed');
    }

    return { success: true, result };

  } catch (error) {
    log(`Processor error: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
}

// ============================================
// JOB STATUS FUNCTIONS
// ============================================

async function updateJobStage(jobId, stage, status) {
  try {
    // Get current job stages
    const { data: job, error } = await supabase
      .from('processing_jobs')
      .select('stages')
      .eq('job_id', jobId)
      .single();

    if (error) throw error;

    const stages = job.stages || {};
    stages[stage] = status;

    await supabase
      .from('processing_jobs')
      .update({
        current_stage: stage,
        stages: stages
      })
      .eq('job_id', jobId);

    // Log stage change (only for debug)
    // log(`Job ${jobId}: ${stage} → ${status}`, 'info');

  } catch (error) {
    log(`Failed to update job stage: ${error.message}`, 'warn');
  }
}

async function failJob(jobId, stage, error) {
  try {
    log(`❌ Job ${jobId} failed at ${stage}: ${error}`, 'error');

    await supabase
      .from('processing_jobs')
      .update({
        status: 'failed',
        current_stage: stage,
        error: error,
        completed_at: new Date().toISOString()
      })
      .eq('job_id', jobId);

  } catch (err) {
    log(`Failed to mark job as failed: ${err.message}`, 'error');
  }
}

async function completeJob(jobId, articleId) {
  try {
    await supabase
      .from('processing_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('job_id', jobId);

    log(`✅ Job ${jobId} completed (article: ${articleId})`, 'success');

  } catch (error) {
    log(`Failed to complete job: ${error.message}`, 'error');
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function generateHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100);
}

async function detectCategories(title, content) {
  // First, try to get existing categories from database
  const { data: existingCategories } = await supabase
    .from('system_config')
    .select('value')
    .eq('key', 'category_metadata')
    .single();

  let categoryMap = {};
  if (existingCategories) {
    categoryMap = existingCategories.value || {};
  }

  // If we have existing categories, try to match
  const existingCategoryNames = Object.keys(categoryMap);
  
  if (existingCategoryNames.length > 0) {
    // Simple keyword matching against existing categories
    const text = `${title} ${content}`.toLowerCase();
    const matched = [];
    for (const category of existingCategoryNames) {
      // Check if category appears in content
      if (text.includes(category.toLowerCase())) {
        matched.push(category);
      }
      // Check aliases
      if (categoryMap[category]?.aliases) {
        for (const alias of categoryMap[category].aliases) {
          if (text.includes(alias.toLowerCase())) {
            matched.push(category);
            break;
          }
        }
      }
    }
    if (matched.length > 0) {
      return matched.slice(0, 5);
    }
  }

  // Fallback: Keyword-based detection
  const keywords = {
    'Technology': ['tech', 'software', 'ai', 'machine learning', 'programming', 'code', 'digital', 'computer', 'data', 'algorithm'],
    'Science': ['science', 'research', 'discovery', 'experiment', 'biology', 'physics', 'chemistry', 'astronomy', 'genetics'],
    'Business': ['business', 'finance', 'investment', 'market', 'economy', 'trade', 'company', 'startup', 'entrepreneur'],
    'Health': ['health', 'medical', 'wellness', 'fitness', 'nutrition', 'disease', 'treatment', 'doctor', 'hospital'],
    'Education': ['education', 'learn', 'school', 'university', 'college', 'student', 'teaching', 'study', 'course'],
    'Entertainment': ['entertainment', 'movie', 'film', 'music', 'game', 'stream', 'show', 'tv', 'celebrity'],
    'Sports': ['sport', 'game', 'team', 'player', 'match', 'league', 'tournament', 'coach', 'stadium'],
    'Politics': ['politics', 'government', 'policy', 'election', 'president', 'minister', 'vote', 'congress'],
    'Environment': ['environment', 'climate', 'sustainability', 'renewable', 'green', 'eco', 'nature', 'wildlife'],
    'Finance': ['finance', 'money', 'bank', 'invest', 'saving', 'capital', 'credit', 'loan', 'interest', 'stock']
  };

  const text = `${title} ${content}`.toLowerCase();
  const detected = [];

  for (const [category, terms] of Object.entries(keywords)) {
    for (const term of terms) {
      if (text.includes(term)) {
        detected.push(category);
        break;
      }
    }
  }

  return detected.length > 0 ? detected.slice(0, 5) : ['General'];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// STARTUP
// ============================================

// Handle process signals
process.on('SIGTERM', () => {
  log('Received SIGTERM, shutting down...', 'warn');
  process.exit(0);
});

process.on('SIGINT', () => {
  log('Received SIGINT, shutting down...', 'warn');
  process.exit(0);
});

// Start the scraper
main().catch(error => {
  log(`Fatal error: ${error.message}`, 'error');
  process.exit(1);
});