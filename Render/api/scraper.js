// api/scraper.js
// EasyRead Scraper - Scraping Route

import { Router } from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import crypto from "crypto";
import cors from "cors";
import { 
  supabase,
  getById,
  getByColumn,
  insert,
  update,
  deleteRecord,
  exists,
  count
} from "../utils/supabase.js";

const router = Router();

// ============================================
// CONFIGURATION
// ============================================

const PROCESSOR_URL = 'https://my-fcm-server.onrender.com/api/processor';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const SCRAPER_INTERVAL = parseInt(process.env.SCRAPER_INTERVAL) || 20000;
const BATCH_SIZE = parseInt(process.env.SCRAPER_BATCH_SIZE) || 3;
const MAX_RETRIES = parseInt(process.env.SCRAPER_MAX_RETRIES) || 3;
const MIN_WORD_COUNT = 200;
const REFRESH_INTERVAL_DAYS = 14;

// ============================================
// CORS CONFIGURATION
// ============================================

const allowedOrigins = [
  'https://easytoread.vercel.app',
  'https://my-fcm-server.onrender.com',
  'https://easyread.rf.gd',
  // Include www subdomains
  'https://www.easytoread.vercel.app',
  'https://www.my-fcm-server.onrender.com',
  'https://www.easyread.rf.gd'
];

// Helper function to check if origin is allowed (including subdomains)
function isOriginAllowed(origin) {
  if (!origin) return false;
  
  // Check exact match first
  if (allowedOrigins.includes(origin)) return true;
  
  // Check for subdomains
  try {
    const url = new URL(origin);
    const hostname = url.hostname;
    
    // Check if it's a subdomain of our allowed domains
    return allowedOrigins.some(allowed => {
      const allowedUrl = new URL(allowed);
      const allowedHostname = allowedUrl.hostname;
      
      // Check if hostname ends with .allowedHostname (for subdomains)
      return hostname.endsWith('.' + allowedHostname);
    });
  } catch (error) {
    return false;
  }
}

// CORS options
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      return callback(null, true);
    }
    
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      console.warn(`⚠️ CORS blocked for origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'x-admin-key',
    'Accept',
    'Origin',
    'X-Requested-With'
  ],
  credentials: true,
  optionsSuccessStatus: 200,
  maxAge: 86400 // 24 hours
};

// Apply CORS middleware to all routes
router.use(cors(corsOptions));

// Handle preflight requests explicitly
router.options('*', cors(corsOptions));

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
// AUTHENTICATION HELPERS
// ============================================

async function authenticateUser(userId) {
  if (!userId) return null;

  const users = await getByColumn('users', 'user_id', userId);
  if (users.length === 0) return null;

  return users[0];
}

async function checkUserCredits(userId, requiredCredits = 1) {
  const user = await authenticateUser(userId);
  if (!user) return { valid: false, error: "User not found" };

  // Check if user has enough credits for context submission (1 credit)
  if (user.credits < requiredCredits) {
    return { 
      valid: false, 
      error: "Insufficient credits",
      credits: user.credits,
      required: requiredCredits
    };
  }

  // Check daily limit (50 credits per day)
  const today = new Date().toISOString().split('T')[0];
  const usageRecords = await getByColumn('usage', 'user_id', userId);
  const todayUsage = usageRecords.find(u => u.date === today);
  const dailyCreditsUsed = todayUsage ? todayUsage.credits_used : 0;

  if (dailyCreditsUsed + requiredCredits > 50) {
    return {
      valid: false,
      error: "Daily credit limit exceeded",
      used: dailyCreditsUsed,
      limit: 50,
      remaining: 50 - dailyCreditsUsed
    };
  }

  return { valid: true, user };
}

async function deductUserCredits(userId, amount = 1, reason = 'context_submit') {
  const users = await getByColumn('users', 'user_id', userId);
  if (users.length === 0) return null;

  const user = users[0];
  const newCredits = user.credits - amount;

  await update('users', userId, { credits: newCredits });

  // Log transaction
  await insert('credit_transactions', {
    user_id: userId,
    amount: -amount,
    reason: reason,
    balance_after: newCredits
  });

  // Update usage
  const today = new Date().toISOString().split('T')[0];
  const usageRecords = await getByColumn('usage', 'user_id', userId);
  const todayUsage = usageRecords.find(u => u.date === today);

  if (todayUsage) {
    await update('usage', todayUsage.usage_id, {
      credits_used: (todayUsage.credits_used || 0) + amount,
      context_submits: (todayUsage.context_submits || 0) + 1
    });
  } else {
    await insert('usage', {
      user_id: userId,
      date: today,
      credits_used: amount,
      context_submits: 1,
      questions: 0,
      deep_dives: 0,
      articles_read: 0
    });
  }

  return { newCredits };
}

// ============================================
// ROUTES
// ============================================

/**
 * POST /api/scraper/submit
 * Submit a single URL for scraping (Admin or User)
 * 
 * Admin: Uses x-admin-key header
 * User: Uses user_id in body (deducts 1 credit)
 */
router.post("/submit", async (req, res) => {
  const adminKey = req.headers["x-admin-key"];
  const { url, user_id } = req.body;

  if (!url) {
    return res.status(400).json({
      success: false,
      error: "URL is required"
    });
  }

  try {
    new URL(url);
  } catch {
    return res.status(400).json({
      success: false,
      error: "Invalid URL format"
    });
  }

  // Check if it's an admin request
  const isAdmin = adminKey && adminKey === ADMIN_API_KEY;

  // If not admin, user must be authenticated
  if (!isAdmin) {
    if (!user_id) {
      return res.status(401).json({
        success: false,
        error: "Authentication required. Provide user_id or admin key."
      });
    }

    // Check user credits (context submit costs 1 credit)
    const creditCheck = await checkUserCredits(user_id, 1);
    if (!creditCheck.valid) {
      return res.status(402).json({
        success: false,
        error: creditCheck.error,
        credits: creditCheck.credits,
        required: 1,
        daily_used: creditCheck.used,
        daily_limit: 50
      });
    }
  }

  try {
    // Check if URL already exists in processing_jobs
    const { data: existing, error: checkError } = await supabase
      .from("processing_jobs")
      .select("job_id, status")
      .eq("url", url)
      .in("status", ["pending", "processing"])
      .limit(1);

    if (checkError) throw checkError;

    if (existing && existing.length > 0) {
      return res.status(409).json({
        success: false,
        error: "URL already in queue",
        job_id: existing[0].job_id,
        status: existing[0].status
      });
    }

    // Deduct credits if user (not admin)
    if (!isAdmin && user_id) {
      await deductUserCredits(user_id, 1, 'context_submit');
    }

    // Create job
    const { data: job, error: insertError } = await supabase
      .from("processing_jobs")
      .insert({
        url: url,
        user_id: isAdmin ? null : user_id,
        status: "pending",
        current_stage: "fetch",
        stages: {
          fetch: "pending",
          extract: "pending",
          quality: "pending",
          duplicate_check: "pending",
          processing: "pending",
          embedding: "pending",
          storage: "pending"
        },
        started_at: new Date().toISOString()
      })
      .select()
      .single();

    if (insertError) throw insertError;

    log(`📝 URL submitted: ${url} (job: ${job.job_id})`, "info");

    // If scraper is not running, process immediately
    if (!isRunning) {
      log("🚀 Scraper not running, processing job immediately...", "warn");
      const success = await processJob(job);
      if (success) {
        stats.totalProcessed++;
      } else {
        stats.totalFailed++;
      }
    }

    res.status(201).json({
      success: true,
      message: "URL submitted for scraping",
      job_id: job.job_id,
      status: job.status,
      credits_used: isAdmin ? 0 : 1,
      credits_remaining: isAdmin ? null : (await authenticateUser(user_id))?.credits
    });

  } catch (error) {
    log(`❌ Failed to submit URL: ${error.message}`, "error");
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/scraper/submit-batch
 * Submit multiple URLs for scraping (Admin only)
 */
router.post("/submit-batch", async (req, res) => {
  const adminKey = req.headers["x-admin-key"];
  const { urls, user_id } = req.body;

  // Admin only
  if (adminKey !== ADMIN_API_KEY) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized. Admin key required for batch submissions."
    });
  }

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({
      success: false,
      error: "URLs array is required"
    });
  }

  if (urls.length > 50) {
    return res.status(400).json({
      success: false,
      error: "Maximum 50 URLs per batch"
    });
  }

  const results = [];
  const errors = [];

  for (const url of urls) {
    try {
      new URL(url);

      const { data: existing, error: checkError } = await supabase
        .from("processing_jobs")
        .select("job_id, status")
        .eq("url", url)
        .in("status", ["pending", "processing"])
        .limit(1);

      if (checkError) throw checkError;

      if (existing && existing.length > 0) {
        results.push({
          url,
          status: "exists",
          job_id: existing[0].job_id,
          message: "URL already in queue"
        });
        continue;
      }

      const { data: job, error: insertError } = await supabase
        .from("processing_jobs")
        .insert({
          url: url,
          user_id: user_id || null,
          status: "pending",
          current_stage: "fetch",
          stages: {
            fetch: "pending",
            extract: "pending",
            quality: "pending",
            duplicate_check: "pending",
            processing: "pending",
            embedding: "pending",
            storage: "pending"
          },
          started_at: new Date().toISOString()
        })
        .select()
        .single();

      if (insertError) throw insertError;

      results.push({
        url,
        status: "submitted",
        job_id: job.job_id
      });

      log(`📝 Batch URL submitted: ${url} (job: ${job.job_id})`, "info");

    } catch (error) {
      errors.push({
        url,
        error: error.message
      });
    }
  }

  // If scraper is not running, process jobs
  if (!isRunning && results.length > 0) {
    log("🚀 Scraper not running, processing batch jobs...", "warn");
    const result = await processPendingJobs();
    log(`📊 Batch processed: ${result.processed} success, ${result.failed} failed`, "info");
  }

  res.status(201).json({
    success: true,
    message: `Submitted ${results.length} URLs for scraping`,
    results,
    errors: errors.length > 0 ? errors : undefined,
    total_submitted: results.length,
    total_errors: errors.length
  });
});

/**
 * POST /api/scraper/submit-text
 * Submit raw text for processing (User only)
 */
router.post("/submit-text", async (req, res) => {
  const { text, title, user_id } = req.body;

  if (!user_id) {
    return res.status(401).json({
      success: false,
      error: "Authentication required. user_id required."
    });
  }

  if (!text) {
    return res.status(400).json({
      success: false,
      error: "Text content is required"
    });
  }

  if (text.length < 100) {
    return res.status(400).json({
      success: false,
      error: "Text too short (min 100 characters)"
    });
  }

  // Check user credits
  const creditCheck = await checkUserCredits(user_id, 1);
  if (!creditCheck.valid) {
    return res.status(402).json({
      success: false,
      error: creditCheck.error,
      credits: creditCheck.credits,
      required: 1,
      daily_used: creditCheck.used,
      daily_limit: 50
    });
  }

  try {
    // Check for malicious content
    const maliciousPatterns = [
      /<script/i, /javascript:/i, /onclick=/i, /onerror=/i,
      /onload=/i, /eval\(/i, /document\.write/i
    ];
    if (maliciousPatterns.some(pattern => pattern.test(text))) {
      return res.status(400).json({
        success: false,
        error: "Content appears to be malicious or contains prohibited content"
      });
    }

    // Deduct credits
    await deductUserCredits(user_id, 1, 'context_submit');

    // Create a processing job with the text content
    const { data: job, error: insertError } = await supabase
      .from("processing_jobs")
      .insert({
        url: null,
        user_id: user_id,
        status: "pending",
        current_stage: "extract",
        stages: {
          fetch: "skipped",
          extract: "pending",
          quality: "pending",
          duplicate_check: "pending",
          processing: "pending",
          embedding: "pending",
          storage: "pending"
        },
        started_at: new Date().toISOString()
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // Save the text content directly as an article
    const { data: article, error: articleError } = await supabase
      .from("articles")
      .insert({
        canonical_title: title || "User Submitted Content",
        slug: `user-content-${Date.now()}`,
        base_content: text,
        summary: "",
        source_url: null,
        source_domain: "user-submitted",
        categories: ["User Content"],
        content_hash: crypto.createHash('sha256').update(text).digest('hex'),
        word_count: text.split(/\s+/).length,
        version: 1,
        status: "processing",
        retrieved_at: new Date().toISOString(),
        next_refresh_at: new Date(Date.now() + REFRESH_INTERVAL_DAYS * 24 * 60 * 60 * 1000).toISOString()
      })
      .select()
      .single();

    if (articleError) throw articleError;

    // Update job with article_id
    await supabase
      .from("processing_jobs")
      .update({ article_id: article.article_id })
      .eq("job_id", job.job_id);

    // Send to processor
    await sendToProcessor(article, job);

    // Complete job
    await completeJob(job.job_id, article.article_id);

    log(`📝 Text submitted by user ${user_id} (article: ${article.article_id})`, "info");

    res.status(201).json({
      success: true,
      message: "Text submitted for processing",
      article_id: article.article_id,
      credits_used: 1,
      credits_remaining: (await authenticateUser(user_id))?.credits
    });

  } catch (error) {
    log(`❌ Failed to submit text: ${error.message}`, "error");
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/scraper/start
 * Start the scraper (Admin only)
 */
router.post("/start", async (req, res) => {
  const adminKey = req.headers["x-admin-key"];

  if (adminKey !== ADMIN_API_KEY) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized. Admin key required."
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

/**
 * POST /api/scraper/stop
 * Stop the scraper (Admin only)
 */
router.post("/stop", async (req, res) => {
  const adminKey = req.headers["x-admin-key"];

  if (adminKey !== ADMIN_API_KEY) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized. Admin key required."
    });
  }

  await stopScraper();
  res.json({
    success: true,
    message: "Scraper stopped",
    status: "stopped"
  });
});

/**
 * GET /api/scraper/status
 * Get scraper status (Public)
 */
router.get("/status", async (req, res) => {
  const status = await getStatus();
  res.json({
    success: true,
    ...status
  });
});

/**
 * POST /api/scraper/run-once
 * Run scraper once (Admin only)
 */
router.post("/run-once", async (req, res) => {
  const adminKey = req.headers["x-admin-key"];

  if (adminKey !== ADMIN_API_KEY) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized. Admin key required."
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
  const { count: pending } = await supabase
    .from("processing_jobs")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");

  const { count: processing } = await supabase
    .from("processing_jobs")
    .select("*", { count: "exact", head: true })
    .eq("status", "processing");

  const { count: completed } = await supabase
    .from("processing_jobs")
    .select("*", { count: "exact", head: true })
    .eq("status", "completed");

  const { count: failed } = await supabase
    .from("processing_jobs")
    .select("*", { count: "exact", head: true })
    .eq("status", "failed");

  return {
    isRunning,
    stats,
    queue: {
      pending: pending || 0,
      processing: processing || 0,
      completed: completed || 0,
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

async function extractContent(html, url) {
  try {
    const $ = cheerio.load(html);

    let title = $("title").first().text().trim() || $("h1").first().text().trim() || "Untitled";

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

    let htmlContent = (mainContent.html() || "")
      .replace(/\s+/g, " ")
      .replace(/>\s+</g, "><")
      .trim();

    const wordCount = textContent.split(/\s+/).filter(w => w.length > 0).length;

    let domain = "";
    try { domain = new URL(url).hostname.replace("www.", ""); } catch {}

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