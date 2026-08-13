// api/explanation.js

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

import openRouter from '../utils/openrouter.js';
import crypto from 'crypto';

// ============================================
// CONSTANTS
// ============================================
const MAX_CATEGORIES_PER_ARTICLE = 5;
const SIMILARITY_THRESHOLD = 0.7;
const MAX_DEEP_DIVES_PER_ARTICLE = 10;
const CACHE_TTL_DAYS = 30;

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

  if (action === 'get' && view_id) {
    return await getExplanationById(req, res, view_id, user_id);
  }

  if (action === 'get-by-article' && article_id && profile_id) {
    return await getExplanationByArticleProfile(req, res, article_id, profile_id);
  }

  if (action === 'list' && article_id) {
    return await listExplanations(req, res, article_id);
  }

  if (action === 'deep-dive' && deep_dive_id) {
    return await getDeepDiveById(req, res, deep_dive_id);
  }

  if (action === 'deep-dives' && view_id) {
    return await listDeepDives(req, res, view_id);
  }

  if (action === 'search' && search) {
    return await searchExplanations(req, res, search);
  }

  if (action === 'similar' && view_id) {
    return await getSimilarExplanations(req, res, view_id);
  }

  if (action === 'history' && user_id) {
    return await getExplanationHistory(req, res, user_id);
  }

  if (action === 'stats') {
    return await getExplanationStats(req, res);
  }

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

  if (action === 'generate') {
    return await generateExplanation(req, res, user_id);
  }

  if (action === 'deep-dive') {
    return await generateDeepDive(req, res, user_id);
  }

  if (action === 'batch-generate') {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    return await batchGenerateExplanations(req, res);
  }

  if (action === 'regenerate') {
    return await regenerateExplanation(req, res, user_id);
  }

  if (action === 'create') {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    return await createExplanationManually(req, res);
  }

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
// ===== IMPLEMENTATION FUNCTIONS =====
// ============================================

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
// 📖 GET EXPLANATION BY ARTICLE & PROFILE
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
// 📋 LIST EXPLANATIONS FOR ARTICLE
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
// 🚀 GENERATE EXPLANATION
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
    // Check cache
    if (!force) {
      const { data: existing, error: checkError } = await supabase
        .from('explanation_views')
        .select('*')
        .eq('article_id', article_id)
        .eq('profile_id', profile_id)
        .single();

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

    // Get article and profile
    const article = await getById('articles', article_id);
    const profile = await getById('profiles', profile_id);

    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Check user credits
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

    // Process content based on length
    const wordCount = article.base_content?.split(/\s+/).length || 0;
    let processedContent = article.base_content;
    let processingNote = '';

    if (wordCount > 10000 && wordCount <= 50000) {
      processedContent = extractRelevantContent(article.base_content);
      processingNote = 'Content was summarized from a longer article';
    } else if (wordCount > 50000) {
      processedContent = processChunks(article.base_content);
      processingNote = 'Content was processed in chunks from a very long article';
    }

    // Build the prompt using the Explanation Engine prompt template
    const prompt = buildExplanationPrompt(article, profile, processedContent);

    // Call OpenRouter to generate explanation
    const response = await openRouter.generateJSON(prompt, 'explanation', {
      temperature: 0.7,
      maxTokens: 4096
    });

    // Parse the response
    const explanationData = response.parsed;

    // Validate response structure
    if (!explanationData || !explanationData.title || !explanationData.content) {
      throw new Error('Invalid response from AI: Missing required fields');
    }

    // Convert content array to string if needed
    let contentString = explanationData.content;
    if (Array.isArray(contentString)) {
      contentString = contentString
        .map(section => `## ${section.heading}\n\n${section.body}`)
        .join('\n\n');
    }

    // Generate embedding
    const embeddingResult = await openRouter.generateEmbedding(contentString);

    // Save explanation view
    const view = await insert('explanation_views', {
      article_id: parseInt(article_id),
      profile_id: parseInt(profile_id),
      title: explanationData.title,
      content: contentString,
      summary: explanationData.summary || '',
      article_version: article.version || 1,
      profile_version: 1,
      embedding: embeddingResult.embedding,
      view_count: 1,
      rating_avg: 0,
      rating_count: 0,
      generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    // Deduct credits
    if (user_id) {
      await deductCredits(user_id, 0.5, 'explanation_generation', article_id);
    }

    console.log(`✅ Explanation generated for article ${article_id} with profile ${profile_id}`);

    res.status(201).json({
      success: true,
      message: 'Explanation generated successfully',
      processing_note: processingNote,
      explanation: view
    });

  } catch (error) {
    console.error('Generate explanation error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate explanation' });
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
    // Check credits
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

    // Delete existing
    await supabase
      .from('explanation_views')
      .delete()
      .eq('article_id', article_id)
      .eq('profile_id', profile_id);

    // Generate new
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

  if (!article_id || !profile_id || !question) {
    return res.status(400).json({ 
      error: 'article_id, profile_id, and question required' 
    });
  }

  try {
    // Check credits
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

    // Check cache
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

    // Check max deep dives
    const { count: deepDiveCount, error: countError } = await supabase
      .from('deep_dives')
      .select('*', { count: 'exact', head: true })
      .eq('article_id', article_id);

    if (countError) throw countError;

    if (deepDiveCount >= MAX_DEEP_DIVES_PER_ARTICLE) {
      return res.status(429).json({
        error: `Maximum deep dives (${MAX_DEEP_DIVES_PER_ARTICLE}) reached for this article`,
        max: MAX_DEEP_DIVES_PER_ARTICLE
      });
    }

    // Get article and explanation
    const article = await getById('articles', article_id);
    const { data: explanation, error: expError } = await supabase
      .from('explanation_views')
      .select('*')
      .eq('article_id', article_id)
      .eq('profile_id', profile_id)
      .single();

    if (expError && expError.code !== 'PGRST116') throw expError;

    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    // Build deep dive prompt
    const prompt = buildDeepDivePrompt(article, explanation || null, question, parent_section);

    // Generate deep dive with OpenRouter
    const response = await openRouter.generate(prompt, 'deep_dive', {
      temperature: 0.5,
      maxTokens: 2048
    });

    // Save deep dive
    const deepDiveRecord = await insert('deep_dives', {
      article_id: parseInt(article_id),
      profile_id: parseInt(profile_id),
      parent_section: parent_section,
      question: question,
      answer: response.content,
      created_at: new Date().toISOString()
    });

    // Deduct credits
    if (user_id) {
      await deductCredits(user_id, 0.5, 'deep_dive', article_id);
    }

    res.status(201).json({
      success: true,
      message: 'Deep dive generated successfully',
      deep_dive: deepDiveRecord
    });

  } catch (error) {
    console.error('Generate deep dive error:', error);
    res.status(500).json({ error: 'Failed to generate deep dive' });
  }
}

// ============================================
// 🐳 GET DEEP DIVE BY ID
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
// 📋 LIST DEEP DIVES
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
// 🔍 SEARCH EXPLANATIONS
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
// 🔍 GET SIMILAR EXPLANATIONS
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
// 🔍 SEARCH BY EMBEDDING
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
// 📊 GET EXPLANATION STATS
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
// 📖 GET EXPLANATION HISTORY
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
// ✅ CHECK EXPLANATION EXISTS
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
// ➕ CREATE EXPLANATION MANUALLY
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

    let finalEmbedding = embedding;
    if (!finalEmbedding) {
      const embeddingResult = await openRouter.generateEmbedding(content);
      finalEmbedding = embeddingResult.embedding;
    }

    const view = await insert('explanation_views', {
      article_id: parseInt(article_id),
      profile_id: parseInt(profile_id),
      title,
      content,
      summary: summary || null,
      article_version: article.version || 1,
      profile_version: 1,
      embedding: finalEmbedding,
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
// ✏️ UPDATE EXPLANATION
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
    if (content) {
      updateData.content = content;
      const embeddingResult = await openRouter.generateEmbedding(content);
      updateData.embedding = embeddingResult.embedding;
    }
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
// ✏️ UPDATE DEEP DIVE
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
// 🗑️ DELETE EXPLANATION
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
// 🗑️ DELETE DEEP DIVE
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
// 🔄 CLEAR EXPLANATION CACHE
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
    const results = [];
    const errors = [];

    for (const article_id of article_ids) {
      for (const profile_id of profile_ids) {
        try {
          const { data: existing, error: checkError } = await supabase
            .from('explanation_views')
            .select('view_id')
            .eq('article_id', article_id)
            .eq('profile_id', profile_id)
            .single();

          if (checkError && checkError.code !== 'PGRST116') throw checkError;

          if (existing) {
            results.push({
              article_id,
              profile_id,
              status: 'skipped',
              message: 'Already exists'
            });
            continue;
          }

          const reqObj = { body: { article_id, profile_id, force: false } };
          const resObj = {
            json: (data) => data,
            status: (code) => ({ json: (data) => ({ ...data, status: code }) })
          };

          const result = await generateExplanation(reqObj, resObj, null);
          
          results.push({
            article_id,
            profile_id,
            status: 'success',
            view_id: result?.explanation?.view_id
          });
        } catch (error) {
          errors.push({
            article_id,
            profile_id,
            error: error.message
          });
        }
      }
    }

    res.json({
      success: true,
      message: `Batch generation completed: ${results.length} successful, ${errors.length} failed`,
      results,
      errors
    });
  } catch (error) {
    console.error('Batch generate explanations error:', error);
    res.status(500).json({ error: 'Failed to batch generate explanations' });
  }
}

// ============================================
// 📈 INCREMENT VIEW COUNT
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

// Extract relevant content from long articles
function extractRelevantContent(content) {
  const words = content.split(/\s+/);
  if (words.length <= 10000) return content;
  
  const firstPart = words.slice(0, 5000).join(' ');
  const lastPart = words.slice(-2000).join(' ');
  return `${firstPart}\n\n...\n\n${lastPart}`;
}

// Process chunks for extremely large articles
function processChunks(content) {
  const words = content.split(/\s+/);
  if (words.length <= 50000) return content;
  
  const firstPart = words.slice(0, 10000).join(' ');
  const lastPart = words.slice(-5000).join(' ');
  return `${firstPart}\n\n... [Content truncated for processing] ...\n\n${lastPart}`;
}

// ============================================
// PROMPT BUILDERS
// ============================================

function buildExplanationPrompt(article, profile, processedContent) {
  const sourceInfo = [
    article.source_url ? `URL: ${article.source_url}` : '',
    article.source_domain ? `Domain: ${article.source_domain}` : '',
    article.source_published_at ? `Published: ${article.source_published_at}` : ''
  ].filter(Boolean).join('\n');

  return `You are the EasyRead Explanation Engine.

Your job is to transform a factual, profile-agnostic Base Article into a clear, memorable Explanation View using the user's selected Explanation Profile.

Your goal is NOT to rewrite the article word-for-word.

Your goal is to make the underlying knowledge easier for this particular user to understand and remember.

==================================================
CORE PRINCIPLE
==================================================

EXPLAIN THE SAME KNOWLEDGE THROUGH A DIFFERENT MENTAL LENS.

The Base Article contains the facts.

The Explanation Profile determines how those facts should be taught.

The profile may influence:
- Analogies
- Examples
- Comparisons
- Mental models
- Storytelling
- Choice of familiar situations
- Order of explanation where appropriate
- Tone and framing

The profile MUST NOT:
- Change facts
- Invent facts
- Remove important information merely to make the explanation easier
- Present an analogy as literal fact
- Force an analogy where it does not improve understanding
- Distort technical terminology
- Replace necessary technical explanations with oversimplified analogies

ACCURACY ALWAYS HAS PRIORITY OVER PERSONALIZATION.

If the profile does not provide a useful analogy for a concept, explain that concept directly.

==================================================
THE EASYREAD STANDARD
==================================================

Every explanation must pass this test:

"Would this make sense to someone reading it on their phone while half-paying attention on a bus?"

If the answer is no, rewrite it.

The explanation should feel:

- Human
- Warm
- Clear
- Conversational
- Intuitive
- Structured
- Memorable
- Mobile-friendly
- Easy to scan
- Technically responsible

Avoid unnecessary academic language.

Do not make the explanation childish simply because it is easy to understand.

EasyRead means:

SIMPLE LANGUAGE ≠ SHALLOW THINKING.

Preserve the depth of the underlying subject while making the path to understanding easier.

==================================================
INPUTS
==================================================

BASE ARTICLE

Title:
${article.canonical_title}

Canonical Topic:
${article.canonical_title || 'General'}

Content:
${processedContent.substring(0, 8000)}

Summary:
${article.summary || 'No summary provided'}

Categories:
${article.categories?.join(', ') || 'General'}

Source:
${sourceInfo || 'No source information available'}


EXPLANATION PROFILE

Name:
${profile.name}

Description:
${profile.description}

Rules:
${profile.rules || 'No specific rules'}

Profile Version:
${profile.profile_version || 1}

==================================================
STEP 1 — UNDERSTAND BEFORE WRITING
==================================================

Before generating the explanation, internally determine:

1. What is the main subject?
2. What is the central idea?
3. What are the most important concepts?
4. What concepts depend on other concepts?
5. What would a beginner most likely misunderstand?
6. Which concepts are abstract?
7. Which concepts can benefit from the selected profile?
8. Which concepts should simply be explained directly?
9. What must NOT be omitted for the explanation to remain accurate?

Do not expose this internal analysis in the final response.

==================================================
STEP 2 — BUILD A MENTAL MODEL
==================================================

Construct the simplest accurate mental model of the subject.

Identify:

- The thing being explained
- Its purpose
- Its major components
- How the components relate
- What causes what
- What happens before and after
- Why it matters
- Important exceptions or limitations

Use this mental model as the backbone of the explanation.

==================================================
STEP 3 — APPLY THE EXPLANATION PROFILE
==================================================

Use the Explanation Profile as a teaching lens.

For this profile (${profile.name}), use relevant concepts from:

${profile.description}

However:

DO NOT force analogies into every paragraph.

Use them only when they make the underlying concept easier to understand.

Bad:
"Inflation is like a ${profile.name} concept because..."

when the analogy provides no meaningful understanding.

Good:
Use ${profile.name} concepts to explain ranking, competition, or relative performance when that comparison genuinely clarifies the concept.

==================================================
ANALOGY SAFETY RULE
==================================================

Whenever an analogy is used, ensure that the reader can distinguish:

REAL CONCEPT
from
EXPLANATORY ANALOGY.

If there is a risk of confusion, explicitly signal the analogy with phrases such as:

"Think of it like..."
"Imagine..."
"A useful way to picture this is..."
"This is similar to..."

Never allow an analogy to become a substitute for the actual definition.

==================================================
STEP 4 — PRESERVE THE KNOWLEDGE
==================================================

The Base Article is the source of truth.

Do not introduce factual claims that are not supported by the Base Article unless they are necessary for basic clarification and are highly reliable.

Do not fabricate:

- Statistics
- Dates
- Names
- Events
- Definitions
- Examples presented as facts
- Causes
- Relationships
- Technical details

If the Base Article does not contain enough information to confidently explain something, do not invent it.

Instead, explain only what can be supported.

Use wording such as:

"The source explains..."
"The article describes..."
"According to the source..."

when attribution is appropriate.

==================================================
STEP 5 — CREATE THE EXPLANATION STRUCTURE
==================================================

Create an explanation that naturally progresses from simple to complex.

Prefer this general progression:

1. What is it?
2. Why does it matter?
3. How does it work?
4. What are its important parts?
5. How do those parts connect?
6. What does it look like in real life?
7. What commonly causes confusion?
8. What should the reader remember?

Do not mechanically use this structure if the subject requires a different order.

The structure should serve understanding.

==================================================
TITLE
==================================================

Generate a title that:

- Creates curiosity
- Is clear
- Is not clickbait
- Does not exaggerate
- Does not overwhelm
- Reflects the actual subject

The title should make the reader want to understand the concept.

==================================================
CONTENT
==================================================

Write the explanation using short, readable sections.

Each section should have a useful heading.

Avoid:

- Giant paragraphs
- Unnecessary introductions
- Repetitive explanations
- Excessive jargon
- Empty motivational language
- Artificially clever analogies
- Filler

When a technical term is necessary:

1. Give the term.
2. Explain it simply.
3. Connect it to the bigger idea.

Example:

"Liquidity sounds technical, but the idea is simple: how easily something can be turned into cash without losing much of its value."

Then continue with the deeper explanation.

==================================================
EXAMPLES
==================================================

Use examples strategically.

Examples should make an abstract idea concrete.

Prefer:

- Everyday situations
- Simple scenarios
- Profile-related examples
- Small numerical examples where useful
- Cause-and-effect scenarios

Do not add examples merely to increase length.

Every example must help answer:

"Why should I care?"

or

"How does this actually work?"

==================================================
TECHNICAL DEPTH
==================================================

Do not oversimplify a subject to the point of becoming inaccurate.

If the subject is technical:

Start with intuition.

Then introduce the formal concept.

Then explain the relationship between the parts.

Then provide the deeper detail.

Use the pattern:

INTUITION
↓
SIMPLE EXPLANATION
↓
FORMAL CONCEPT
↓
EXAMPLE
↓
DEEPER UNDERSTANDING

==================================================
"SO BASICALLY..." SUMMARY
==================================================

End with a concise summary that ties everything together.

The summary should answer:

"If I remember only the main idea, what should I remember?"

It should feel like the moment where the entire explanation clicks.

Do not simply repeat the introduction.

==================================================
QUALITY CHECK
==================================================

Before returning the answer, silently evaluate it against these questions:

1. Is every important fact preserved?
2. Did the explanation change the meaning of anything?
3. Did I accidentally invent information?
4. Did I force the Explanation Profile into places where it does not help?
5. Are analogies clearly distinguishable from facts?
6. Would a beginner understand the explanation?
7. Is the explanation still technically responsible?
8. Does each section have a purpose?
9. Is unnecessary jargon removed or explained?
10. Does the explanation work well on a phone?
11. Does the explanation actually feel personalized to the selected profile?
12. Is the summary genuinely useful?
13. Is anything unnecessarily repetitive?
14. Could any paragraph be made clearer without losing important information?

If any answer is unsatisfactory, revise before returning the result.

==================================================
OUTPUT FORMAT
==================================================

Return ONLY valid JSON.

{
  "title": "Hook that makes you curious instead of overwhelmed",
  "content": [
    {
      "heading": "What is [topic]?",
      "body": "Clear explanation..."
    },
    {
      "heading": "Why does [topic] matter?",
      "body": "Explanation of importance..."
    },
    {
      "heading": "How does [topic] work?",
      "body": "Detailed breakdown..."
    }
  ],
  "summary": "The 'so basically...' moment that ties it all together."
}

Do not include:

- Markdown fences
- Commentary
- Analysis
- Internal reasoning
- Notes about the prompt
- Information outside the requested JSON structure

==================================================
FINAL PRINCIPLE
==================================================

Do not make the reader feel like they are reading an AI-generated explanation.

Make them feel like someone finally explained the subject in a way that makes sense to them.

The objective is not:

"Make this article simpler."

The objective is:

"Make this knowledge click."`;
}

// Build deep dive prompt
function buildDeepDivePrompt(article, explanation, question, parentSection) {
  return `You are the EasyRead Deep Dive Engine.

Your job is to extend an existing Explanation View by answering a specific user question in greater depth.

The user has already read this explanation:

Article: ${article.canonical_title}
${explanation ? `Existing Explanation: ${explanation.title}` : 'No existing explanation found'}

Parent Section: ${parentSection}

User Question: ${question}

Provide a thorough, extended answer that:

1. Directly addresses the question
2. Goes deeper than the main explanation
3. Uses more examples and analogies
4. Maintains the same style and tone as the explanation
5. Is clear and easy to understand

Rules:
- Only use information from the source article
- Never invent information
- Use "source says" instead of "AI says" when appropriate
- Keep it conversational and warm

Return the answer as formatted markdown.`;
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