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
// CONSTANTS
// ============================================
const MAX_CATEGORIES_PER_ARTICLE = 5;
const SIMILARITY_THRESHOLD = 0.7;
const MAX_DEEP_DIVES_PER_ARTICLE = 10;
const CACHE_TTL_DAYS = 30;

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
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-api-key, x-user-id, x-admin-key'
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
    user_id,
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
  const { user_id } = req.query;

  // Generate explanation - calls Render
  if (action === 'generate') {
    return await generateExplanation(req, res, user_id);
  }

  // Generate deep dive - calls Render
  if (action === 'deep-dive') {
    return await generateDeepDive(req, res, user_id);
  }

  // Batch generate explanations - calls Render
  if (action === 'batch-generate') {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    return await batchGenerateExplanations(req, res);
  }

  // Regenerate explanation - calls Render
  if (action === 'regenerate') {
    return await regenerateExplanation(req, res, user_id);
  }

  // Create explanation manually (admin only - direct DB)
  if (action === 'create') {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    return await createExplanationManually(req, res);
  }

  // Search by embedding (direct DB)
  if (action === 'search-by-embedding') {
    return await searchByEmbedding(req, res);
  }

  res.status(400).json({ error: 'Invalid action' });
}

// ============================================
// PUT HANDLER
// ============================================
async function handlePut(req, res, action) {
  const { user_id } = req.query;

  // Update explanation (admin only - direct DB)
  if (action === 'update') {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    return await updateExplanation(req, res);
  }

  // Update deep dive (admin only - direct DB)
  if (action === 'update-deep-dive') {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    return await updateDeepDive(req, res);
  }

  // Increment view count (direct DB)
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

  // Delete explanation (admin only - direct DB)
  if (action === 'delete') {
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    return await deleteExplanation(req, res);
  }

  // Delete deep dive (admin only - direct DB)
  if (action === 'delete-deep-dive') {
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    return await deleteDeepDive(req, res);
  }

  // Clear explanation cache (admin only - direct DB)
  if (action === 'clear-cache') {
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    return await clearExplanationCache(req, res);
  }

  res.status(400).json({ error: 'Invalid action' });
}

// ============================================
// ===== IMPLEMENTATION FUNCTIONS =====
// ============================================

// ============================================
// 📖 GET EXPLANATION BY ID (Direct DB)
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

    if (error) throw error;
    if (!view) {
      return res.status(404).json({ error: 'Explanation not found' });
    }

    // Increment view count
    await update('explanation_views', view_id, {
      view_count: (view.view_count || 0) + 1
    });

    // Get deep dives
    const { data: deepDives, error: ddError } = await supabase
      .from('deep_dives')
      .select('*')
      .eq('article_id', view.article_id)
      .eq('profile_id', view.profile_id)
      .order('created_at', { ascending: false });

    if (ddError) throw ddError;

    // Get user rating
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

    const readingTime = calculateReadingTime(view.content);

    res.json({
      success: true,
      explanation: {
        ...view,
        reading_time: readingTime,
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
// 📖 GET EXPLANATION BY ARTICLE & PROFILE (Direct DB)
// ============================================
async function getExplanationByArticleProfile(req, res, article_id, profile_id) {
  try {
    const { data: view, error } = await supabase
      .from('explanation_views')
      .select(`
        *,
        articles:article_id (
          canonical_title,
          slug,
          categories,
          source_domain
        ),
        profiles:profile_id (
          name,
          description,
          rules
        )
      `)
      .eq('article_id', article_id)
      .eq('profile_id', profile_id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    if (!view) {
      return res.status(404).json({
        error: 'Explanation not found for this article and profile'
      });
    }

    // Get deep dives
    const { data: deepDives, error: ddError } = await supabase
      .from('deep_dives')
      .select('*')
      .eq('article_id', article_id)
      .eq('profile_id', profile_id)
      .order('created_at', { ascending: false });

    if (ddError) throw ddError;

    res.json({
      success: true,
      explanation: {
        ...view,
        deep_dives: deepDives || [],
        reading_time: calculateReadingTime(view.content)
      }
    });
  } catch (error) {
    console.error('Get explanation by article/profile error:', error);
    res.status(500).json({ error: 'Failed to get explanation' });
  }
}

// ============================================
// 📋 LIST EXPLANATIONS FOR ARTICLE (Direct DB)
// ============================================
async function listExplanations(req, res, article_id) {
  const { page = 1, limit = 20 } = req.query;

  try {
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data: explanations, error, count } = await supabase
      .from('explanation_views')
      .select(`
        *,
        profiles:profile_id (
          name,
          description
        )
      `, { count: 'exact' })
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
      explanations: explanations.map(e => ({
        ...e,
        reading_time: calculateReadingTime(e.content)
      }))
    });
  } catch (error) {
    console.error('List explanations error:', error);
    res.status(500).json({ error: 'Failed to list explanations' });
  }
}

// ============================================
// 🚀 GENERATE EXPLANATION (Calls Render)
// ============================================
async function generateExplanation(req, res, user_id) {
  const {
    article_id,
    profile_id,
    force = false
  } = req.body;

  if (!article_id || !profile_id) {
    return res.status(400).json({ error: 'article_id and profile_id required' });
  }

  try {
    // 1. Check cache (if not forcing regenerate)
    if (!force) {
      const { data: existing, error: checkError } = await supabase
        .from('explanation_views')
        .select('*')
        .eq('article_id', article_id)
        .eq('profile_id', profile_id)
        .single();

      if (checkError && checkError.code !== 'PGRST116') throw checkError;

      if (existing) {
        // Increment view count
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

    // 2. Check user credits (if authenticated)
    if (user_id) {
      const users = await getByColumn('users', 'user_id', user_id);
      if (users.length > 0) {
        const user = users[0];
        if (user.credits < 0.5) {
          return res.status(402).json({
            error: 'Insufficient credits',
            required: 0.5,
            available: user.credits
          });
        }
      }
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
      timeout: 120000 // 2 minutes timeout
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Processor returned ${response.status}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to generate explanation');
    }

    // 4. Deduct credits if user (and not cached)
    if (user_id && !data.cached) {
      await deductCredits(user_id, 0.5, 'explanation_generation', article_id);
    }

    // 5. Get the generated explanation from database
    const { data: explanation, error: fetchError } = await supabase
      .from('explanation_views')
      .select('*')
      .eq('article_id', article_id)
      .eq('profile_id', profile_id)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      console.warn('Could not fetch generated explanation:', fetchError.message);
    }

    return res.json({
      success: true,
      cached: data.cached || false,
      explanation: explanation || data.explanation,
      processing_note: data.processing_note || '',
      message: data.message || 'Explanation generated successfully'
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

  if (!article_id || !profile_id) {
    return res.status(400).json({ error: 'article_id and profile_id required' });
  }

  try {
    // Check credits for regeneration
    if (user_id) {
      const users = await getByColumn('users', 'user_id', user_id);
      if (users.length > 0) {
        const user = users[0];
        if (user.credits < 1) {
          return res.status(402).json({
            error: 'Insufficient credits for regeneration',
            required: 1,
            available: user.credits
          });
        }
      }
    }

    // Delete existing explanation
    await supabase
      .from('explanation_views')
      .delete()
      .eq('article_id', article_id)
      .eq('profile_id', profile_id);

    // Call generate with force=true
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
// 🐳 GENERATE DEEP DIVE (Calls Render)
// ============================================
async function generateDeepDive(req, res, user_id) {
  const {
    article_id,
    profile_id,
    question,
    parent_section = 'General'
  } = req.body;

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
      .single();

    if (checkError && checkError.code !== 'PGRST116') throw checkError;

    if (existing) {
      return res.json({
        success: true,
        cached: true,
        deep_dive: existing,
        message: 'Deep dive retrieved from cache'
      });
    }

    // 2. Check max deep dives per article (10 max)
    const { count: deepDiveCount, error: countError } = await supabase
      .from('deep_dives')
      .select('*', { count: 'exact', head: true })
      .eq('article_id', article_id);

    if (countError) throw countError;

    if (deepDiveCount >= 10) {
      return res.status(429).json({
        error: `Maximum deep dives (10) reached for this article`
      });
    }

    // 3. Check user credits
    if (user_id) {
      const users = await getByColumn('users', 'user_id', user_id);
      if (users.length > 0) {
        const user = users[0];
        if (user.credits < 0.5) {
          return res.status(402).json({
            error: 'Insufficient credits',
            required: 0.5,
            available: user.credits
          });
        }
      }
    }

    // 4. Call Render's processor API for deep dive
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
        user_id: user_id || null
      }),
      timeout: 60000 // 1 minute timeout
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Processor returned ${response.status}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to generate deep dive');
    }

    // 5. Deduct credits if user (and not cached)
    if (user_id && !data.cached) {
      await deductCredits(user_id, 0.5, 'deep_dive', article_id);
    }

    // 6. Get the generated deep dive from database
    const { data: deepDive, error: fetchError } = await supabase
      .from('deep_dives')
      .select('*')
      .eq('article_id', article_id)
      .eq('profile_id', profile_id)
      .eq('question', question)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      console.warn('Could not fetch generated deep dive:', fetchError.message);
    }

    return res.json({
      success: true,
      cached: data.cached || false,
      deep_dive: deepDive || data.deep_dive,
      message: data.message || 'Deep dive generated successfully'
    });

  } catch (error) {
    console.error('Generate deep dive error:', error);
    return res.status(500).json({ error: error.message || 'Failed to generate deep dive' });
  }
}

// ============================================
// 🐳 GET DEEP DIVE BY ID (Direct DB)
// ============================================
async function getDeepDiveById(req, res, deep_dive_id) {
  try {
    const deepDive = await getById('deep_dives', deep_dive_id);

    if (!deepDive) {
      return res.status(404).json({ error: 'Deep dive not found' });
    }

    const article = await getById('articles', deepDive.article_id);
    const profile = await getById('profiles', deepDive.profile_id);

    res.json({
      success: true,
      deep_dive: {
        ...deepDive,
        article: article ? {
          id: article.article_id,
          title: article.canonical_title,
          slug: article.slug
        } : null,
        profile: profile ? {
          id: profile.profile_id,
          name: profile.name
        } : null
      }
    });
  } catch (error) {
    console.error('Get deep dive error:', error);
    res.status(500).json({ error: 'Failed to get deep dive' });
  }
}

// ============================================
// 📋 LIST DEEP DIVES (Direct DB)
// ============================================
async function listDeepDives(req, res, view_id) {
  const { page = 1, limit = 20 } = req.query;

  try {
    const view = await getById('explanation_views', view_id);
    if (!view) {
      return res.status(404).json({ error: 'Explanation view not found' });
    }

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
    console.error('List deep dives error:', error);
    res.status(500).json({ error: 'Failed to list deep dives' });
  }
}

// ============================================
// 🔍 SEARCH EXPLANATIONS (Direct DB)
// ============================================
async function searchExplanations(req, res, search) {
  const {
    page = 1,
    limit = 20,
    profile_id,
    category,
    sort_by = 'relevance'
  } = req.query;

  try {
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase
      .from('explanation_views')
      .select(`
        *,
        articles:article_id (
          canonical_title,
          slug,
          categories,
          source_domain
        ),
        profiles:profile_id (
          name,
          description
        )
      `, { count: 'exact' });

    if (search) {
      query = query.textSearch('content', search, {
        config: 'english',
        type: 'websearch'
      });
    }

    if (profile_id) {
      query = query.eq('profile_id', profile_id);
    }

    if (category) {
      query = query.contains('articles.categories', [category]);
    }

    if (sort_by === 'relevance' && search) {
      query = query.order('generated_at', { ascending: false });
    } else if (sort_by === 'views') {
      query = query.order('view_count', { ascending: false });
    } else if (sort_by === 'rating') {
      query = query.order('rating_avg', { ascending: false });
    } else {
      query = query.order('generated_at', { ascending: false });
    }

    query = query.range(from, to);

    const { data, error, count } = await query;

    if (error) throw error;

    res.json({
      success: true,
      query: search,
      page: parseInt(page),
      limit: parseInt(limit),
      total: count || 0,
      explanations: data.map(e => ({
        ...e,
        reading_time: calculateReadingTime(e.content)
      }))
    });
  } catch (error) {
    console.error('Search explanations error:', error);
    res.status(500).json({ error: 'Failed to search explanations' });
  }
}

// ============================================
// 🔍 GET SIMILAR EXPLANATIONS (Direct DB)
// ============================================
async function getSimilarExplanations(req, res, view_id) {
  const { limit = 5, threshold = SIMILARITY_THRESHOLD } = req.query;

  try {
    const view = await getById('explanation_views', view_id);
    if (!view) {
      return res.status(404).json({ error: 'Explanation not found' });
    }

    if (!view.embedding) {
      return res.status(400).json({
        error: 'Explanation has no embedding. Process it first.'
      });
    }

    const similar = await findSimilarExplanations(
      view.embedding,
      parseFloat(threshold),
      parseInt(limit) + 1
    );

    const filtered = similar.filter(s => s.view_id !== parseInt(view_id));

    const viewIds = filtered.map(s => s.view_id);
    const { data: explanations, error } = await supabase
      .from('explanation_views')
      .select(`
        *,
        articles:article_id (canonical_title, slug),
        profiles:profile_id (name)
      `)
      .in('view_id', viewIds);

    if (error) throw error;

    const similarWithScores = explanations.map(e => ({
      ...e,
      similarity: filtered.find(f => f.view_id === e.view_id)?.similarity || 0,
      reading_time: calculateReadingTime(e.content)
    })).sort((a, b) => b.similarity - a.similarity);

    res.json({
      success: true,
      view_id,
      similar_explanations: similarWithScores
    });
  } catch (error) {
    console.error('Get similar explanations error:', error);
    res.status(500).json({ error: 'Failed to get similar explanations' });
  }
}

// ============================================
// 🔍 SEARCH BY EMBEDDING (Direct DB)
// ============================================
async function searchByEmbedding(req, res) {
  const { embedding, threshold = SIMILARITY_THRESHOLD, limit = 10 } = req.body;

  if (!embedding) {
    return res.status(400).json({ error: 'Embedding required' });
  }

  try {
    const results = await findSimilarExplanations(
      embedding,
      parseFloat(threshold),
      parseInt(limit)
    );

    const viewIds = results.map(r => r.view_id);
    const { data: explanations, error } = await supabase
      .from('explanation_views')
      .select(`
        *,
        articles:article_id (canonical_title, slug),
        profiles:profile_id (name)
      `)
      .in('view_id', viewIds);

    if (error) throw error;

    const similarWithScores = explanations.map(e => ({
      ...e,
      similarity: results.find(r => r.view_id === e.view_id)?.similarity || 0,
      reading_time: calculateReadingTime(e.content)
    })).sort((a, b) => b.similarity - a.similarity);

    res.json({
      success: true,
      results: similarWithScores
    });
  } catch (error) {
    console.error('Search by embedding error:', error);
    res.status(500).json({ error: 'Failed to search by embedding' });
  }
}

// ============================================
// 📊 GET EXPLANATION STATS (Direct DB)
// ============================================
async function getExplanationStats(req, res) {
  try {
    const { count: totalExplanations, error: countError } = await supabase
      .from('explanation_views')
      .select('*', { count: 'exact', head: true });

    if (countError) throw countError;

    const { data: viewData, error: viewError } = await supabase
      .from('explanation_views')
      .select('view_count');

    if (viewError) throw viewError;

    const totalViews = viewData?.reduce((sum, v) => sum + (v.view_count || 0), 0) || 0;

    const { data: ratingData, error: ratingError } = await supabase
      .from('explanation_views')
      .select('rating_avg, rating_count')
      .not('rating_count', 'eq', 0);

    if (ratingError) throw ratingError;

    const avgRating = ratingData?.length > 0
      ? ratingData.reduce((sum, r) => sum + (r.rating_avg || 0), 0) / ratingData.length
      : 0;

    const { data: mostViewed, error: mvError } = await supabase
      .from('explanation_views')
      .select(`
        view_id,
        title,
        view_count,
        articles:article_id (canonical_title),
        profiles:profile_id (name)
      `)
      .order('view_count', { ascending: false })
      .limit(10);

    if (mvError) throw mvError;

    const { data: topRated, error: trError } = await supabase
      .from('explanation_views')
      .select(`
        view_id,
        title,
        rating_avg,
        rating_count,
        articles:article_id (canonical_title),
        profiles:profile_id (name)
      `)
      .not('rating_count', 'eq', 0)
      .order('rating_avg', { ascending: false })
      .limit(10);

    if (trError) throw trError;

    const { data: profileData, error: profileError } = await supabase
      .from('explanation_views')
      .select('profile_id, profiles(name)')
      .not('profile_id', 'is', null);

    if (profileError) throw profileError;

    const profileStats = {};
    profileData?.forEach(p => {
      const name = p.profiles?.name || 'Unknown';
      profileStats[name] = (profileStats[name] || 0) + 1;
    });

    res.json({
      success: true,
      stats: {
        total_explanations: totalExplanations || 0,
        total_views: totalViews,
        average_rating: Math.round(avgRating * 100) / 100 || 0,
        top_rated: topRated || [],
        most_viewed: mostViewed || [],
        by_profile: profileStats,
        rating_distribution: {
          has_ratings: ratingData?.filter(r => r.rating_count > 0).length || 0,
          no_ratings: (totalExplanations || 0) - (ratingData?.filter(r => r.rating_count > 0).length || 0)
        }
      }
    });
  } catch (error) {
    console.error('Get explanation stats error:', error);
    res.status(500).json({ error: 'Failed to get explanation stats' });
  }
}

// ============================================
// 📖 GET EXPLANATION HISTORY (Direct DB)
// ============================================
async function getExplanationHistory(req, res, user_id) {
  const { limit = 50 } = req.query;

  try {
    const { data: history, error } = await supabase
      .from('reading_history')
      .select(`
        *,
        articles:article_id (
          canonical_title,
          slug,
          categories,
          summary
        )
      `)
      .eq('user_id', user_id)
      .order('viewed_at', { ascending: false })
      .limit(parseInt(limit));

    if (error) throw error;

    const articleIds = history?.map(h => h.article_id) || [];
    const { data: explanations, error: expError } = await supabase
      .from('explanation_views')
      .select(`
        *,
        articles:article_id (canonical_title, slug),
        profiles:profile_id (name)
      `)
      .in('article_id', articleIds);

    if (expError) throw expError;

    const expByArticle = {};
    explanations?.forEach(e => {
      if (!expByArticle[e.article_id]) {
        expByArticle[e.article_id] = [];
      }
      expByArticle[e.article_id].push(e);
    });

    const historyWithExplanations = history?.map(h => ({
      ...h,
      explanations: expByArticle[h.article_id] || [],
      reading_time: h.articles ? calculateReadingTime(h.articles.summary) : 0
    })) || [];

    res.json({
      success: true,
      history: historyWithExplanations,
      total: historyWithExplanations.length
    });
  } catch (error) {
    console.error('Get explanation history error:', error);
    res.status(500).json({ error: 'Failed to get explanation history' });
  }
}

// ============================================
// ✅ CHECK EXPLANATION EXISTS (Direct DB)
// ============================================
async function checkExplanationExists(req, res, article_id, profile_id) {
  try {
    const { data: view, error } = await supabase
      .from('explanation_views')
      .select('view_id, title, generated_at, view_count')
      .eq('article_id', article_id)
      .eq('profile_id', profile_id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    res.json({
      success: true,
      exists: !!view,
      explanation: view || null
    });
  } catch (error) {
    console.error('Check explanation exists error:', error);
    res.status(500).json({ error: 'Failed to check explanation' });
  }
}

// ============================================
// ➕ CREATE EXPLANATION MANUALLY (Admin only - Direct DB)
// ============================================
async function createExplanationManually(req, res) {
  const {
    article_id,
    profile_id,
    title,
    content,
    summary,
    embedding = null
  } = req.body;

  if (!article_id || !profile_id || !title || !content) {
    return res.status(400).json({
      error: 'article_id, profile_id, title, and content required'
    });
  }

  try {
    const article = await getById('articles', article_id);
    const profile = await getById('profiles', profile_id);

    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const { data: existing, error: checkError } = await supabase
      .from('explanation_views')
      .select('view_id')
      .eq('article_id', article_id)
      .eq('profile_id', profile_id)
      .single();

    if (checkError && checkError.code !== 'PGRST116') throw checkError;

    if (existing) {
      return res.status(409).json({
        error: 'Explanation already exists',
        view_id: existing.view_id
      });
    }

    const view = await insert('explanation_views', {
      article_id: parseInt(article_id),
      profile_id: parseInt(profile_id),
      title,
      content,
      summary: summary || null,
      article_version: article.version || 1,
      profile_version: 1,
      embedding: embedding || null,
      view_count: 0,
      rating_avg: 0,
      rating_count: 0,
      generated_at: new Date().toISOString()
    });

    res.status(201).json({
      success: true,
      message: 'Explanation created manually',
      explanation: view
    });
  } catch (error) {
    console.error('Create explanation manually error:', error);
    res.status(500).json({ error: 'Failed to create explanation' });
  }
}

// ============================================
// ✏️ UPDATE EXPLANATION (Admin only - Direct DB)
// ============================================
async function updateExplanation(req, res) {
  const { view_id, title, content, summary } = req.body;

  if (!view_id) {
    return res.status(400).json({ error: 'view_id required' });
  }

  try {
    const updateData = {
      updated_at: new Date().toISOString()
    };

    if (title) updateData.title = title;
    if (content) updateData.content = content;
    if (summary !== undefined) updateData.summary = summary;

    const updated = await update('explanation_views', view_id, updateData);

    if (!updated) {
      return res.status(404).json({ error: 'Explanation not found' });
    }

    res.json({
      success: true,
      message: 'Explanation updated successfully',
      explanation: updated
    });
  } catch (error) {
    console.error('Update explanation error:', error);
    res.status(500).json({ error: 'Failed to update explanation' });
  }
}

// ============================================
// ✏️ UPDATE DEEP DIVE (Admin only - Direct DB)
// ============================================
async function updateDeepDive(req, res) {
  const { deep_dive_id, answer, question } = req.body;

  if (!deep_dive_id) {
    return res.status(400).json({ error: 'deep_dive_id required' });
  }

  try {
    const updateData = {
      updated_at: new Date().toISOString()
    };

    if (answer) updateData.answer = answer;
    if (question) updateData.question = question;

    const updated = await update('deep_dives', deep_dive_id, updateData);

    if (!updated) {
      return res.status(404).json({ error: 'Deep dive not found' });
    }

    res.json({
      success: true,
      message: 'Deep dive updated successfully',
      deep_dive: updated
    });
  } catch (error) {
    console.error('Update deep dive error:', error);
    res.status(500).json({ error: 'Failed to update deep dive' });
  }
}

// ============================================
// 🗑️ DELETE EXPLANATION (Admin only - Direct DB)
// ============================================
async function deleteExplanation(req, res) {
  const { view_id } = req.query;

  if (!view_id) {
    return res.status(400).json({ error: 'view_id required' });
  }

  try {
    const view = await getById('explanation_views', view_id);
    if (view) {
      await supabase
        .from('deep_dives')
        .delete()
        .eq('article_id', view.article_id)
        .eq('profile_id', view.profile_id);
    }

    await deleteRecord('explanation_views', view_id);

    res.json({
      success: true,
      message: 'Explanation and associated deep dives deleted successfully'
    });
  } catch (error) {
    console.error('Delete explanation error:', error);
    res.status(500).json({ error: 'Failed to delete explanation' });
  }
}

// ============================================
// 🗑️ DELETE DEEP DIVE (Admin only - Direct DB)
// ============================================
async function deleteDeepDive(req, res) {
  const { deep_dive_id } = req.query;

  if (!deep_dive_id) {
    return res.status(400).json({ error: 'deep_dive_id required' });
  }

  try {
    await deleteRecord('deep_dives', deep_dive_id);
    res.json({
      success: true,
      message: 'Deep dive deleted successfully'
    });
  } catch (error) {
    console.error('Delete deep dive error:', error);
    res.status(500).json({ error: 'Failed to delete deep dive' });
  }
}

// ============================================
// 🔄 CLEAR EXPLANATION CACHE (Admin only - Direct DB)
// ============================================
async function clearExplanationCache(req, res) {
  const { article_id } = req.query;

  if (!article_id) {
    return res.status(400).json({ error: 'article_id required' });
  }

  try {
    const { data: explanations, error } = await supabase
      .from('explanation_views')
      .select('view_id')
      .eq('article_id', article_id);

    if (error) throw error;

    for (const exp of explanations) {
      const view = await getById('explanation_views', exp.view_id);
      if (view) {
        await supabase
          .from('deep_dives')
          .delete()
          .eq('article_id', view.article_id)
          .eq('profile_id', view.profile_id);
      }

      await deleteRecord('explanation_views', exp.view_id);
    }

    res.json({
      success: true,
      message: `Cleared ${explanations.length} explanations for article ${article_id}`,
      cleared_count: explanations.length
    });
  } catch (error) {
    console.error('Clear explanation cache error:', error);
    res.status(500).json({ error: 'Failed to clear explanation cache' });
  }
}

// ============================================
// 🔄 BATCH GENERATE EXPLANATIONS
// ============================================
async function batchGenerateExplanations(req, res) {
  const { article_ids, profile_ids = [1] } = req.body;

  if (!article_ids || !Array.isArray(article_ids) || article_ids.length === 0) {
    return res.status(400).json({ error: 'article_ids array required' });
  }

  try {
    // Call Render's batch endpoint
    const response = await fetch(`${PROCESSOR_URL}/generate-explanations-batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': ADMIN_API_KEY
      },
      body: JSON.stringify({
        article_ids,
        profile_ids
      }),
      timeout: 300000 // 5 minutes timeout
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Processor returned ${response.status}`);
    }

    const data = await response.json();
    res.json(data);

  } catch (error) {
    console.error('Batch generate explanations error:', error);
    res.status(500).json({ error: 'Failed to batch generate explanations' });
  }
}

// ============================================
// 📈 INCREMENT VIEW COUNT (Direct DB)
// ============================================
async function incrementViewCount(req, res) {
  const { view_id } = req.body;

  if (!view_id) {
    return res.status(400).json({ error: 'view_id required' });
  }

  try {
    const view = await getById('explanation_views', view_id);
    if (!view) {
      return res.status(404).json({ error: 'Explanation not found' });
    }

    await update('explanation_views', view_id, {
      view_count: (view.view_count || 0) + 1
    });

    res.json({
      success: true,
      message: 'View count incremented',
      view_count: (view.view_count || 0) + 1
    });
  } catch (error) {
    console.error('Increment view count error:', error);
    res.status(500).json({ error: 'Failed to increment view count' });
  }
}

// ============================================
// ===== HELPER FUNCTIONS =====
// ============================================

// Calculate reading time
function calculateReadingTime(content, wordsPerMinute = 200) {
  if (!content) return 0;
  const words = content.split(/\s+/).length;
  return Math.max(1, Math.ceil(words / wordsPerMinute));
}

// Deduct credits helper
async function deductCredits(user_id, amount, reason, item_id) {
  const users = await getByColumn('users', 'user_id', user_id);
  if (users.length === 0) return;

  const user = users[0];
  const newCredits = user.credits - amount;

  await update('users', user_id, { credits: newCredits });

  await insert('credit_transactions', {
    user_id,
    amount: -amount,
    reason,
    balance_after: newCredits,
    item_id: item_id || null
  });
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
  CACHE_TTL_DAYS
};