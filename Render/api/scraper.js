// api/processor.js
// EasyRead Processor - AI Processing Route

import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import openRouter from "../utils/openrouter.js";

const router = Router();

// ============================================
// CONFIGURATION
// ============================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

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
    ai: "🤖",
    embed: "🧠",
    store: "💾",
    process: "⚙️"
  }[type] || "📘";
  console.log(`${timestamp} ${prefix} ${message}`);
}

// ============================================
// HEALTH CHECK
// ============================================

router.get("/health", async (req, res) => {
  try {
    const status = openRouter.getStatus();
    res.json({
      success: true,
      status: "operational",
      openrouter: status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// PROCESS ARTICLE
// ============================================

router.post("/", async (req, res) => {
  const apiKey = req.headers["x-admin-key"];

  if (apiKey !== ADMIN_API_KEY) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized",
      message: "Invalid or missing API key"
    });
  }

  try {
    const result = await processArticle(req.body);
    res.json(result);
  } catch (error) {
    console.error("❌ Processor error:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// PROCESS QUESTION
// ============================================

router.post("/question", async (req, res) => {
  const apiKey = req.headers["x-admin-key"];

  if (apiKey !== ADMIN_API_KEY) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized",
      message: "Invalid or missing API key"
    });
  }

  try {
    const result = await processQuestion(req.body);
    res.json(result);
  } catch (error) {
    console.error("❌ Question error:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// PROCESS ARTICLE FUNCTION
// ============================================

export async function processArticle(data) {
  const { article_id, content, title, url, domain, word_count, processing_mode, categories } = data;

  if (!article_id) {
    return { success: false, error: "article_id required" };
  }

  log(`🔄 Processing article ${article_id}: "${title || 'Untitled'}"`, "process");

  try {
    // STEP 1: Get existing categories
    const existingCategories = await getExistingCategories();

    // STEP 2: Build Base Article
    const baseArticle = await generateBaseArticle(content, title, url, domain, existingCategories);
    
    if (!baseArticle) {
      throw new Error("Failed to generate Base Article");
    }
    log(`✅ Base Article generated: "${baseArticle.title}"`, "success");

    // STEP 3: Generate embedding
    const embeddingResult = await openRouter.generateEmbedding(baseArticle.content, true);
    
    if (!embeddingResult || !embeddingResult.embedding) {
      throw new Error("Failed to generate embedding");
    }

    // STEP 4: Update article
    const { data: updated, error: updateError } = await supabase
      .from("articles")
      .update({
        canonical_title: baseArticle.title,
        base_content: baseArticle.content,
        summary: baseArticle.summary,
        categories: baseArticle.categories,
        embedding: embeddingResult.embedding,
        status: "processed",
        updated_at: new Date().toISOString()
      })
      .eq("article_id", article_id)
      .select()
      .single();

    if (updateError) throw updateError;

    // STEP 5: Generate Explanation Views
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("status", "active");

    if (profileError) {
      log(`Failed to fetch profiles: ${profileError.message}`, "warn");
    }

    if (profiles && profiles.length > 0) {
      for (const profile of profiles) {
        await generateExplanationView(article_id, profile, baseArticle);
      }
    }

    return {
      success: true,
      message: "Article processed successfully",
      article: updated
    };

  } catch (error) {
    log(`❌ Article ${article_id} failed: ${error.message}`, "error");
    
    await supabase
      .from("articles")
      .update({
        status: "failed",
        updated_at: new Date().toISOString()
      })
      .eq("article_id", article_id);

    return { success: false, error: error.message };
  }
}

// ============================================
// GENERATE BASE ARTICLE
// ============================================

async function generateBaseArticle(content, title, url, domain, existingCategories) {
  const prompt = buildBaseArticlePrompt(content, title, url, domain, existingCategories);

  try {
    const response = await openRouter.generateJSON(prompt, "content_processing", {
      temperature: 0.7,
      maxTokens: 8192
    });

    if (!response || !response.parsed) {
      throw new Error("Failed to parse AI response");
    }

    const parsed = response.parsed;

    const validCategories = (parsed.categories || ["General"])
      .filter(c => c && typeof c === "string" && c.trim().length > 0)
      .slice(0, 5);

    let contentString = parsed.content;
    if (Array.isArray(contentString)) {
      contentString = contentString
        .map(section => `## ${section.heading || "Section"}\n\n${section.body || ""}`)
        .join("\n\n");
    }

    return {
      canonical_topic: parsed.canonical_topic || parsed.title,
      title: parsed.title || title || "Untitled Article",
      content: contentString,
      summary: parsed.summary || "",
      categories: validCategories.length > 0 ? validCategories : ["General"],
      estimated_read_time_minutes: parsed.estimated_read_time_minutes || 
        Math.ceil(contentString.split(/\s+/).length / 200)
    };

  } catch (error) {
    log(`AI generation failed: ${error.message}`, "error");
    return null;
  }
}

// ============================================
// GENERATE EXPLANATION VIEW
// ============================================

async function generateExplanationView(articleId, profile, baseArticle) {
  try {
    const { data: existing, error: checkError } = await supabase
      .from("explanation_views")
      .select("view_id")
      .eq("article_id", articleId)
      .eq("profile_id", profile.profile_id)
      .single();

    if (checkError && checkError.code !== "PGRST116") {
      log(`Check error: ${checkError.message}`, "warn");
    }

    if (existing) {
      log(`⏭️ Explanation already exists for profile: ${profile.name}`, "info");
      return;
    }

    log(`📝 Generating explanation for profile: ${profile.name}`, "ai");

    const prompt = buildExplanationPrompt(baseArticle, profile);
    const response = await openRouter.generateJSON(prompt, "explanation", {
      temperature: 0.7,
      maxTokens: 4096
    });

    if (!response || !response.parsed) {
      throw new Error("Failed to parse explanation response");
    }

    const parsed = response.parsed;

    let contentString = parsed.content;
    if (Array.isArray(contentString)) {
      contentString = contentString
        .map(section => `## ${section.heading || "Section"}\n\n${section.body || ""}`)
        .join("\n\n");
    }

    const embeddingResult = await openRouter.generateEmbedding(contentString, true);

    await supabase
      .from("explanation_views")
      .insert({
        article_id: articleId,
        profile_id: profile.profile_id,
        title: parsed.title || "Explanation",
        content: contentString,
        summary: parsed.summary || "",
        article_version: 1,
        profile_version: 1,
        embedding: embeddingResult ? embeddingResult.embedding : null,
        view_count: 0,
        rating_avg: 0,
        rating_count: 0,
        generated_at: new Date().toISOString()
      });

    log(`✅ Explanation saved for profile: ${profile.name}`, "success");

  } catch (error) {
    log(`❌ Failed to generate explanation for ${profile.name}: ${error.message}`, "error");
  }
}

// ============================================
// GET EXISTING CATEGORIES
// ============================================

async function getExistingCategories() {
  const { data: articles, error } = await supabase
    .from("articles")
    .select("categories")
    .not("categories", "is", null);

  if (error) {
    log(`Failed to fetch categories: ${error.message}`, "warn");
    return [];
  }

  const categorySet = new Set();
  articles.forEach(article => {
    if (article.categories && Array.isArray(article.categories)) {
      article.categories.forEach(cat => {
        const clean = cat.trim();
        if (clean) categorySet.add(clean);
      });
    }
  });

  return Array.from(categorySet).sort();
}

// ============================================
// PROCESS QUESTION
// ============================================

export async function processQuestion(data) {
  const { question, profile_id, user_id } = data;

  if (!question) {
    return { success: false, error: "Question required" };
  }

  log(`❓ Processing question: "${question}"`, "process");

  try {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("profile_id", profile_id || 1)
      .single();

    if (profileError) throw profileError;

    const prompt = buildQuestionPrompt(question, profile);
    const response = await openRouter.generateJSON(prompt, "user_questions", {
      temperature: 0.5,
      maxTokens: 2048
    });

    if (!response || !response.parsed) {
      throw new Error("Failed to generate answer");
    }

    const parsed = response.parsed;

    return {
      success: true,
      answer: {
        title: parsed.title || "Answer",
        content: parsed.content || "",
        summary: parsed.summary || "",
        categories: parsed.categories || ["Q&A"]
      }
    };

  } catch (error) {
    log(`❌ Question failed: ${error.message}`, "error");
    return { success: false, error: error.message };
  }
}

// ============================================
// PROMPT BUILDERS
// ============================================

function buildBaseArticlePrompt(content, title, url, domain, existingCategories) {
  return `You are the EasyRead Base Article Builder.

Transform this source content into a clear, structured, factual, profile-agnostic Base Article.

SOURCE:
Title: ${title || "Untitled"}
URL: ${url || "Not provided"}
Domain: ${domain || "Not provided"}

CONTENT:
${content.substring(0, 10000)}

EXISTING CATEGORIES:
${existingCategories.join(", ") || "None yet"}

Create a Base Article that:
1. Has a clear, curious title
2. Is structured with sections
3. Uses the EasyRead standard
4. Has a "so basically..." summary
5. Assigns appropriate categories (max 5, prefer existing)

Return JSON: { canonical_topic, title, content, summary, categories, estimated_read_time_minutes }`;
}

function buildExplanationPrompt(baseArticle, profile) {
  return `You are the EasyRead Explanation Engine.

Convert this Base Article into an explanation using the ${profile.name} perspective.

BASE ARTICLE:
Title: ${baseArticle.title}
Content: ${baseArticle.content.substring(0, 8000)}
Summary: ${baseArticle.summary}

PROFILE:
Name: ${profile.name}
Description: ${profile.description}
Rules: ${profile.rules || "No specific rules"}

Create an explanation that:
1. Has a hook title
2. Uses ${profile.name} concepts and analogies
3. Is warm, conversational, and easy to understand
4. Passes the "phone on a bus" test
5. Has a "so basically..." summary
6. Never invents information

Return JSON: { title, content, summary }`;
}

function buildQuestionPrompt(question, profile) {
  return `You are the EasyRead Question Engine.

Answer this user question using the ${profile.name} perspective.

QUESTION: ${question}

PROFILE: ${profile.name}
Description: ${profile.description}

Provide a clear, detailed answer that:
1. Directly addresses the question
2. Uses ${profile.name} concepts when relevant
3. Is easy to understand
4. Has a clear summary

Return JSON: { title, content, summary, categories }`;
}

// ============================================
// EXPORT ROUTER
// ============================================

export default router;