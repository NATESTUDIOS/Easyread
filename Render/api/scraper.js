// api/scraper.js
// EasyRead Scraper - Scraping Route

import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import crypto from "crypto";

const router = Router();

// ============================================
// CONFIGURATION
// ============================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROCESSOR_URL = process.env.PROCESSOR_URL || "http://localhost:3001/api/processor";
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const SCRAPER_INTERVAL = parseInt(process.env.SCRAPER_INTERVAL) || 10000;
const BATCH_SIZE = parseInt(process.env.SCRAPER_BATCH_SIZE) || 3;
const MAX_RETRIES = parseInt(process.env.SCRAPER_MAX_RETRIES) || 3;
const MIN_WORD_COUNT = 200;
const REFRESH_INTERVAL_DAYS = 14;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

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
    save: "💾",
    process: "⚙️"
  }[type] || "📘";
  console.log(`${timestamp} ${prefix} ${message}`);
}

// ============================================
// SCRAPER STATE
// ============================================

let isRunning = false;
let pollInterval = null;
let stats = {
  totalProcessed: 0,
  totalFailed: 0,
  lastRun: null,
  jobsInProgress: 0
};

// ============================================
// ROUTES
// ============================================

router.post("/start", async (req, res) => {
  const apiKey = req.headers["x-admin-key"];

  if (apiKey !== ADMIN_API_KEY) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized"
    });
  }

  if (isRunning) {
    return res.json({
      success: true,
      message: "Scraper already running",
      status: "running"
    });
  }

  await startScraper();
  res.json({
    success: true,
    message: "Scraper started",
    status: "running"
  });
});

router.post("/stop", async (req, res) => {
  const apiKey = req.headers["x-admin-key"];

  if (apiKey !== ADMIN_API_KEY) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized"
    });
  }

  await stopScraper();
  res.json({
    success: true,
    message: "Scraper stopped",
    status: "stopped"
  });
});

router.get("/status", async (req, res) => {
  const status = await getStatus();
  res.json({
    success: true,
    ...status
  });
});

router.post("/run-once", async (req, res) => {
  const apiKey = req.headers["x-admin-key"];

  if (apiKey !== ADMIN_API_KEY) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized"
    });
  }

  const result = await processPendingJobs();
  res.json({
    success: true,
    message: "Scraper run completed",
    jobs_processed: result.processed || 0,
    jobs_failed: result.failed || 0,
    timestamp: new Date().toISOString()
  });
});

// ============================================
// SCRAPER FUNCTIONS
// ============================================

export async function startScraper() {
  if (isRunning) return;

  isRunning = true;
  log("🕷️ Scraper started", "info");
  log(`📦 Batch Size: ${BATCH_SIZE}`, "info");
  log(`⏱️ Interval: ${SCRAPER_INTERVAL}ms`, "info");

  await processPendingJobs();

  pollInterval = setInterval(async () => {
    if (isRunning) {
      await processPendingJobs();
    }
  }, SCRAPER_INTERVAL);
}

export async function stopScraper() {
  isRunning = false;

  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  log("🕷️ Scraper stopped", "info");
}

export async function getStatus() {
  const { count: pending, error: pendingError } = await supabase
    .from("processing_jobs")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");

  const { count: processing, error: processingError } = await supabase
    .from("processing_jobs")
    .select("*", { count: "exact", head: true })
    .eq("status", "processing");

  const { count: failed, error: failedError } = await supabase
    .from("processing_jobs")
    .select("*", { count: "exact", head: true })
    .eq("status", "failed");

  return {
    isRunning,
    stats,
    queue: {
      pending: pending || 0,
      processing: processing || 0,
      failed: failed || 0
    },
    config: {
      batchSize: BATCH_SIZE,
      interval: SCRAPER_INTERVAL,
      maxRetries: MAX_RETRIES
    }
  };
}

export async function processPendingJobs() {
  let processed = 0;
  let failed = 0;

  try {
    const { data: jobs, error } = await supabase
      .from("processing_jobs")
      .select("*")
      .eq("status", "pending")
      .order("started_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (error) {
      log(`Failed to fetch jobs: ${error.message}`, "error");
      return { processed, failed };
    }

    if (!jobs || jobs.length === 0) {
      return { processed, failed };
    }

    log(`📋 Found ${jobs.length} pending jobs`, "info");

    for (const job of jobs) {
      stats.jobsInProgress++;
      const success = await processJob(job);

      if (success) {
        processed++;
        stats.totalProcessed++;
      } else {
        failed++;
        stats.totalFailed++;
      }

      stats.jobsInProgress--;
    }

    stats.lastRun = new Date().toISOString();

  } catch (error) {
    log(`Scraper error: ${error.message}`, "error");
  }

  return { processed, failed };
}

async function processJob(job) {
  const jobId = job.job_id;
  log(`🔄 Processing job ${jobId}: ${job.url || "No URL"}`, "info");

  try {
    // STAGE 1: FETCH
    await updateJobStage(jobId, "fetch", "pending");
    const fetchResult = await fetchContent(job.url);

    if (!fetchResult.success) {
      await failJob(jobId, "fetch", fetchResult.error);
      return false;
    }
    await updateJobStage(jobId, "fetch", "success");

    // STAGE 2: EXTRACT
    await updateJobStage(jobId, "extract", "pending");
    const extractResult = await extractContent(fetchResult.html, job.url);

    if (!extractResult.success) {
      await failJob(jobId, "extract", extractResult.error);
      return false;
    }
    await updateJobStage(jobId, "extract", "success");

    // STAGE 3: QUALITY
    await updateJobStage(jobId, "quality", "pending");
    const qualityResult = checkQuality(extractResult);

    if (!qualityResult.success) {
      await failJob(jobId, "quality", qualityResult.error);
      return false;
    }
    await updateJobStage(jobId, "quality", "success");

    // STAGE 4: DUPLICATE
    await updateJobStage(jobId, "duplicate_check", "pending");
    const duplicateResult = await checkDuplicate(extractResult.textContent);

    if (!duplicateResult.success) {
      await failJob(jobId, "duplicate_check", duplicateResult.error);
      return false;
    }
    await updateJobStage(jobId, "duplicate_check", "success");

    // STAGE 5: STORAGE
    await updateJobStage(jobId, "storage", "pending");
    const article = await saveArticle(job, extractResult, duplicateResult);

    if (!article) {
      await failJob(jobId, "storage", "Failed to save article");
      return false;
    }
    await updateJobStage(jobId, "storage", "success");

    // STAGE 6: PROCESSING
    await updateJobStage(jobId, "processing", "pending");
    const processResult = await sendToProcessor(article, job);

    if (!processResult.success) {
      await failJob(jobId, "processing", processResult.error);
      return false;
    }
    await updateJobStage(jobId, "processing", "success");

    // STAGE 7: EMBEDDING (tracking only)
    await updateJobStage(jobId, "embedding", "pending");

    // STAGE 8: COMPLETE
    await completeJob(jobId, article.article_id);
    log(`✅ Job ${jobId} completed successfully`, "success");

    return true;

  } catch (error) {
    log(`❌ Job ${jobId} failed: ${error.message}`, "error");
    await failJob(jobId, "error", error.message);
    return false;
  }
}

// ============================================
// FETCH CONTENT
// ============================================

async function fetchContent(url) {
  if (!url) return { success: false, error: "No URL provided" };

  try { new URL(url); } catch {
    return { success: false, error: "Invalid URL format" };
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          "Accept-Encoding": "gzip, deflate",
          "Connection": "keep-alive"
        },
        timeout: 30000
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      const contentType = response.headers.get("content-type") || "";

      if (!contentType.includes("text/html") && !html.trim().startsWith("<!DOCTYPE")) {
        return { success: false, error: "Not an HTML page" };
      }

      return { success: true, html, url, statusCode: response.status };

    } catch (error) {
      log(`Fetch attempt ${attempt} failed: ${error.message}`, "warn");
      if (attempt === MAX_RETRIES) {
        return { success: false, error: error.message };
      }
      await sleep(2000 * attempt);
    }
  }
}

// ============================================
// EXTRACT CONTENT
// ============================================

async function extractContent(html, url) {
  try {
    const $ = cheerio.load(html);

    // Title
    let title = $("title").first().text().trim() || $("h1").first().text().trim() || "Untitled";

    // Remove noise
    const noiseSelectors = [
      "script", "style", "noscript", "iframe",
      "nav", "header", "footer",
      ".ad", ".ads", ".advertisement", ".adsbygoogle",
      ".social-share", ".share-buttons", ".sharing",
      ".comments", ".comment-section", ".comment-list",
      ".sidebar", ".side-bar", ".widget-area",
      ".newsletter", ".subscribe", ".subscription",
      ".cookie-banner", ".cookie-consent", ".cookie-notice",
      ".popup", ".modal", ".overlay",
      ".related-posts", ".similar-posts", ".recommended",
      ".author-bio", ".about-author", ".about-the-author"
    ];
    $(noiseSelectors.join(",")).remove();

    // Find main content
    let mainContent = null;
    const contentSelectors = [
      "article", ".article", ".post",
      ".post-content", ".post-content-area",
      ".entry-content", ".entry-content-area",
      ".content-main", ".content",
      ".read-content-box", ".center-sec",
      "main", "#main-content", "#content"
    ];

    for (const selector of contentSelectors) {
      const el = $(selector);
      if (el.length > 0 && el.text().trim().length > 100) {
        mainContent = el;
        break;
      }
    }

    if (!mainContent || mainContent.text().trim().length < 100) {
      mainContent = $("body");
    }

    // Extract text
    let textContent = mainContent.text()
      .replace(/\s+/g, " ")
      .replace(/\n\s*\n/g, "\n\n")
      .trim();

    if (textContent.length < 100) {
      textContent = $("body").text()
        .replace(/\s+/g, " ")
        .replace(/\n\s*\n/g, "\n\n")
        .trim();
    }

    // HTML content
    let htmlContent = (mainContent.html() || "")
      .replace(/\s+/g, " ")
      .replace(/>\s+</g, "><")
      .trim();

    // Word count
    const wordCount = textContent.split(/\s+/).filter(w => w.length > 0).length;

    // Domain
    let domain = "";
    try { domain = new URL(url).hostname.replace("www.", ""); } catch {}

    // Published date
    let publishedAt = null;
    const dateSelectors = [
      'meta[property="article:published_time"]',
      'meta[name="article.published"]',
      'meta[name="pubdate"]',
      'time[datetime]',
      ".published-date",
      ".post-date"
    ];

    for (const selector of dateSelectors) {
      const el = $(selector);
      if (el.length > 0) {
        const dateAttr = el.attr("content") || el.attr("datetime") || "";
        if (dateAttr) {
          const parsedDate = new Date(dateAttr);
          if (!isNaN(parsedDate)) {
            publishedAt = parsedDate.toISOString();
            break;
          }
        }
      }
    }

    return {
      success: true,
      title,
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
// QUALITY CHECK
// ============================================

function checkQuality(extractResult) {
  const { wordCount, textContent } = extractResult;

  if (wordCount < MIN_WORD_COUNT) {
    return {
      success: false,
      error: `Content too short: ${wordCount} words (minimum ${MIN_WORD_COUNT})`
    };
  }

  const words = textContent.split(/\s+/).filter(w => w.length > 2);
  const uniqueWords = new Set(words);

  if (uniqueWords.size < 10) {
    return {
      success: false,
      error: "Content lacks meaningful vocabulary (too few unique words)"
    };
  }

  return {
    success: true,
    wordCount,
    processingMode: wordCount > 10000 ? (wordCount > 50000 ? "chunk" : "inspect") : "normal"
  };
}

// ============================================
// DUPLICATE CHECK
// ============================================

async function checkDuplicate(textContent) {
  try {
    const contentHash = generateHash(textContent);

    const { data: existing, error } = await supabase
      .from("articles")
      .select("article_id, canonical_title, slug, content_hash, version, retrieved_at")
      .eq("content_hash", contentHash)
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
// SAVE ARTICLE
// ============================================

async function saveArticle(job, extractResult, duplicateResult) {
  try {
    const { title, textContent, htmlContent, domain, url, publishedAt, wordCount } = extractResult;
    const { contentHash, isDuplicate, existingArticle } = duplicateResult;

    const slug = generateSlug(title);

    let finalSlug = slug;
    let counter = 1;
    while (true) {
      const { data: existing } = await supabase
        .from("articles")
        .select("slug")
        .eq("slug", finalSlug)
        .limit(1);
      
      if (!existing || existing.length === 0) break;
      finalSlug = `${slug}-${counter}`;
      counter++;
    }

    const categories = await detectCategories(title, textContent);

    if (isDuplicate && existingArticle) {
      log(`📋 Updating existing article ${existingArticle.article_id}`, "warn");

      const existingWordCount = textContent.split(/\s+/).length;
      if (Math.abs(existingWordCount - wordCount) > 500) {
        await supabase
          .from("article_versions")
          .insert({
            article_id: existingArticle.article_id,
            content: textContent,
            source_snapshot: {
              html: htmlContent,
              url: url,
              scraped_at: new Date().toISOString()
            },
            change_reason: "Content updated"
          });

        const { data: updated, error: updateError } = await supabase
          .from("articles")
          .update({
            base_content: textContent,
            word_count: wordCount,
            version: existingArticle.version + 1,
            updated_at: new Date().toISOString(),
            next_refresh_at: new Date(Date.now() + REFRESH_INTERVAL_DAYS * 24 * 60 * 60 * 1000).toISOString()
          })
          .eq("article_id", existingArticle.article_id)
          .select()
          .single();

        if (updateError) throw updateError;
        return updated;
      }

      await supabase
        .from("articles")
        .update({
          retrieved_at: new Date().toISOString(),
          next_refresh_at: new Date(Date.now() + REFRESH_INTERVAL_DAYS * 24 * 60 * 60 * 1000).toISOString()
        })
        .eq("article_id", existingArticle.article_id);

      return existingArticle;
    }

    const { data: article, error: insertError } = await supabase
      .from("articles")
      .insert({
        canonical_title: title,
        slug: finalSlug,
        base_content: textContent,
        summary: "",
        source_url: url,
        source_domain: domain,
        categories: categories,
        content_hash: contentHash,
        word_count: wordCount,
        version: 1,
        status: "processing",
        source_title: title,
        source_published_at: publishedAt,
        retrieved_at: new Date().toISOString(),
        next_refresh_at: new Date(Date.now() + REFRESH_INTERVAL_DAYS * 24 * 60 * 60 * 1000).toISOString()
      })
      .select()
      .single();

    if (insertError) throw insertError;

    await supabase
      .from("article_versions")
      .insert({
        article_id: article.article_id,
        content: textContent,
        source_snapshot: {
          html: htmlContent,
          url: url,
          scraped_at: new Date().toISOString()
        },
        change_reason: "Initial scrape"
      });

    await supabase
      .from("processing_jobs")
      .update({ article_id: article.article_id })
      .eq("job_id", job.job_id);

    return article;

  } catch (error) {
    log(`Save error: ${error.message}`, "error");
    return null;
  }
}

// ============================================
// SEND TO PROCESSOR
// ============================================

async function sendToProcessor(article, job) {
  try {
    log(`📤 Sending article ${article.article_id} to processor...`, "process");

    let processingMode = "normal";
    if (article.word_count > 10000 && article.word_count <= 50000) {
      processingMode = "inspect";
    } else if (article.word_count > 50000) {
      processingMode = "chunk";
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
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": ADMIN_API_KEY || ""
      },
      body: JSON.stringify(payload),
      timeout: 60000
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Processor returned ${response.status}: ${text.substring(0, 100)}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || "Processor failed");
    }

    return { success: true, result };

  } catch (error) {
    log(`Processor error: ${error.message}`, "error");
    return { success: false, error: error.message };
  }
}

// ============================================
// JOB STATUS FUNCTIONS
// ============================================

async function updateJobStage(jobId, stage, status) {
  try {
    const { data: job, error } = await supabase
      .from("processing_jobs")
      .select("stages")
      .eq("job_id", jobId)
      .single();

    if (error) throw error;

    const stages = job.stages || {};
    stages[stage] = status;

    await supabase
      .from("processing_jobs")
      .update({
        current_stage: stage,
        stages: stages
      })
      .eq("job_id", jobId);

  } catch (error) {
    log(`Failed to update job stage: ${error.message}`, "warn");
  }
}

async function failJob(jobId, stage, error) {
  try {
    log(`❌ Job ${jobId} failed at ${stage}: ${error}`, "error");

    await supabase
      .from("processing_jobs")
      .update({
        status: "failed",
        current_stage: stage,
        error: error,
        completed_at: new Date().toISOString()
      })
      .eq("job_id", jobId);

  } catch (err) {
    log(`Failed to mark job as failed: ${err.message}`, "error");
  }
}

async function completeJob(jobId, articleId) {
  try {
    await supabase
      .from("processing_jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString()
      })
      .eq("job_id", jobId);

    log(`✅ Job ${jobId} completed (article: ${articleId})`, "success");

  } catch (error) {
    log(`Failed to complete job: ${error.message}`, "error");
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function generateHash(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 100);
}

async function detectCategories(title, content) {
  const { data: existingCategories } = await supabase
    .from("system_config")
    .select("value")
    .eq("key", "category_metadata")
    .single();

  let categoryMap = {};
  if (existingCategories) {
    categoryMap = existingCategories.value || {};
  }

  const existingCategoryNames = Object.keys(categoryMap);
  
  if (existingCategoryNames.length > 0) {
    const text = `${title} ${content}`.toLowerCase();
    const matched = [];
    for (const category of existingCategoryNames) {
      if (text.includes(category.toLowerCase())) {
        matched.push(category);
      }
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

  const keywords = {
    "Technology": ["tech", "software", "ai", "machine learning", "programming", "code", "digital", "computer", "data", "algorithm"],
    "Science": ["science", "research", "discovery", "experiment", "biology", "physics", "chemistry", "astronomy", "genetics"],
    "Business": ["business", "finance", "investment", "market", "economy", "trade", "company", "startup", "entrepreneur"],
    "Health": ["health", "medical", "wellness", "fitness", "nutrition", "disease", "treatment", "doctor", "hospital"],
    "Education": ["education", "learn", "school", "university", "college", "student", "teaching", "study", "course"],
    "Entertainment": ["entertainment", "movie", "film", "music", "game", "stream", "show", "tv", "celebrity"],
    "Sports": ["sport", "game", "team", "player", "match", "league", "tournament", "coach", "stadium"],
    "Politics": ["politics", "government", "policy", "election", "president", "minister", "vote", "congress"],
    "Environment": ["environment", "climate", "sustainability", "renewable", "green", "eco", "nature", "wildlife"],
    "Finance": ["finance", "money", "bank", "invest", "saving", "capital", "credit", "loan", "interest", "stock"]
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

  return detected.length > 0 ? detected.slice(0, 5) : ["General"];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// EXPORT ROUTER
// ============================================

export default router;