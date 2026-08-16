// api/articles.js
// EasyRead Article Management - Database operations, Bookmarks, and Reading History

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
  findSimilarArticles
} from '../utils/supabase.js';
import crypto from 'crypto';

// ============================================
// CONSTANTS
// ============================================
const MAX_CATEGORIES_PER_ARTICLE = 5;
const MIN_WORD_COUNT = 200;
const REFRESH_INTERVAL_DAYS = 14; // 2 weeks
const SIMILARITY_THRESHOLD = 0.7;

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
    console.error('Articles API Error:', error);
    res.status(500).json({ error: error.message });
  }
}

// ============================================
// GET HANDLER
// ============================================
async function handleGet(req, res, action) {
  const { 
    id, 
    slug, 
    page = 1, 
    limit = 20, 
    category, 
    search
  } = req.query;

  const user_id = req.headers['x-user-id'] || req.query.user_id;

  // Get user bookmarks with full article data and stats
  if (action === 'bookmarks') {
    return await getBookmarksForUser(req, res, user_id);
  }

  // Get user reading history
  if (action === 'history') {
    return await getReadingHistory(req, res, user_id);
  }

  // Get article by ID
  if (action === 'get' && id) {
    return await getArticleById(req, res, id, user_id);
  }

  // Get article by slug
  if (action === 'get-by-slug' && slug) {
    return await getArticleBySlug(req, res, slug, user_id);
  }

  // List articles
  if (!action || action === 'list') {
    return await listArticles(req, res);
  }

  // Get article versions
  if (action === 'versions' && id) {
    return await getArticleVersions(req, res, id);
  }

  // Get similar articles
  if (action === 'similar' && id) {
    return await getSimilarArticles(req, res, id);
  }

  // Search articles
  if (action === 'search' && search) {
    return await searchArticles(req, res, search);
  }

  // Get articles by category
  if (action === 'by-category' && category) {
    return await getArticlesByCategory(req, res, category);
  }

  // Get article ratings
  if (action === 'ratings' && id) {
    return await getArticleRatings(req, res, id);
  }

  // Get random articles
  if (action === 'random') {
    return await getRandomArticles(req, res);
  }

  // Check if article exists
  if (action === 'check' && slug) {
    return await checkArticleExists(req, res, slug);
  }

  res.status(400).json({ error: 'Invalid action or missing parameters' });
}

// ============================================
// POST HANDLER
// ============================================
async function handlePost(req, res, action) {
  const user_id = req.headers['x-user-id'] || req.query.user_id;

  // Create article
  if (action === 'create') {
    return await createArticle(req, res);
  }

  // Submit context (URL or text)
  if (action === 'submit-context') {
    return await submitContext(req, res);
  }

  // Bookmark article
  if (action === 'bookmark') {
    return await bookmarkArticle(req, res, user_id);
  }

  // Rate article
  if (action === 'rate') {
    return await rateArticle(req, res, user_id);
  }

  // Refresh article
  if (action === 'refresh') {
    return await refreshArticle(req, res);
  }

  // Track view / record history
  if (action === 'track-view') {
    return await trackView(req, res, user_id);
  }

  res.status(400).json({ error: 'Invalid action' });
}

// ============================================
// PUT HANDLER
// ============================================
async function handlePut(req, res, action) {
  const user_id = req.headers['x-user-id'] || req.query.user_id;

  // Update article
  if (action === 'update') {
    return await updateArticle(req, res);
  }

  // Update article status
  if (action === 'update-status') {
    return await updateArticleStatus(req, res);
  }

  // Toggle bookmark
  if (action === 'toggle-bookmark') {
    return await toggleBookmark(req, res, user_id);
  }

  // Update reading progress
  if (action === 'update-progress') {
    return await updateReadingProgress(req, res, user_id);
  }

  res.status(400).json({ error: 'Invalid action' });
}

// ============================================
// DELETE HANDLER
// ============================================
async function handleDelete(req, res, action) {
  const adminKey = req.headers['x-admin-key'];

  // Delete article (admin only)
  if (action === 'delete') {
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    return await deleteArticle(req, res);
  }

  // Remove bookmark
  if (action === 'remove-bookmark') {
    return await removeBookmark(req, res);
  }

  res.status(400).json({ error: 'Invalid action' });
}

// ============================================
// 🔖 GET USER BOOKMARKS (NEW DEDICATED ENDPOINT)
// ============================================
async function getBookmarksForUser(req, res, user_id) {
  const { limit = 50, page = 1 } = req.query;

  if (!user_id) {
    return res.status(401).json({ error: 'Authentication required', bookmarks: [], total: 0 });
  }

  try {
    const from = (parseInt(page) - 1) * parseInt(limit);
    const to = from + parseInt(limit) - 1;

    const { data: bookmarks, error, count } = await supabase
      .from('bookmarks')
      .select(`
        bookmark_id,
        article_id,
        created_at,
        articles:article_id (
          article_id,
          canonical_title,
          slug,
          summary,
          base_content,
          source_domain,
          categories,
          view_count,
          created_at
        )
      `, { count: 'exact' })
      .eq('user_id', user_id)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw error;

    // Fetch rating averages and explanation statistics for bookmarked articles
    const articleIds = (bookmarks || []).map(b => b.article_id).filter(Boolean);
    let viewsMap = {};

    if (articleIds.length > 0) {
      const { data: viewsData } = await supabase
        .from('explanation_views')
        .select('article_id, rating_avg, rating_count, view_count')
        .in('article_id', articleIds);

      (viewsData || []).forEach(v => {
        if (!viewsMap[v.article_id]) {
          viewsMap[v.article_id] = { 
            rating_avg: v.rating_avg || 0, 
            rating_count: v.rating_count || 0, 
            total_views: v.view_count || 0 
          };
        } else {
          if ((v.rating_count || 0) > viewsMap[v.article_id].rating_count) {
            viewsMap[v.article_id].rating_avg = v.rating_avg || viewsMap[v.article_id].rating_avg;
          }
          viewsMap[v.article_id].rating_count += (v.rating_count || 0);
          viewsMap[v.article_id].total_views += (v.view_count || 0);
        }
      });
    }

    const formattedBookmarks = (bookmarks || []).map(b => {
      const art = b.articles || {};
      const stats = viewsMap[b.article_id] || { rating_avg: 0, rating_count: 0 };
      return {
        bookmark_id: b.bookmark_id,
        article_id: b.article_id,
        created_at: b.created_at,
        articles: {
          ...art,
          reading_time: calculateReadingTime(art.base_content),
          rating_avg: stats.rating_avg,
          rating_count: stats.rating_count
        }
      };
    });

    res.json({
      success: true,
      bookmarks: formattedBookmarks,
      total: count || formattedBookmarks.length
    });
  } catch (error) {
    console.error('Get user bookmarks error:', error);
    res.status(500).json({ error: 'Failed to get bookmarks', bookmarks: [] });
  }
}

// ============================================
// 📖 GET READING HISTORY (NEW DEDICATED ENDPOINT)
// ============================================
async function getReadingHistory(req, res, user_id) {
  const { limit = 50, page = 1 } = req.query;

  if (!user_id) {
    return res.status(401).json({ error: 'Authentication required', history: [], total: 0 });
  }

  try {
    const from = (parseInt(page) - 1) * parseInt(limit);
    const to = from + parseInt(limit) - 1;

    const { data: history, error, count } = await supabase
      .from('reading_history')
      .select(`
        history_id,
        user_id,
        article_id,
        date,
        viewed_at,
        articles:article_id (
          article_id,
          canonical_title,
          slug,
          summary,
          base_content,
          source_domain,
          categories,
          view_count,
          created_at
        )
      `, { count: 'exact' })
      .eq('user_id', user_id)
      .order('viewed_at', { ascending: false })
      .range(from, to);

    if (error) throw error;

    const formattedHistory = (history || []).map(h => {
      const art = h.articles || {};
      return {
        history_id: h.history_id,
        user_id: h.user_id,
        article_id: h.article_id,
        date: h.date,
        viewed_at: h.viewed_at,
        articles: {
          ...art,
          reading_time: calculateReadingTime(art.base_content)
        }
      };
    });

    res.json({
      success: true,
      history: formattedHistory,
      total: count || formattedHistory.length
    });
  } catch (error) {
    console.error('Get reading history error:', error);
    res.status(500).json({ error: 'Failed to get reading history', history: [] });
  }
}

// ============================================
// 📋 LIST ARTICLES
// ============================================
async function listArticles(req, res) {
  const { 
    page = 1, 
    limit = 20, 
    category, 
    search, 
    status = 'processed',
    sort_by = 'created_at',
    sort_order = 'desc'
  } = req.query;

  try {
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase
      .from('articles')
      .select('article_id, canonical_title, slug, base_content, summary, source_url, source_domain, source_title, categories, word_count, view_count, version, status, retrieved_at, created_at, updated_at, next_refresh_at', { count: 'exact' });

    if (status) {
      query = query.eq('status', status);
    }

    if (category) {
      query = query.contains('categories', [category]);
    }

    if (search) {
      query = query.ilike('canonical_title', `%${search}%`);
    }

    query = query
      .range(from, to)
      .order(sort_by, { ascending: sort_order === 'asc' });

    const { data, error, count } = await query;

    if (error) throw error;

    const articles = (data || []).map(article => ({
      ...article,
      reading_time: calculateReadingTime(article.base_content),
      word_count: article.word_count || article.base_content?.split(/\s+/).length || 0
    }));

    res.json({
      success: true,
      page: parseInt(page),
      limit: parseInt(limit),
      total: count || 0,
      total_pages: Math.ceil((count || 0) / limit),
      articles
    });
  } catch (error) {
    console.error('List articles error:', error);
    res.status(500).json({ error: 'Failed to list articles' });
  }
}

// ============================================
// 📄 GET ARTICLE BY ID
// ============================================
async function getArticleById(req, res, id, user_id) {
  try {
    const { data: article, error } = await supabase
      .from('articles')
      .select('article_id, canonical_title, slug, base_content, summary, source_url, source_domain, source_title, source_published_at, categories, content_hash, word_count, view_count, version, status, retrieved_at, created_at, updated_at, next_refresh_at')
      .eq('article_id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Article not found' });
      }
      throw error;
    }

    // Increment view count and record read history
    await trackViewForArticle(id, user_id);

    const { data: explanations, error: expError } = await supabase
      .from('explanation_views')
      .select('view_id, profile_id, title, summary, view_count, rating_avg, rating_count, generated_at')
      .eq('article_id', id);

    if (expError) throw expError;

    res.json({
      success: true,
      article: {
        ...article,
        reading_time: calculateReadingTime(article.base_content),
        word_count: article.word_count || article.base_content?.split(/\s+/).length || 0,
        explanations: explanations || []
      }
    });
  } catch (error) {
    console.error('Get article error:', error);
    res.status(500).json({ error: 'Failed to get article' });
  }
}

// ============================================
// 📄 GET ARTICLE BY SLUG
// ============================================
async function getArticleBySlug(req, res, slug, user_id) {
  try {
    const { data: article, error } = await supabase
      .from('articles')
      .select('article_id, canonical_title, slug, base_content, summary, source_url, source_domain, source_title, source_published_at, categories, content_hash, word_count, view_count, version, status, retrieved_at, created_at, updated_at, next_refresh_at')
      .eq('slug', slug)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Article not found' });
      }
      throw error;
    }

    // Increment view count and record read history
    await trackViewForArticle(article.article_id, user_id);

    const { data: explanations, error: expError } = await supabase
      .from('explanation_views')
      .select('view_id, profile_id, title, summary, view_count, rating_avg, rating_count, generated_at')
      .eq('article_id', article.article_id);

    if (expError) throw expError;

    res.json({
      success: true,
      article: {
        ...article,
        reading_time: calculateReadingTime(article.base_content),
        word_count: article.word_count || article.base_content?.split(/\s+/).length || 0,
        explanations: explanations || []
      }
    });
  } catch (error) {
    console.error('Get article by slug error:', error);
    res.status(500).json({ error: 'Failed to get article' });
  }
}

// ============================================
// 📝 CREATE ARTICLE
// ============================================
async function createArticle(req, res) {
  const { 
    url, 
    content, 
    title, 
    source_domain, 
    source_title,
    source_published_at,
    categories = [],
    summary,
    status = 'pending'
  } = req.body;

  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }

  try {
    const wordCount = content.split(/\s+/).length;
    
    if (wordCount < MIN_WORD_COUNT) {
      return res.status(400).json({ 
        error: `Content too short (${wordCount} words). Minimum ${MIN_WORD_COUNT} words required.` 
      });
    }

    const contentHash = generateContentHash(content);
    const existing = await getByColumn('articles', 'content_hash', contentHash);
    if (existing.length > 0) {
      return res.status(409).json({
        error: 'Duplicate article',
        article_id: existing[0].article_id,
        slug: existing[0].slug,
        message: 'This content already exists in the database'
      });
    }

    const slug = title ? generateSlug(title) : `article-${Date.now()}`;
    let finalSlug = slug;
    let slugExists = await getByColumn('articles', 'slug', slug);
    let counter = 1;
    while (slugExists.length > 0) {
      finalSlug = `${slug}-${counter}`;
      slugExists = await getByColumn('articles', 'slug', finalSlug);
      counter++;
    }

    let processedCategories = (categories && categories.length > 0)
      ? categories.slice(0, MAX_CATEGORIES_PER_ARTICLE)
      : ['General'];

    const article = await insert('articles', {
      canonical_title: title || 'Untitled Article',
      slug: finalSlug,
      base_content: content,
      summary: summary || null,
      source_url: url || null,
      source_domain: source_domain || null,
      source_title: source_title || null,
      source_published_at: source_published_at || null,
      categories: processedCategories,
      content_hash: contentHash,
      word_count: wordCount,
      version: 1,
      status: status,
      retrieved_at: new Date().toISOString(),
      next_refresh_at: new Date(Date.now() + REFRESH_INTERVAL_DAYS * 24 * 60 * 60 * 1000).toISOString()
    });

    const job = await insert('processing_jobs', {
      url: url || null,
      article_id: article.article_id,
      status: 'pending',
      current_stage: 'fetch',
      stages: {
        fetch: 'pending',
        extract: 'pending',
        quality: 'pending',
        duplicate_check: 'pending',
        processing: 'pending',
        embedding: 'pending',
        storage: 'pending'
      },
      started_at: new Date().toISOString()
    });

    res.status(201).json({
      success: true,
      message: 'Article created and queued for processing',
      article: {
        ...article,
        reading_time: calculateReadingTime(content)
      },
      job_id: job.job_id
    });
  } catch (error) {
    console.error('Create article error:', error);
    res.status(500).json({ error: 'Failed to create article' });
  }
}

// ============================================
// 📚 SEARCH ARTICLES
// ============================================
async function searchArticles(req, res, search) {
  const { 
    page = 1, 
    limit = 20,
    category,
    sort_by = 'relevance',
    sort_order = 'desc'
  } = req.query;

  try {
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase
      .from('articles')
      .select('article_id, canonical_title, slug, base_content, summary, source_url, source_domain, source_title, categories, word_count, view_count, version, status, retrieved_at, created_at, updated_at, next_refresh_at', { count: 'exact' })
      .eq('status', 'processed');

    if (search) {
      query = query.textSearch('canonical_title', search, {
        config: 'english',
        type: 'websearch'
      });
    }

    if (category) {
      query = query.contains('categories', [category]);
    }

    if (sort_by === 'relevance' && search) {
      query = query.order('created_at', { ascending: false });
    } else {
      query = query.order(sort_by, { ascending: sort_order === 'asc' });
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
      articles: (data || []).map(a => ({
        ...a,
        reading_time: calculateReadingTime(a.base_content)
      }))
    });
  } catch (error) {
    console.error('Search articles error:', error);
    res.status(500).json({ error: 'Failed to search articles' });
  }
}

// ============================================
// 🔍 GET SIMILAR ARTICLES
// ============================================
async function getSimilarArticles(req, res, id) {
  const { limit = 5, threshold = SIMILARITY_THRESHOLD } = req.query;

  try {
    const { data: article, error } = await supabase
      .from('articles')
      .select('article_id, embedding')
      .eq('article_id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Article not found' });
      }
      throw error;
    }

    if (!article.embedding) {
      return res.status(400).json({ 
        error: 'Article has no embedding. Process article first.' 
      });
    }

    const similar = await findSimilarArticles(
      article.embedding, 
      parseFloat(threshold), 
      parseInt(limit)
    );

    const articleIds = similar.map(s => s.article_id);
    const { data: articles, error: articlesError } = await supabase
      .from('articles')
      .select('article_id, canonical_title, slug, summary, source_domain, categories, view_count, created_at')
      .in('article_id', articleIds);

    if (articlesError) throw articlesError;

    const similarWithScores = (articles || []).map(a => ({
      ...a,
      similarity: similar.find(s => s.article_id === a.article_id)?.similarity || 0,
      reading_time: calculateReadingTime(a.base_content)
    })).sort((a, b) => b.similarity - a.similarity);

    res.json({
      success: true,
      article_id: id,
      similar_articles: similarWithScores
    });
  } catch (error) {
    console.error('Get similar articles error:', error);
    res.status(500).json({ error: 'Failed to get similar articles' });
  }
}

// ============================================
// ⭐ RATE ARTICLE
// ============================================
async function rateArticle(req, res, user_id) {
  const { view_id, rating, feedback } = req.body;

  if (!view_id || !rating) {
    return res.status(400).json({ error: 'view_id and rating required' });
  }

  if (rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be between 1 and 5' });
  }

  try {
    const existing = await supabase
      .from('ratings')
      .select('rating_id, rating')
      .eq('user_id', user_id)
      .eq('view_id', view_id)
      .single();

    if (existing.data) {
      return res.status(409).json({
        error: 'Already rated this article',
        rating_id: existing.data.rating_id,
        rating: existing.data.rating
      });
    }

    const ratingRecord = await insert('ratings', {
      user_id: user_id || null,
      view_id: parseInt(view_id),
      rating,
      feedback: feedback || null
    });

    const { data: viewData, error: viewError } = await supabase
      .from('explanation_views')
      .select('rating_avg, rating_count')
      .eq('view_id', view_id)
      .single();

    if (viewError) throw viewError;

    const newCount = (viewData.rating_count || 0) + 1;
    const newAvg = ((viewData.rating_avg || 0) * (viewData.rating_count || 0) + rating) / newCount;

    await update('explanation_views', view_id, {
      rating_avg: Math.round(newAvg * 100) / 100,
      rating_count: newCount
    });

    if (user_id) {
      const users = await getByColumn('users', 'user_id', user_id);
      if (users.length > 0) {
        const user = users[0];
        const bonus = 0.2;
        await update('users', user_id, { 
          credits: user.credits + bonus 
        });

        await insert('credit_transactions', {
          user_id,
          amount: bonus,
          reason: 'Rating bonus',
          balance_after: user.credits + bonus,
          item_id: view_id
        });
      }
    }

    res.status(201).json({
      success: true,
      message: 'Rating submitted successfully',
      rating_id: ratingRecord.rating_id,
      bonus_earned: user_id ? 0.2 : 0
    });
  } catch (error) {
    console.error('Rate article error:', error);
    res.status(500).json({ error: 'Failed to submit rating' });
  }
}

// ============================================
// 📚 GET ARTICLE VERSIONS
// ============================================
async function getArticleVersions(req, res, id) {
  try {
    const { data: versions, error } = await supabase
      .from('article_versions')
      .select('version_id, article_id, content, change_reason, created_at')
      .eq('article_id', id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const { data: article, error: articleError } = await supabase
      .from('articles')
      .select('article_id, canonical_title, version')
      .eq('article_id', id)
      .single();

    if (articleError) throw articleError;

    res.json({
      success: true,
      article: {
        id: article?.article_id,
        title: article?.canonical_title,
        current_version: article?.version
      },
      versions: versions || [],
      total_versions: versions?.length || 0
    });
  } catch (error) {
    console.error('Get article versions error:', error);
    res.status(500).json({ error: 'Failed to get article versions' });
  }
}

// ============================================
// 📑 GET ARTICLES BY CATEGORY
// ============================================
async function getArticlesByCategory(req, res, category) {
  const { page = 1, limit = 20 } = req.query;

  try {
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data: articles, error, count } = await supabase
      .from('articles')
      .select('article_id, canonical_title, slug, summary, source_domain, categories, word_count, view_count, version, status, created_at, updated_at', { count: 'exact' })
      .contains('categories', [category])
      .eq('status', 'processed')
      .range(from, to)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      category,
      page: parseInt(page),
      limit: parseInt(limit),
      total: count || 0,
      articles: (articles || []).map(a => ({
        ...a,
        reading_time: calculateReadingTime(a.base_content)
      }))
    });
  } catch (error) {
    console.error('Get articles by category error:', error);
    res.status(500).json({ error: 'Failed to get articles by category' });
  }
}

// ============================================
// 📊 GET ARTICLE RATINGS
// ============================================
async function getArticleRatings(req, res, id) {
  const { limit = 50 } = req.query;

  try {
    const { data: views, error: viewsError } = await supabase
      .from('explanation_views')
      .select('view_id')
      .eq('article_id', id);

    if (viewsError) throw viewsError;

    const viewIds = (views || []).map(v => v.view_id);

    if (viewIds.length === 0) {
      return res.json({
        success: true,
        ratings: [],
        total: 0,
        average: null
      });
    }

    const { data: ratings, error } = await supabase
      .from('ratings')
      .select(`
        rating,
        feedback,
        user_id,
        created_at,
        explanation_views!inner (profile_id, title)
      `)
      .in('view_id', viewIds)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (error) throw error;

    const ratingValues = (ratings || []).map(r => r.rating);
    const average = ratingValues.length > 0 
      ? Math.round((ratingValues.reduce((a, b) => a + b, 0) / ratingValues.length) * 100) / 100
      : null;

    res.json({
      success: true,
      article_id: id,
      ratings: ratings || [],
      total: ratings?.length || 0,
      average,
      distribution: {
        1: ratings?.filter(r => r.rating === 1).length || 0,
        2: ratings?.filter(r => r.rating === 2).length || 0,
        3: ratings?.filter(r => r.rating === 3).length || 0,
        4: ratings?.filter(r => r.rating === 4).length || 0,
        5: ratings?.filter(r => r.rating === 5).length || 0
      }
    });
  } catch (error) {
    console.error('Get article ratings error:', error);
    res.status(500).json({ error: 'Failed to get ratings' });
  }
}

// ============================================
// 🎲 GET RANDOM ARTICLES
// ============================================
async function getRandomArticles(req, res) {
  const { limit = 5 } = req.query;

  try {
    const { data: articles, error } = await supabase
      .from('articles')
      .select('article_id, canonical_title, slug, summary, source_domain, categories, word_count, view_count, created_at')
      .eq('status', 'processed')
      .order('created_at', { ascending: false })
      .limit(parseInt(limit) * 3);

    if (error) throw error;

    const shuffled = (articles || []).sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, parseInt(limit));

    res.json({
      success: true,
      articles: selected.map(a => ({
        ...a,
        reading_time: calculateReadingTime(a.base_content)
      }))
    });
  } catch (error) {
    console.error('Get random articles error:', error);
    res.status(500).json({ error: 'Failed to get random articles' });
  }
}

// ============================================
// 🔄 CHECK ARTICLE EXISTS
// ============================================
async function checkArticleExists(req, res, slug) {
  try {
    const { data: article, error } = await supabase
      .from('articles')
      .select('article_id, slug, canonical_title')
      .eq('slug', slug)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.json({ success: true, exists: false, article: null });
      }
      throw error;
    }

    res.json({
      success: true,
      exists: true,
      article: {
        id: article.article_id,
        slug: article.slug,
        title: article.canonical_title
      }
    });
  } catch (error) {
    console.error('Check article exists error:', error);
    res.status(500).json({ error: 'Failed to check article' });
  }
}

// ============================================
// 🔖 BOOKMARK ARTICLE
// ============================================
async function bookmarkArticle(req, res, user_id) {
  const { article_id } = req.body;

  if (!user_id) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (!article_id) {
    return res.status(400).json({ error: 'article_id required' });
  }

  try {
    const bookmark = await insert('bookmarks', {
      user_id,
      article_id: parseInt(article_id),
      created_at: new Date().toISOString()
    });

    res.status(201).json({
      success: true,
      message: 'Article bookmarked',
      bookmark
    });
  } catch (error) {
    console.error('Bookmark article error:', error);
    res.status(500).json({ error: 'Failed to bookmark article' });
  }
}

// ============================================
// 🔄 TOGGLE BOOKMARK
// ============================================
async function toggleBookmark(req, res, user_id) {
  const { article_id } = req.body;

  if (!user_id) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (!article_id) {
    return res.status(400).json({ error: 'article_id required' });
  }

  try {
    const existing = await supabase
      .from('bookmarks')
      .select('bookmark_id')
      .eq('user_id', user_id)
      .eq('article_id', parseInt(article_id))
      .maybeSingle();

    if (existing.data) {
      await supabase
        .from('bookmarks')
        .delete()
        .eq('bookmark_id', existing.data.bookmark_id);

      res.json({
        success: true,
        bookmarked: false,
        message: 'Bookmark removed'
      });
    } else {
      const bookmark = await insert('bookmarks', {
        user_id,
        article_id: parseInt(article_id),
        created_at: new Date().toISOString()
      });

      res.status(201).json({
        success: true,
        bookmarked: true,
        bookmark
      });
    }
  } catch (error) {
    console.error('Toggle bookmark error:', error);
    res.status(500).json({ error: 'Failed to toggle bookmark' });
  }
}

// ============================================
// 🆕 SUBMIT CONTEXT (URL or text)
// ============================================
async function submitContext(req, res) {
  const { url, text, user_id } = req.body;

  if (!url && !text) {
    return res.status(400).json({ 
      error: 'Either url or text is required' 
    });
  }

  try {
    if (url && !isValidUrl(url)) {
      return res.status(400).json({ 
        error: 'Invalid URL format' 
      });
    }

    if (text && text.length < 100) {
      return res.status(400).json({ 
        error: 'Text too short (min 100 characters)' 
      });
    }

    if (text && containsMaliciousContent(text)) {
      return res.status(400).json({ 
        error: 'Content appears to be malicious or contains prohibited content' 
      });
    }

    let contentToCheck = text;
    if (url) {
      contentToCheck = `Content from ${url}`;
    }

    const contentHash = generateContentHash(contentToCheck);
    const existing = await getByColumn('articles', 'content_hash', contentHash);

    if (existing.length > 0) {
      return res.status(409).json({
        success: true,
        existing: true,
        article: existing[0],
        message: 'This content already exists in the database'
      });
    }

    const job = await insert('processing_jobs', {
      url: url || null,
      status: 'pending',
      current_stage: 'fetch',
      stages: {
        fetch: 'pending',
        extract: 'pending',
        quality: 'pending',
        duplicate_check: 'completed',
        processing: 'pending',
        embedding: 'pending',
        storage: 'pending'
      },
      started_at: new Date().toISOString()
    });

    res.status(202).json({
      success: true,
      message: 'Content submitted for processing',
      job_id: job.job_id,
      status: 'queued'
    });
  } catch (error) {
    console.error('Submit context error:', error);
    res.status(500).json({ error: 'Failed to submit context' });
  }
}

// ============================================
// 🔄 REFRESH ARTICLE
// ============================================
async function refreshArticle(req, res) {
  const { article_id } = req.body;

  if (!article_id) {
    return res.status(400).json({ error: 'article_id required' });
  }

  try {
    const article = await getById('articles', article_id);
    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    await update('articles', article_id, {
      next_refresh_at: new Date(Date.now() + REFRESH_INTERVAL_DAYS * 24 * 60 * 60 * 1000).toISOString()
    });

    const job = await insert('processing_jobs', {
      url: article.source_url || null,
      article_id: article.article_id,
      status: 'pending',
      current_stage: 'fetch',
      stages: {
        fetch: 'pending',
        extract: 'pending',
        quality: 'pending',
        duplicate_check: 'pending',
        processing: 'pending',
        embedding: 'pending',
        storage: 'pending'
      },
      started_at: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Article refresh queued',
      job_id: job.job_id
    });
  } catch (error) {
    console.error('Refresh article error:', error);
    res.status(500).json({ error: 'Failed to refresh article' });
  }
}

// ============================================
// ✏️ UPDATE ARTICLE
// ============================================
async function updateArticle(req, res) {
  const { article_id, title, content, summary, categories, status } = req.body;

  if (!article_id) {
    return res.status(400).json({ error: 'article_id required' });
  }

  try {
    const updateData = {
      updated_at: new Date().toISOString()
    };

    if (title) updateData.canonical_title = title;
    if (content) {
      updateData.base_content = content;
      updateData.word_count = content.split(/\s+/).length;
      updateData.content_hash = generateContentHash(content);
    }
    if (summary !== undefined) updateData.summary = summary;
    if (categories) {
      updateData.categories = categories.slice(0, MAX_CATEGORIES_PER_ARTICLE);
    }
    if (status) updateData.status = status;

    const updated = await update('articles', article_id, updateData);

    if (!updated) {
      return res.status(404).json({ error: 'Article not found' });
    }

    await insert('article_versions', {
      article_id: parseInt(article_id),
      content: content || updated.base_content,
      source_snapshot: { updated_fields: Object.keys(updateData) },
      change_reason: 'Manual update',
      created_at: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Article updated successfully',
      article: updated
    });
  } catch (error) {
    console.error('Update article error:', error);
    res.status(500).json({ error: 'Failed to update article' });
  }
}

// ============================================
// ✏️ UPDATE ARTICLE STATUS
// ============================================
async function updateArticleStatus(req, res) {
  const { article_id, status, embedding } = req.body;

  if (!article_id || !status) {
    return res.status(400).json({ error: 'article_id and status required' });
  }

  try {
    const updateData = { status };
    if (embedding) {
      updateData.embedding = embedding;
    }

    const updated = await update('articles', article_id, updateData);

    if (!updated) {
      return res.status(404).json({ error: 'Article not found' });
    }

    const jobs = await getByColumn('processing_jobs', 'article_id', article_id);
    if (jobs.length > 0) {
      const job = jobs[0];
      const stages = job.stages || {};
      
      if (status === 'processing') stages.processing = 'success';
      if (status === 'processed') {
        stages.embedding = 'success';
        stages.storage = 'success';
      }
      
      await update('processing_jobs', job.job_id, {
        status: status === 'processed' ? 'completed' : status,
        current_stage: status,
        stages: stages,
        completed_at: status === 'processed' ? new Date().toISOString() : null
      });
    }

    res.json({
      success: true,
      message: 'Article status updated',
      article: updated
    });
  } catch (error) {
    console.error('Update article status error:', error);
    res.status(500).json({ error: 'Failed to update article status' });
  }
}

// ============================================
// 🗑️ DELETE ARTICLE (Admin only)
// ============================================
async function deleteArticle(req, res) {
  const { article_id } = req.query;

  if (!article_id) {
    return res.status(400).json({ error: 'article_id required' });
  }

  try {
    await supabase.from('explanation_views').delete().eq('article_id', article_id);
    await supabase.from('deep_dives').delete().eq('article_id', article_id);
    await supabase.from('processing_jobs').delete().eq('article_id', article_id);
    await deleteRecord('articles', article_id);

    res.json({
      success: true,
      message: 'Article and all associated data deleted successfully'
    });
  } catch (error) {
    console.error('Delete article error:', error);
    res.status(500).json({ error: 'Failed to delete article' });
  }
}

// ============================================
// ❌ REMOVE BOOKMARK
// ============================================
async function removeBookmark(req, res) {
  const { bookmark_id } = req.query;

  if (!bookmark_id) {
    return res.status(400).json({ error: 'bookmark_id required' });
  }

  try {
    await deleteRecord('bookmarks', bookmark_id);

    res.json({
      success: true,
      message: 'Bookmark removed successfully'
    });
  } catch (error) {
    console.error('Remove bookmark error:', error);
    res.status(500).json({ error: 'Failed to remove bookmark' });
  }
}

// ============================================
// 📈 UPDATE READING PROGRESS
// ============================================
async function updateReadingProgress(req, res, user_id) {
  const { article_id, progress } = req.body;

  if (!user_id) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (!article_id) {
    return res.status(400).json({ error: 'article_id required' });
  }

  try {
    const existing = await supabase
      .from('reading_progress')
      .select('progress_id, progress')
      .eq('user_id', user_id)
      .eq('article_id', article_id)
      .maybeSingle();

    if (existing.data) {
      await update('reading_progress', existing.data.progress_id, {
        progress: progress || existing.data.progress,
        updated_at: new Date().toISOString()
      });
    } else {
      await insert('reading_progress', {
        user_id,
        article_id: parseInt(article_id),
        progress: progress || 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      message: 'Reading progress updated'
    });
  } catch (error) {
    console.error('Update reading progress error:', error);
    res.status(500).json({ error: 'Failed to update reading progress' });
  }
}

// ============================================
// ===== HELPER FUNCTIONS =====
// ============================================

function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100);
}

function generateContentHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function calculateReadingTime(content, wordsPerMinute = 200) {
  if (!content) return 1;
  const words = content.split(/\s+/).length;
  return Math.max(1, Math.ceil(words / wordsPerMinute));
}

function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

function containsMaliciousContent(text) {
  const maliciousPatterns = [
    /<script/i,
    /javascript:/i,
    /onclick=/i,
    /onerror=/i,
    /onload=/i,
    /eval\(/i,
    /document\.write/i
  ];
  return maliciousPatterns.some(pattern => pattern.test(text));
}

// Track view for article and create/update reading history
async function trackViewForArticle(article_id, user_id) {
  try {
    const article = await getById('articles', article_id);
    if (article) {
      await update('articles', article_id, {
        view_count: (article.view_count || 0) + 1
      });
    }

    if (user_id) {
      const today = new Date().toISOString().split('T')[0];
      
      const existing = await supabase
        .from('reading_history')
        .select('history_id')
        .eq('user_id', user_id)
        .eq('article_id', parseInt(article_id))
        .eq('date', today)
        .maybeSingle();

      if (!existing.data) {
        await insert('reading_history', {
          user_id,
          article_id: parseInt(article_id),
          date: today,
          viewed_at: new Date().toISOString()
        });
      } else {
        await supabase
          .from('reading_history')
          .update({ viewed_at: new Date().toISOString() })
          .eq('history_id', existing.data.history_id);
      }

      const usageRecords = await getByColumn('usage', 'user_id', user_id);
      const todayUsage = usageRecords.find(u => u.date === today);
      
      if (todayUsage) {
        await update('usage', todayUsage.usage_id, {
          articles_read: (todayUsage.articles_read || 0) + 1
        });
      } else {
        await insert('usage', {
          user_id,
          date: today,
          articles_read: 1,
          questions: 0,
          deep_dives: 0,
          credits_used: 0
        });
      }
    }
  } catch (error) {
    console.error('Track view error:', error);
  }
}

// Track view (API endpoint)
async function trackView(req, res, user_id) {
  const { article_id } = req.body;

  if (!article_id) {
    return res.status(400).json({ error: 'article_id required' });
  }

  try {
    await trackViewForArticle(article_id, user_id);

    res.json({
      success: true,
      message: 'View tracked'
    });
  } catch (error) {
    console.error('Track view error:', error);
    res.status(500).json({ error: 'Failed to track view' });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};