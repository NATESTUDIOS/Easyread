// api/explanation.js
// EasyRead Explanation Management - Vercel API Gateway
// All AI processing is delegated to Render's processor service

import {
  supabase,
  getAll,
  getById,
  getByColumn,
  insert,
  update,
  deleteRecord,
  exists,
  count,
  findSimilarExplanations
} from '../utils/supabase.js';

// ============================================
// CONSTANTS & CREDIT COSTS
// ============================================
const MAX_CATEGORIES_PER_ARTICLE = 5;
const SIMILARITY_THRESHOLD = 0.7;
const MAX_DEEP_DIVES_PER_ARTICLE = 10;
const CACHE_TTL_DAYS = 30;

const CREDIT_COSTS = {
  ASK_QUESTION: 1.0,
  PASTE_NOTE: 1.0,
  WEBSITE_URL: 1.0,
  EXPLANATION_PROFILE: 0.5,
  DEEP_DIVE: 0.5,
  REGENERATE: 1.0
};

// Render Processor URL
const PROCESSOR_URL = process.env.PROCESSOR_URL || 'https://my-fcm-server.onrender.com/api/processor';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

// ============================================
// MAIN HANDLER
// ============================================
export default async function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-api-key, x-user-id, x-session-token, x-admin-key'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { method } = req;
  const { action } = req.query;

  try {
    switch (method) {
      case 'GET':
        await handleGet(req, res, action);
        break;
      case 'POST':
        await handlePost(req, res, action);
        break;
      case 'PUT':
        await handlePut(req, res, action);
        break;
      case 'DELETE':
        await handleDelete(req, res, action);
        break;
      default:
        res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: error.message });
  }
}

// ============================================
// GET HANDLER
// ============================================
async function handleGet(req, res, action) {
  const {
    view_id,
    article_id,
    profile_id,
    user_id = req.headers['x-user-id'],
    deep_dive_id,
    search,
    limit = 20,
    page = 1
  } = req.query;

  // Get explanation by view ID
  if (action === 'get' && view_id) {
    return await getExplanationById(req, res, view_id, user_id);
  }

  // Get explanation by article and profile
  if (action === 'get-by-article' && article_id && profile_id) {
    return await getExplanationByArticleProfile(req, res, article_id, profile_id);
  }

  // List explanations for an article
  if (action === 'list' && article_id) {
    return await listExplanations(req, res, article_id);
  }

  // Get deep dive by ID
  if (action === 'deep-dive' && deep_dive_id) {
    return await getDeepDiveById(req, res, deep_dive_id);
  }

  // List deep dives for an explanation
  if (action === 'deep-dives' && view_id) {
    return await listDeepDives(req, res, view_id);
  }

  // Search explanations
  if (action === 'search' && search) {
    return await searchExplanations(req, res, search);
  }

  // Get similar explanations (vector search)
  if (action === 'similar' && view_id) {
    return await getSimilarExplanations(req, res, view_id);
  }

  // Get user's explanation history
  if (action === 'history' && user_id) {
    return await getExplanationHistory(req, res, user_id);
  }

  // Get explanation statistics
  if (action === 'stats') {
    return await getExplanationStats(req, res);
  }

  // Check if explanation exists
  if (action === 'check' && article_id && profile_id) {
    return await checkExplanationExists(req, res, article_id, profile_id);
  }

  res.status(400).json({ error: 'Invalid action or missing parameters' });
}

// ============================================
// POST HANDLER
// ============================================
async function handlePost(req, res, action) {
  const user_id = req.headers['x-user-id'] || req.query.user_id || req.body.user_id;

  // Generate explanation / process input (Calls Render / Processor)
  if (action === 'generate') {
    return await generateExplanation(req, res, user_id);
  }

  // Generate deep dive (Calls Render)
  if (action === 'deep-dive') {
    return await generateDeepDive(req, res, user_id);
  }

  // Batch generate explanations (Admin only - Calls Render)
  if (action === 'batch-generate') {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    return await batchGenerateExplanations(req, res);
  }

  // Regenerate explanation (Calls Render)
  if (action === 'regenerate') {
    return await regenerateExplanation(req, res, user_id);
  }

  // Create explanation manually (Admin only - Direct DB)
  if (action === 'create') {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    return await createExplanationManually(req, res);
  }

  // Search by embedding (Direct DB)
  if (action === 'search-by-embedding') {
    return await searchByEmbedding(req, res);
  }

  res.status(400).json({ error: 'Invalid action' });
}

// ============================================
// PUT HANDLER
// ============================================
async function handlePut(req, res, action) {
  if (action === 'update') {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    return await updateExplanation(req, res);
  }

  if (action === 'update-deep-dive') {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    return await updateDeepDive(req, res);
  }

  if (action === 'view') {
    return await incrementViewCount(req, res);
  }

  res.status(400).json({ error: 'Invalid action' });
}

// ============================================
// DELETE HANDLER
// ============================================
async function handleDelete(req, res, action) {
  const adminKey = req.headers['x-admin-key'];

  if (action === 'delete') {
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    return await deleteExplanation(req, res);
  }

  if (action === 'delete-deep-dive') {
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    return await deleteDeepDive(req, res);
  }

  if (action === 'clear-cache') {
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    return await clearExplanationCache(req, res);
  }

  res.status(400).json({ error: 'Invalid action' });
}

// ============================================
// 🚀 GENERATE EXPLANATION PIPELINE
// Handles: Question, Long Note, Website URL & Existing Article ID
// ============================================
async function generateExplanation(req, res, user_id) {
  const {
    mode,          // 'ask' | 'paste' | 'website'
    content,       // Question prompt, raw note text, or URL
    prompt,
    article_id,
    profile_id = 1,
    force = false
  } = req.body;

  const rawInput = content || prompt;

  // ----------------------------------------------------
  // ENFORCE RULE: ONLY REGISTERED USERS ALLOWED
  // ----------------------------------------------------
  if (!user_id) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required. Please sign in to use EasyRead AI services.'
    });
  }

  // ----------------------------------------------------
  // CASE 1: USER ASKS A QUESTION (mode === 'ask')
  // ----------------------------------------------------
  if (mode === 'ask' || (!article_id && rawInput && !rawInput.startsWith('http') && rawInput.length < 250)) {
    // Check credits
    const creditCheck = await checkUserCredits(user_id, CREDIT_COSTS.ASK_QUESTION);
    if (!creditCheck.allowed) {
      return res.status(402).json({
        success: false,
        error: 'Insufficient credits',
        required: CREDIT_COSTS.ASK_QUESTION,
        available: creditCheck.credits
      });
    }

    try {
      const response = await fetch(`${PROCESSOR_URL}/question`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': ADMIN_API_KEY
        },
        body: JSON.stringify({
          question: rawInput,
          profile_id: parseInt(profile_id),
          user_id: user_id
        }),
        timeout: 120000
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to process question');
      }

      // Fetch created article details to return slug
      const { data: createdArticle } = await supabase
        .from('articles')
        .select('article_id, slug, canonical_title')
        .eq('article_id', data.article_id)
        .single();

      return res.json({
        success: true,
        article_id: data.article_id,
        slug: createdArticle?.slug || data.article_id,
        view_id: data.view_id,
        explanation: data.answer,
        credits_used: data.credits_used || CREDIT_COSTS.ASK_QUESTION
      });
    } catch (err) {
      console.error('Question delegation error:', err);
      return res.status(500).json({ error: err.message || 'Failed to process question' });
    }
  }

  // ----------------------------------------------------
  // CASE 2: USER PASTES A LONG NOTE (mode === 'paste')
  // ----------------------------------------------------
  if (mode === 'paste' || (!article_id && rawInput && !rawInput.startsWith('http') && rawInput.length >= 250)) {
    // Check credits
    const creditCheck = await checkUserCredits(user_id, CREDIT_COSTS.PASTE_NOTE);
    if (!creditCheck.allowed) {
      return res.status(402).json({
        success: false,
        error: 'Insufficient credits',
        required: CREDIT_COSTS.PASTE_NOTE,
        available: creditCheck.credits
      });
    }

    try {
      const title = rawInput.split('\n')[0].replace(/^#+\s*/, '').substring(0, 80).trim() || 'Custom Note';
      const slug = generateSlug(title) + '-' + Math.floor(1000 + Math.random() * 9000);

      // Create pending article in database
      const { data: article, error: articleErr } = await supabase
        .from('articles')
        .insert({
          canonical_title: title,
          slug: slug,
          base_content: rawInput,
          source_domain: 'User Note',
          status: 'pending',
          word_count: rawInput.split(/\s+/).length,
          version: 1,
          retrieved_at: new Date().toISOString()
        })
        .select()
        .single();

      if (articleErr) throw articleErr;

      // Delegate full processing to Render processor
      const response = await fetch(`${PROCESSOR_URL}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': ADMIN_API_KEY
        },
        body: JSON.stringify({
          article_id: article.article_id,
          content: rawInput,
          title: title
        }),
        timeout: 120000
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to process note');
      }

      // Deduct credits
      await deductCredits(user_id, CREDIT_COSTS.PASTE_NOTE, 'paste_note', article.article_id);

      // If requested profile is not default (profile_id !== 1), generate for requested profile
      if (parseInt(profile_id) !== 1) {
        await fetch(`${PROCESSOR_URL}/generate-explanation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_API_KEY },
          body: JSON.stringify({ article_id: article.article_id, profile_id: parseInt(profile_id), user_id })
        });
      }

      return res.json({
        success: true,
        article_id: article.article_id,
        slug: article.slug,
        credits_used: CREDIT_COSTS.PASTE_NOTE,
        message: 'Note simplified successfully'
      });
    } catch (err) {
      console.error('Note processing error:', err);
      return res.status(500).json({ error: err.message || 'Failed to process note' });
    }
  }

  // ----------------------------------------------------
  // CASE 3: USER SUBMITS A WEBSITE URL (mode === 'website')
  // ----------------------------------------------------
  if (mode === 'website' || (!article_id && rawInput && rawInput.startsWith('http'))) {
    // Check credits
    const creditCheck = await checkUserCredits(user_id, CREDIT_COSTS.WEBSITE_URL);
    if (!creditCheck.allowed) {
      return res.status(402).json({
        success: false,
        error: 'Insufficient credits',
        required: CREDIT_COSTS.WEBSITE_URL,
        available: creditCheck.credits
      });
    }

    try {
      let domain = 'Website';
      try { domain = new URL(rawInput).hostname.replace('www.', ''); } catch (e) {}

      const slug = 'web-' + Math.floor(10000 + Math.random() * 90000);

      // Create article stub in database
      const { data: article, error: articleErr } = await supabase
        .from('articles')
        .insert({
          canonical_title: `Article from ${domain}`,
          slug: slug,
          source_url: rawInput,
          source_domain: domain,
          base_content: `Source URL: ${rawInput}`,
          status: 'pending',
          version: 1,
          retrieved_at: new Date().toISOString()
        })
        .select()
        .single();

      if (articleErr) throw articleErr;

      // Delegate URL processing to Render processor
      const response = await fetch(`${PROCESSOR_URL}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': ADMIN_API_KEY
        },
        body: JSON.stringify({
          article_id: article.article_id,
          url: rawInput,
          domain: domain
        }),
        timeout: 120000
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to process website URL');
      }

      // Deduct credits
      await deductCredits(user_id, CREDIT_COSTS.WEBSITE_URL, 'website_url', article.article_id);

      return res.json({
        success: true,
        article_id: article.article_id,
        slug: article.slug,
        credits_used: CREDIT_COSTS.WEBSITE_URL,
        message: 'Website article processed successfully'
      });
    } catch (err) {
      console.error('Website processing error:', err);
      return res.status(500).json({ error: err.message || 'Failed to process website' });
    }
  }

  // ----------------------------------------------------
  // CASE 4: STANDARD EXPLANATION GENERATION BY ARTICLE ID
  // ----------------------------------------------------
  if (!article_id) {
    return res.status(400).json({ error: 'article_id or content required' });
  }

  try {
    // 1. Check cache (if not forcing regenerate)
    if (!force) {
      const { data: existing, error: checkError } = await supabase
        .from('explanation_views')
        .select('*')
        .eq('article_id', article_id)
        .eq('profile_id', profile_id)
        .maybeSingle();

      if (checkError && checkError.code !== 'PGRST116') throw checkError;

      if (existing) {
        await update('explanation_views', existing.view_id, {
          view_count: (existing.view_count || 0) + 1
        });

        return res.json({
          success: true,
          cached: true,
          explanation: existing,
          message: 'Explanation retrieved from cache'
        });
      }
    }

    // 2. Check credits (0.5 credits)
    const creditCheck = await checkUserCredits(user_id, CREDIT_COSTS.EXPLANATION_PROFILE);
    if (!creditCheck.allowed) {
      return res.status(402).json({
        success: false,
        error: 'Insufficient credits',
        required: CREDIT_COSTS.EXPLANATION_PROFILE,
        available: creditCheck.credits
      });
    }

    // 3. Call Render's processor API to generate explanation
    const response = await fetch(`${PROCESSOR_URL}/generate-explanation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': ADMIN_API_KEY
      },
      body: JSON.stringify({
        article_id: parseInt(article_id),
        profile_id: parseInt(profile_id),
        user_id: user_id || null
      }),
      timeout: 120000
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Processor returned ${response.status}`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to generate explanation');
    }

    // 4. Deduct credits if newly generated
    if (!data.cached) {
      await deductCredits(user_id, CREDIT_COSTS.EXPLANATION_PROFILE, 'explanation_generation', article_id);
    }

    // 5. Retrieve created view from Supabase
    const { data: explanation } = await supabase
      .from('explanation_views')
      .select('*')
      .eq('article_id', article_id)
      .eq('profile_id', profile_id)
      .maybeSingle();

    return res.json({
      success: true,
      cached: data.cached || false,
      explanation: explanation || data.explanation,
      credits_used: CREDIT_COSTS.EXPLANATION_PROFILE,
      message: 'Explanation generated successfully'
    });

  } catch (error) {
    console.error('Generate explanation error:', error);
    return res.status(500).json({ error: error.message || 'Failed to generate explanation' });
  }
}

// ============================================
// 🔄 REGENERATE EXPLANATION
// ============================================
async function regenerateExplanation(req, res, user_id) {
  const { article_id, profile_id } = req.body;

  if (!user_id) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (!article_id || !profile_id) {
    return res.status(400).json({ error: 'article_id and profile_id required' });
  }

  try {
    const creditCheck = await checkUserCredits(user_id, CREDIT_COSTS.REGENERATE);
    if (!creditCheck.allowed) {
      return res.status(402).json({
        error: 'Insufficient credits for regeneration',
        required: CREDIT_COSTS.REGENERATE,
        available: creditCheck.credits
      });
    }

    await supabase
      .from('explanation_views')
      .delete()
      .eq('article_id', article_id)
      .eq('profile_id', profile_id);

    const result = await generateExplanation(
      { body: { article_id, profile_id, force: true } },
      res,
      user_id
    );

    return result;

  } catch (error) {
    console.error('Regenerate explanation error:', error);
    res.status(500).json({ error: 'Failed to regenerate explanation' });
  }
}

// ============================================
// 🐳 GENERATE DEEP DIVE
// ============================================
async function generateDeepDive(req, res, user_id) {
  const {
    article_id,
    profile_id,
    question,
    parent_section = 'General'
  } = req.body;

  if (!user_id) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (!article_id || !profile_id || !question) {
    return res.status(400).json({
      error: 'article_id, profile_id, and question required'
    });
  }

  try {
    // 1. Check cache
    const { data: existing, error: checkError } = await supabase
      .from('deep_dives')
      .select('*')
      .eq('article_id', article_id)
      .eq('profile_id', profile_id)
      .eq('question', question)
      .maybeSingle();

    if (checkError && checkError.code !== 'PGRST116') throw checkError;

    if (existing) {
      return res.json({
        success: true,
        cached: true,
        deep_dive: existing,
        message: 'Deep dive retrieved from cache'
      });
    }

    // 2. Check user credits (0.5 credits)
    const creditCheck = await checkUserCredits(user_id, CREDIT_COSTS.DEEP_DIVE);
    if (!creditCheck.allowed) {
      return res.status(402).json({
        error: 'Insufficient credits',
        required: CREDIT_COSTS.DEEP_DIVE,
        available: creditCheck.credits
      });
    }

    // 3. Call Render's processor API for deep dive
    const response = await fetch(`${PROCESSOR_URL}/generate-deep-dive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': ADMIN_API_KEY
      },
      body: JSON.stringify({
        article_id: parseInt(article_id),
        profile_id: parseInt(profile_id),
        question: question,
        parent_section: parent_section,
        user_id: user_id
      }),
      timeout: 60000
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Processor returned ${response.status}`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to generate deep dive');
    }

    // 4. Deduct credits
    if (!data.cached) {
      await deductCredits(user_id, CREDIT_COSTS.DEEP_DIVE, 'deep_dive', article_id);
    }

    const { data: deepDive } = await supabase
      .from('deep_dives')
      .select('*')
      .eq('article_id', article_id)
      .eq('profile_id', profile_id)
      .eq('question', question)
      .maybeSingle();

    return res.json({
      success: true,
      cached: data.cached || false,
      deep_dive: deepDive || data.deep_dive,
      credits_used: CREDIT_COSTS.DEEP_DIVE,
      message: 'Deep dive generated successfully'
    });

  } catch (error) {
    console.error('Generate deep dive error:', error);
    return res.status(500).json({ error: error.message || 'Failed to generate deep dive' });
  }
}

// ============================================
// 📖 GET EXPLANATION BY ID
// ============================================
async function getExplanationById(req, res, view_id, user_id) {
  try {
    const { data: view, error } = await supabase
      .from('explanation_views')
      .select(`
        *,
        articles:article_id (
          canonical_title,
          slug,
          categories,
          source_domain,
          base_content,
          summary
        ),
        profiles:profile_id (
          name,
          description,
          rules,
          created_at
        )
      `)
      .eq('view_id', view_id)
      .single();

    if (error || !view) {
      return res.status(404).json({ error: 'Explanation not found' });
    }

    await update('explanation_views', view_id, {
      view_count: (view.view_count || 0) + 1
    });

    const { data: deepDives } = await supabase
      .from('deep_dives')
      .select('*')
      .eq('article_id', view.article_id)
      .eq('profile_id', view.profile_id)
      .order('created_at', { ascending: false });

    let userRating = null;
    if (user_id) {
      const { data: rating } = await supabase
        .from('ratings')
        .select('rating, feedback')
        .eq('user_id', user_id)
        .eq('view_id', view_id)
        .single();
      userRating = rating || null;
    }

    res.json({
      success: true,
      explanation: {
        ...view,
        reading_time: calculateReadingTime(view.content),
        deep_dives: deepDives || [],
        user_rating: userRating,
        view_count: (view.view_count || 0) + 1
      }
    });
  } catch (error) {
    console.error('Get explanation error:', error);
    res.status(500).json({ error: 'Failed to get explanation' });
  }
}

// ============================================
// 📖 GET EXPLANATION BY ARTICLE & PROFILE
// ============================================
async function getExplanationByArticleProfile(req, res, article_id, profile_id) {
  try {
    const { data: view, error } = await supabase
      .from('explanation_views')
      .select(`
        *,
        articles:article_id (canonical_title, slug, categories, source_domain),
        profiles:profile_id (name, description, rules)
      `)
      .eq('article_id', article_id)
      .eq('profile_id', profile_id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    if (!view) {
      return res.status(404).json({ error: 'Explanation not found for this article and profile' });
    }

    const { data: deepDives } = await supabase
      .from('deep_dives')
      .select('*')
      .eq('article_id', article_id)
      .eq('profile_id', profile_id)
      .order('created_at', { ascending: false });

    res.json({
      success: true,
      explanation: {
        ...view,
        deep_dives: deepDives || [],
        reading_time: calculateReadingTime(view.content)
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get explanation' });
  }
}

// ============================================
// 📋 LIST EXPLANATIONS FOR ARTICLE
// ============================================
async function listExplanations(req, res, article_id) {
  const { page = 1, limit = 20 } = req.query;

  try {
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data: explanations, error, count } = await supabase
      .from('explanation_views')
      .select(`*, profiles:profile_id (name, description)`, { count: 'exact' })
      .eq('article_id', article_id)
      .range(from, to)
      .order('view_count', { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      article_id,
      page: parseInt(page),
      limit: parseInt(limit),
      total: count || 0,
      explanations: (explanations || []).map(e => ({
        ...e,
        reading_time: calculateReadingTime(e.content)
      }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list explanations' });
  }
}

// ============================================
// 🐳 GET DEEP DIVE BY ID
// ============================================
async function getDeepDiveById(req, res, deep_dive_id) {
  try {
    const deepDive = await getById('deep_dives', deep_dive_id);
    if (!deepDive) return res.status(404).json({ error: 'Deep dive not found' });

    const article = await getById('articles', deepDive.article_id);
    const profile = await getById('profiles', deepDive.profile_id);

    res.json({
      success: true,
      deep_dive: {
        ...deepDive,
        article: article ? { id: article.article_id, title: article.canonical_title, slug: article.slug } : null,
        profile: profile ? { id: profile.profile_id, name: profile.name } : null
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get deep dive' });
  }
}

// ============================================
// 📋 LIST DEEP DIVES
// ============================================
async function listDeepDives(req, res, view_id) {
  const { page = 1, limit = 20 } = req.query;

  try {
    const view = await getById('explanation_views', view_id);
    if (!view) return res.status(404).json({ error: 'Explanation view not found' });

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data: deepDives, error, count } = await supabase
      .from('deep_dives')
      .select('*', { count: 'exact' })
      .eq('article_id', view.article_id)
      .eq('profile_id', view.profile_id)
      .range(from, to)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      view_id,
      article_id: view.article_id,
      profile_id: view.profile_id,
      page: parseInt(page),
      limit: parseInt(limit),
      total: count || 0,
      deep_dives: deepDives || []
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list deep dives' });
  }
}

// ============================================
// 🔍 SEARCH EXPLANATIONS
// ============================================
async function searchExplanations(req, res, search) {
  const { page = 1, limit = 20, profile_id, category, sort_by = 'relevance' } = req.query;

  try {
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase
      .from('explanation_views')
      .select(`*, articles:article_id (canonical_title, slug, categories, source_domain), profiles:profile_id (name, description)`, { count: 'exact' });

    if (search) {
      query = query.textSearch('content', search, { config: 'english', type: 'websearch' });
    }
    if (profile_id) query = query.eq('profile_id', profile_id);
    if (category) query = query.contains('articles.categories', [category]);

    if (sort_by === 'views') query = query.order('view_count', { ascending: false });
    else if (sort_by === 'rating') query = query.order('rating_avg', { ascending: false });
    else query = query.order('generated_at', { ascending: false });

    query = query.range(from, to);
    const { data, error, count } = await query;
    if (error) throw error;

    res.json({
      success: true,
      query: search,
      page: parseInt(page),
      limit: parseInt(limit),
      total: count || 0,
      explanations: (data || []).map(e => ({ ...e, reading_time: calculateReadingTime(e.content) }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to search explanations' });
  }
}

// ============================================
// 🔍 GET SIMILAR EXPLANATIONS
// ============================================
async function getSimilarExplanations(req, res, view_id) {
  const { limit = 5, threshold = SIMILARITY_THRESHOLD } = req.query;

  try {
    const view = await getById('explanation_views', view_id);
    if (!view || !view.embedding) return res.status(404).json({ error: 'Explanation embedding not found' });

    const similar = await findSimilarExplanations(view.embedding, parseFloat(threshold), parseInt(limit) + 1);
    const filtered = similar.filter(s => s.view_id !== parseInt(view_id));
    const viewIds = filtered.map(s => s.view_id);

    const { data: explanations, error } = await supabase
      .from('explanation_views')
      .select(`*, articles:article_id (canonical_title, slug), profiles:profile_id (name)`)
      .in('view_id', viewIds);

    if (error) throw error;

    res.json({
      success: true,
      view_id,
      similar_explanations: (explanations || []).map(e => ({
        ...e,
        similarity: filtered.find(f => f.view_id === e.view_id)?.similarity || 0,
        reading_time: calculateReadingTime(e.content)
      })).sort((a, b) => b.similarity - a.similarity)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get similar explanations' });
  }
}

// ============================================
// 🔍 SEARCH BY EMBEDDING
// ============================================
async function searchByEmbedding(req, res) {
  const { embedding, threshold = SIMILARITY_THRESHOLD, limit = 10 } = req.body;
  if (!embedding) return res.status(400).json({ error: 'Embedding required' });

  try {
    const results = await findSimilarExplanations(embedding, parseFloat(threshold), parseInt(limit));
    const viewIds = results.map(r => r.view_id);

    const { data: explanations, error } = await supabase
      .from('explanation_views')
      .select(`*, articles:article_id (canonical_title, slug), profiles:profile_id (name)`)
      .in('view_id', viewIds);

    if (error) throw error;

    res.json({
      success: true,
      results: (explanations || []).map(e => ({
        ...e,
        similarity: results.find(r => r.view_id === e.view_id)?.similarity || 0,
        reading_time: calculateReadingTime(e.content)
      })).sort((a, b) => b.similarity - a.similarity)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to search by embedding' });
  }
}

// ============================================
// 📊 GET EXPLANATION STATS
// ============================================
async function getExplanationStats(req, res) {
  try {
    const { count: totalExplanations } = await supabase.from('explanation_views').select('*', { count: 'exact', head: true });
    const { data: viewData } = await supabase.from('explanation_views').select('view_count');
    const totalViews = viewData?.reduce((sum, v) => sum + (v.view_count || 0), 0) || 0;

    const { data: ratingData } = await supabase.from('explanation_views').select('rating_avg, rating_count').not('rating_count', 'eq', 0);
    const avgRating = ratingData?.length > 0 ? ratingData.reduce((sum, r) => sum + (r.rating_avg || 0), 0) / ratingData.length : 0;

    res.json({
      success: true,
      stats: {
        total_explanations: totalExplanations || 0,
        total_views: totalViews,
        average_rating: Math.round(avgRating * 100) / 100 || 0
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get stats' });
  }
}

// ============================================
// 📖 GET EXPLANATION HISTORY
// ============================================
async function getExplanationHistory(req, res, user_id) {
  const { limit = 50 } = req.query;

  try {
    const { data: history, error } = await supabase
      .from('reading_history')
      .select(`*, articles:article_id (canonical_title, slug, categories, summary)`)
      .eq('user_id', user_id)
      .order('viewed_at', { ascending: false })
      .limit(parseInt(limit));

    if (error) throw error;

    res.json({
      success: true,
      history: history || [],
      total: history?.length || 0
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get history' });
  }
}

// ============================================
// ✅ CHECK EXPLANATION EXISTS
// ============================================
async function checkExplanationExists(req, res, article_id, profile_id) {
  try {
    const { data: view } = await supabase
      .from('explanation_views')
      .select('view_id, title, generated_at, view_count')
      .eq('article_id', article_id)
      .eq('profile_id', profile_id)
      .single();

    res.json({
      success: true,
      exists: !!view,
      explanation: view || null
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check explanation' });
  }
}

// ============================================
// ➕ CREATE EXPLANATION MANUALLY (Admin only)
// ============================================
async function createExplanationManually(req, res) {
  const { article_id, profile_id, title, content, summary, embedding = null } = req.body;
  if (!article_id || !profile_id || !title || !content) {
    return res.status(400).json({ error: 'article_id, profile_id, title, and content required' });
  }

  try {
    const view = await insert('explanation_views', {
      article_id: parseInt(article_id),
      profile_id: parseInt(profile_id),
      title,
      content,
      summary: summary || null,
      article_version: 1,
      profile_version: 1,
      embedding: embedding || null,
      view_count: 0,
      rating_avg: 0,
      rating_count: 0,
      generated_at: new Date().toISOString()
    });

    res.status(201).json({ success: true, explanation: view });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create explanation' });
  }
}

// ============================================
// ✏️ UPDATE EXPLANATION (Admin only)
// ============================================
async function updateExplanation(req, res) {
  const { view_id, title, content, summary } = req.body;
  if (!view_id) return res.status(400).json({ error: 'view_id required' });

  try {
    const updateData = { updated_at: new Date().toISOString() };
    if (title) updateData.title = title;
    if (content) updateData.content = content;
    if (summary !== undefined) updateData.summary = summary;

    const updated = await update('explanation_views', view_id, updateData);
    res.json({ success: true, explanation: updated });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update explanation' });
  }
}

// ============================================
// ✏️ UPDATE DEEP DIVE (Admin only)
// ============================================
async function updateDeepDive(req, res) {
  const { deep_dive_id, answer, question } = req.body;
  if (!deep_dive_id) return res.status(400).json({ error: 'deep_dive_id required' });

  try {
    const updateData = { updated_at: new Date().toISOString() };
    if (answer) updateData.answer = answer;
    if (question) updateData.question = question;

    const updated = await update('deep_dives', deep_dive_id, updateData);
    res.json({ success: true, deep_dive: updated });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update deep dive' });
  }
}

// ============================================
// 🗑️ DELETE EXPLANATION (Admin only)
// ============================================
async function deleteExplanation(req, res) {
  const { view_id } = req.query;
  if (!view_id) return res.status(400).json({ error: 'view_id required' });

  try {
    const view = await getById('explanation_views', view_id);
    if (view) {
      await supabase.from('deep_dives').delete().eq('article_id', view.article_id).eq('profile_id', view.profile_id);
    }
    await deleteRecord('explanation_views', view_id);
    res.json({ success: true, message: 'Explanation deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete explanation' });
  }
}

// ============================================
// 🗑️ DELETE DEEP DIVE (Admin only)
// ============================================
async function deleteDeepDive(req, res) {
  const { deep_dive_id } = req.query;
  if (!deep_dive_id) return res.status(400).json({ error: 'deep_dive_id required' });

  try {
    await deleteRecord('deep_dives', deep_dive_id);
    res.json({ success: true, message: 'Deep dive deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete deep dive' });
  }
}

// ============================================
// 🔄 CLEAR EXPLANATION CACHE (Admin only)
// ============================================
async function clearExplanationCache(req, res) {
  const { article_id } = req.query;
  if (!article_id) return res.status(400).json({ error: 'article_id required' });

  try {
    await supabase.from('deep_dives').delete().eq('article_id', article_id);
    await supabase.from('explanation_views').delete().eq('article_id', article_id);
    res.json({ success: true, message: `Cleared cache for article ${article_id}` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear explanation cache' });
  }
}

// ============================================
// 🔄 BATCH GENERATE EXPLANATIONS (Admin only)
// ============================================
async function batchGenerateExplanations(req, res) {
  const { article_ids, profile_ids = [1] } = req.body;
  if (!article_ids || !Array.isArray(article_ids) || article_ids.length === 0) {
    return res.status(400).json({ error: 'article_ids array required' });
  }

  try {
    const response = await fetch(`${PROCESSOR_URL}/generate-explanations-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_API_KEY },
      body: JSON.stringify({ article_ids, profile_ids }),
      timeout: 300000
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to batch generate explanations' });
  }
}

// ============================================
// 📈 INCREMENT VIEW COUNT
// ============================================
async function incrementViewCount(req, res) {
  const { view_id } = req.body;
  if (!view_id) return res.status(400).json({ error: 'view_id required' });

  try {
    const view = await getById('explanation_views', view_id);
    if (!view) return res.status(404).json({ error: 'Explanation not found' });

    await update('explanation_views', view_id, { view_count: (view.view_count || 0) + 1 });
    res.json({ success: true, view_count: (view.view_count || 0) + 1 });
  } catch (error) {
    res.status(500).json({ error: 'Failed to increment view count' });
  }
}

// ============================================
// ===== HELPER FUNCTIONS =====
// ============================================

async function checkUserCredits(user_id, requiredCredits) {
  if (!user_id) return { allowed: false, credits: 0 };
  const users = await getByColumn('users', 'user_id', user_id);
  if (users.length === 0) return { allowed: false, credits: 0 };

  const user = users[0];
  const credits = typeof user.credits === 'number' ? user.credits : parseFloat(user.credits || 0);
  return {
    allowed: credits >= requiredCredits,
    credits: credits
  };
}

async function deductCredits(user_id, amount, reason, item_id) {
  const users = await getByColumn('users', 'user_id', user_id);
  if (users.length === 0) return;

  const user = users[0];
  const newCredits = Math.max(0, (user.credits || 0) - amount);

  await update('users', user_id, { credits: newCredits });

  await insert('credit_transactions', {
    user_id,
    amount: -amount,
    reason,
    balance_after: newCredits,
    item_id: item_id ? String(item_id) : null
  });
}

function calculateReadingTime(content, wordsPerMinute = 200) {
  if (!content) return 0;
  const words = String(content).split(/\s+/).length;
  return Math.max(1, Math.ceil(words / wordsPerMinute));
}

function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

// ============================================
// 📦 EXPORTS
// ============================================
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export const constants = {
  MAX_CATEGORIES_PER_ARTICLE,
  SIMILARITY_THRESHOLD,
  MAX_DEEP_DIVES_PER_ARTICLE,
  CACHE_TTL_DAYS,
  CREDIT_COSTS
};