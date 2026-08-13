// api/category.js

import { 
  supabase,
  getAll, 
  getById, 
  getByColumn, 
  insert, 
  update, 
  deleteRecord,
  exists,
  count
} from '../utils/supabase.js';

import openRouter from '../utils/openrouter.js';

// ============================================
// CONSTANTS
// ============================================
const MAX_CATEGORIES_PER_ARTICLE = 5;
const CATEGORY_SIMILARITY_THRESHOLD = 0.7;

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
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-admin-key, x-api-key'
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
  const { id, name, search, limit = 50 } = req.query;

  // Get all categories
  if (!action || action === 'list') {
    return await listCategories(req, res);
  }

  // Get category by ID
  if (action === 'get' && id) {
    return await getCategoryById(req, res, id);
  }

  // Get category by name
  if (action === 'get-by-name' && name) {
    return await getCategoryByName(req, res, name);
  }

  // Search categories
  if (action === 'search' && search) {
    return await searchCategories(req, res, search);
  }

  // Get category stats
  if (action === 'stats') {
    return await getCategoryStats(req, res);
  }

  // Get articles by category
  if (action === 'articles' && id) {
    return await getArticlesByCategory(req, res, id);
  }

  // Get suggestions (for AI prompt)
  if (action === 'suggestions') {
    return await getCategorySuggestions(req, res);
  }

  // Get category tree/hierarchy
  if (action === 'tree') {
    return await getCategoryTree(req, res);
  }

  res.status(400).json({ error: 'Invalid action or missing parameters' });
}

// ============================================
// POST HANDLER
// ============================================
async function handlePost(req, res, action) {
  const adminKey = req.headers['x-admin-key'];

  // Create category (admin only)
  if (action === 'create') {
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    return await createCategory(req, res);
  }

  // Auto-detect categories (AI powered)
  if (action === 'auto-detect') {
    return await autoDetectCategories(req, res);
  }

  // Suggest categories from content
  if (action === 'suggest') {
    return await suggestCategories(req, res);
  }

  // Merge categories (admin only)
  if (action === 'merge') {
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    return await mergeCategories(req, res);
  }

  // Rebuild category index
  if (action === 'rebuild-index') {
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    return await rebuildCategoryIndex(req, res);
  }

  res.status(400).json({ error: 'Invalid action' });
}

// ============================================
// PUT HANDLER
// ============================================
async function handlePut(req, res, action) {
  const adminKey = req.headers['x-admin-key'];

  // Update category (admin only)
  if (action === 'update') {
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    return await updateCategory(req, res);
  }

  // Re-categorize article
  if (action === 'recategorize') {
    return await recategorizeArticle(req, res);
  }

  // Update category hierarchy
  if (action === 'update-hierarchy') {
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    return await updateCategoryHierarchy(req, res);
  }

  res.status(400).json({ error: 'Invalid action' });
}

// ============================================
// DELETE HANDLER
// ============================================
async function handleDelete(req, res, action) {
  const adminKey = req.headers['x-admin-key'];

  // Delete category (admin only)
  if (action === 'delete') {
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    return await deleteCategory(req, res);
  }

  // Remove category from article
  if (action === 'remove-from-article') {
    return await removeCategoryFromArticle(req, res);
  }

  res.status(400).json({ error: 'Invalid action' });
}

// ============================================
// ===== IMPLEMENTATION FUNCTIONS =====
// ============================================

// ============================================
// 📋 LIST CATEGORIES
// ============================================
async function listCategories(req, res) {
  try {
    // Get all unique categories from articles
    const { data, error } = await supabase
      .from('articles')
      .select('categories')
      .not('categories', 'is', null);

    if (error) throw error;

    // Flatten and count categories
    const categoryMap = new Map();
    data.forEach(article => {
      if (article.categories && Array.isArray(article.categories)) {
        article.categories.forEach(cat => {
          const cleanName = cat.trim();
          if (cleanName) {
            categoryMap.set(cleanName, (categoryMap.get(cleanName) || 0) + 1);
          }
        });
      }
    });

    // Convert to array and sort
    const categories = Array.from(categoryMap.entries())
      .map(([name, count]) => ({
        name,
        count,
        slug: generateSlug(name)
      }))
      .sort((a, b) => b.count - a.count);

    res.json({
      success: true,
      total: categories.length,
      categories
    });
  } catch (error) {
    console.error('List categories error:', error);
    res.status(500).json({ error: 'Failed to list categories' });
  }
}

// ============================================
// 📊 GET CATEGORY STATS
// ============================================
async function getCategoryStats(req, res) {
  try {
    const { data: articles, error } = await supabase
      .from('articles')
      .select('categories, created_at, status');

    if (error) throw error;

    const stats = {
      total_articles: articles.length,
      categories: new Map(),
      category_articles: new Map(),
      recent_articles: 0,
      pending_articles: 0
    };

    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    articles.forEach(article => {
      if (article.categories && Array.isArray(article.categories)) {
        article.categories.forEach(cat => {
          const cleanName = cat.trim();
          if (cleanName) {
            stats.categories.set(cleanName, (stats.categories.get(cleanName) || 0) + 1);
            
            if (!stats.category_articles.has(cleanName)) {
              stats.category_articles.set(cleanName, []);
            }
            stats.category_articles.get(cleanName).push(article.article_id);
          }
        });
      }

      if (new Date(article.created_at) > threeMonthsAgo) {
        stats.recent_articles++;
      }

      if (article.status === 'pending') {
        stats.pending_articles++;
      }
    });

    const categoryList = Array.from(stats.categories.entries())
      .map(([name, count]) => ({
        name,
        count,
        percentage: ((count / articles.length) * 100).toFixed(1),
        article_count: stats.category_articles.get(name)?.length || 0
      }))
      .sort((a, b) => b.count - a.count);

    res.json({
      success: true,
      stats: {
        total_articles: stats.total_articles,
        total_categories: stats.categories.size,
        recent_articles: stats.recent_articles,
        pending_articles: stats.pending_articles,
        top_categories: categoryList.slice(0, 10),
        category_distribution: categoryList
      }
    });
  } catch (error) {
    console.error('Get category stats error:', error);
    res.status(500).json({ error: 'Failed to get category stats' });
  }
}

// ============================================
// 🎯 GET CATEGORY BY ID
// ============================================
async function getCategoryById(req, res, id) {
  try {
    const { data: articles, error } = await supabase
      .from('articles')
      .select('article_id, canonical_title, slug, categories, created_at, status')
      .contains('categories', [id]);

    if (error) throw error;

    const { data: config, error: configError } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', 'category_metadata')
      .single();

    let metadata = {};
    if (!configError && config) {
      metadata = config.value || {};
    }

    const categoryName = id;
    const categoryMeta = metadata[id] || {};

    res.json({
      success: true,
      category: {
        name: categoryName,
        slug: generateSlug(categoryName),
        ...categoryMeta,
        article_count: articles.length,
        articles: articles.map(a => ({
          id: a.article_id,
          title: a.canonical_title,
          slug: a.slug,
          created_at: a.created_at,
          status: a.status
        }))
      }
    });
  } catch (error) {
    console.error('Get category error:', error);
    res.status(500).json({ error: 'Failed to get category' });
  }
}

// ============================================
// 🔍 GET CATEGORY BY NAME
// ============================================
async function getCategoryByName(req, res, name) {
  try {
    const normalized = name.trim().toLowerCase();
    
    const { data: articles, error } = await supabase
      .from('articles')
      .select('categories, article_id, canonical_title, slug')
      .not('categories', 'is', null);

    if (error) throw error;

    const matches = [];
    articles.forEach(article => {
      if (article.categories && Array.isArray(article.categories)) {
        article.categories.forEach(cat => {
          if (cat.toLowerCase().includes(normalized) || normalized.includes(cat.toLowerCase())) {
            matches.push({
              category: cat,
              article_id: article.article_id,
              title: article.canonical_title,
              slug: article.slug
            });
          }
        });
      }
    });

    if (matches.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const grouped = {};
    matches.forEach(match => {
      if (!grouped[match.category]) {
        grouped[match.category] = [];
      }
      grouped[match.category].push({
        article_id: match.article_id,
        title: match.title,
        slug: match.slug
      });
    });

    res.json({
      success: true,
      category: {
        name: matches[0].category,
        slug: generateSlug(matches[0].category),
        article_count: Object.values(grouped).reduce((sum, arr) => sum + arr.length, 0),
        articles: grouped
      }
    });
  } catch (error) {
    console.error('Get category by name error:', error);
    res.status(500).json({ error: 'Failed to get category' });
  }
}

// ============================================
// 🔎 SEARCH CATEGORIES
// ============================================
async function searchCategories(req, res, search) {
  try {
    const searchTerm = search.trim().toLowerCase();
    
    const { data: articles, error } = await supabase
      .from('articles')
      .select('categories')
      .not('categories', 'is', null);

    if (error) throw error;

    const categoryScores = new Map();
    articles.forEach(article => {
      if (article.categories && Array.isArray(article.categories)) {
        article.categories.forEach(cat => {
          const clean = cat.trim();
          if (clean) {
            const score = calculateMatchScore(clean, searchTerm);
            if (score > 0) {
              categoryScores.set(clean, (categoryScores.get(clean) || 0) + score);
            }
          }
        });
      }
    });

    const results = Array.from(categoryScores.entries())
      .map(([name, score]) => ({
        name,
        score,
        slug: generateSlug(name)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    res.json({
      success: true,
      query: search,
      total: results.length,
      results
    });
  } catch (error) {
    console.error('Search categories error:', error);
    res.status(500).json({ error: 'Failed to search categories' });
  }
}

// ============================================
// 💡 GET CATEGORY SUGGESTIONS
// ============================================
async function getCategorySuggestions(req, res) {
  try {
    const { data: articles, error } = await supabase
      .from('articles')
      .select('categories')
      .not('categories', 'is', null);

    if (error) throw error;

    const categorySet = new Set();
    articles.forEach(article => {
      if (article.categories && Array.isArray(article.categories)) {
        article.categories.forEach(cat => {
          const clean = cat.trim();
          if (clean) categorySet.add(clean);
        });
      }
    });

    const { data: config, error: configError } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', 'category_metadata')
      .single();

    let metadata = {};
    if (!configError && config) {
      metadata = config.value || {};
    }

    const suggestions = Array.from(categorySet).map(name => ({
      name,
      slug: generateSlug(name),
      description: metadata[name]?.description || null,
      aliases: metadata[name]?.aliases || [],
      article_count: articles.filter(a => 
        a.categories && a.categories.includes(name)
      ).length
    }));

    const defaultCategories = [
      'Technology', 'Science', 'Business', 'Health', 'Education',
      'Entertainment', 'Sports', 'Politics', 'Environment', 'History',
      'Art', 'Culture', 'Philosophy', 'Psychology', 'Economics',
      'AI & Machine Learning', 'Programming', 'Design', 'Marketing', 'Finance'
    ];

    defaultCategories.forEach(cat => {
      if (!categorySet.has(cat)) {
        suggestions.push({
          name: cat,
          slug: generateSlug(cat),
          description: null,
          aliases: [],
          article_count: 0
        });
      }
    });

    res.json({
      success: true,
      total: suggestions.length,
      suggestions: suggestions.sort((a, b) => b.article_count - a.article_count)
    });
  } catch (error) {
    console.error('Get category suggestions error:', error);
    res.status(500).json({ error: 'Failed to get category suggestions' });
  }
}

// ============================================
// 🆕 CREATE CATEGORY (Admin only)
// ============================================
async function createCategory(req, res) {
  const { name, description, aliases, parent_category } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Category name required' });
  }

  try {
    const { data: articles, error } = await supabase
      .from('articles')
      .select('categories')
      .contains('categories', [name]);

    if (error) throw error;

    if (articles.length > 0) {
      return res.status(409).json({ 
        error: 'Category already exists',
        article_count: articles.length 
      });
    }

    const { data: config, error: configError } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', 'category_metadata')
      .single();

    let metadata = {};
    if (!configError && config) {
      metadata = config.value || {};
    }

    metadata[name] = {
      description: description || null,
      aliases: aliases || [],
      parent_category: parent_category || null,
      created_at: new Date().toISOString(),
      created_by: 'admin'
    };

    await supabase
      .from('system_config')
      .upsert({
        key: 'category_metadata',
        value: metadata
      }, { onConflict: 'key' });

    res.status(201).json({
      success: true,
      message: `Category "${name}" created successfully`,
      category: {
        name,
        description: metadata[name].description,
        aliases: metadata[name].aliases,
        parent: metadata[name].parent_category
      }
    });
  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
}

// ============================================
// ✏️ UPDATE CATEGORY (Admin only)
// ============================================
async function updateCategory(req, res) {
  const { old_name, new_name, description, aliases, parent_category } = req.body;

  if (!old_name || !new_name) {
    return res.status(400).json({ error: 'old_name and new_name required' });
  }

  try {
    const { data: config, error: configError } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', 'category_metadata')
      .single();

    let metadata = {};
    if (!configError && config) {
      metadata = config.value || {};
    }

    const { data: articles, error: articlesError } = await supabase
      .from('articles')
      .select('article_id, categories')
      .contains('categories', [old_name]);

    if (articlesError) throw articlesError;

    for (const article of articles) {
      const updatedCategories = article.categories.map(cat => 
        cat === old_name ? new_name : cat
      );
      
      await supabase
        .from('articles')
        .update({ categories: updatedCategories })
        .eq('article_id', article.article_id);
    }

    if (metadata[old_name]) {
      metadata[new_name] = {
        ...metadata[old_name],
        description: description || metadata[old_name].description,
        aliases: aliases || metadata[old_name].aliases,
        parent_category: parent_category || metadata[old_name].parent_category,
        updated_at: new Date().toISOString()
      };
      delete metadata[old_name];
    } else {
      metadata[new_name] = {
        description: description || null,
        aliases: aliases || [],
        parent_category: parent_category || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    }

    await supabase
      .from('system_config')
      .upsert({
        key: 'category_metadata',
        value: metadata
      }, { onConflict: 'key' });

    res.json({
      success: true,
      message: `Category renamed from "${old_name}" to "${new_name}"`,
      updated_articles: articles.length
    });
  } catch (error) {
    console.error('Update category error:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
}

// ============================================
// 🗑️ DELETE CATEGORY (Admin only)
// ============================================
async function deleteCategory(req, res) {
  const { name, force } = req.query;

  if (!name) {
    return res.status(400).json({ error: 'Category name required' });
  }

  try {
    const { data: articles, error } = await supabase
      .from('articles')
      .select('article_id, canonical_title')
      .contains('categories', [name]);

    if (error) throw error;

    if (articles.length > 0 && !force) {
      return res.status(409).json({
        error: `Category "${name}" is in use by ${articles.length} articles`,
        articles: articles.map(a => ({
          id: a.article_id,
          title: a.canonical_title
        })),
        use_force: true
      });
    }

    for (const article of articles) {
      const updatedCategories = article.categories.filter(cat => cat !== name);
      await supabase
        .from('articles')
        .update({ categories: updatedCategories.length > 0 ? updatedCategories : null })
        .eq('article_id', article.article_id);
    }

    const { data: config, error: configError } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', 'category_metadata')
      .single();

    if (!configError && config) {
      const metadata = config.value || {};
      delete metadata[name];
      
      await supabase
        .from('system_config')
        .upsert({
          key: 'category_metadata',
          value: metadata
        }, { onConflict: 'key' });
    }

    res.json({
      success: true,
      message: `Category "${name}" deleted successfully`,
      removed_from: articles.length
    });
  } catch (error) {
    console.error('Delete category error:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
}

// ============================================
// 🤖 AUTO-DETECT CATEGORIES (AI powered)
// ============================================
async function autoDetectCategories(req, res) {
  const { content, title, existing_categories } = req.body;

  if (!content) {
    return res.status(400).json({ error: 'Content required' });
  }

  try {
    // Get all existing categories
    const existing = await getExistingCategories();

    // Build prompt for category detection
    const prompt = buildCategoryDetectionPrompt(content, title, existing, existing_categories);

    // Call OpenRouter to detect categories
    const response = await openRouter.generateJSON(prompt, 'category_detection', {
      temperature: 0.2,
      maxTokens: 512
    });

    // Get categories from response
    let categories = response.parsed;
    if (!Array.isArray(categories)) {
      categories = [categories] || ['General'];
    }

    // Ensure max 5 categories
    const finalCategories = categories.slice(0, MAX_CATEGORIES_PER_ARTICLE);

    res.json({
      success: true,
      categories: finalCategories,
      confidence: 0.85,
      suggested_from_existing: finalCategories.filter(c => existing.includes(c)),
      new_categories: finalCategories.filter(c => !existing.includes(c))
    });
  } catch (error) {
    console.error('Auto-detect categories error:', error);
    res.status(500).json({ error: 'Failed to detect categories' });
  }
}

// ============================================
// 💡 SUGGEST CATEGORIES FROM CONTENT
// ============================================
async function suggestCategories(req, res) {
  const { content, title, max_suggestions = 5 } = req.body;

  if (!content) {
    return res.status(400).json({ error: 'Content required' });
  }

  try {
    // Get existing categories
    const existing = await getExistingCategories();

    // Build prompt for category suggestion
    const prompt = buildCategorySuggestionPrompt(content, title, existing, max_suggestions);

    // Call OpenRouter for suggestions
    const response = await openRouter.generateJSON(prompt, 'category_detection', {
      temperature: 0.3,
      maxTokens: 512
    });

    let suggestions = response.parsed;
    if (!Array.isArray(suggestions)) {
      suggestions = ['General'];
    }

    // Match suggestions with existing categories
    const matched = suggestions.slice(0, max_suggestions).map(s => {
      const match = existing.find(e => 
        e.toLowerCase().includes(s.toLowerCase()) || 
        s.toLowerCase().includes(e.toLowerCase())
      );
      return match || s;
    });

    res.json({
      success: true,
      suggestions: matched.slice(0, max_suggestions),
      existing_categories: existing.slice(0, 20)
    });
  } catch (error) {
    console.error('Suggest categories error:', error);
    res.status(500).json({ error: 'Failed to suggest categories' });
  }
}

// ============================================
// 🔄 RECATEGORIZE ARTICLE
// ============================================
async function recategorizeArticle(req, res) {
  const { article_id, categories } = req.body;

  if (!article_id || !categories) {
    return res.status(400).json({ error: 'article_id and categories required' });
  }

  if (!Array.isArray(categories) || categories.length > MAX_CATEGORIES_PER_ARTICLE) {
    return res.status(400).json({ 
      error: `Categories must be an array with max ${MAX_CATEGORIES_PER_ARTICLE} items` 
    });
  }

  try {
    const article = await getById('articles', article_id);
    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    const cleanCategories = categories
      .map(c => c.trim())
      .filter(c => c.length > 0)
      .slice(0, MAX_CATEGORIES_PER_ARTICLE);

    const updated = await update('articles', article_id, { 
      categories: cleanCategories,
      updated_at: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Article recategorized',
      article_id,
      categories: cleanCategories
    });
  } catch (error) {
    console.error('Recategorize article error:', error);
    res.status(500).json({ error: 'Failed to recategorize article' });
  }
}

// ============================================
// 📚 GET ARTICLES BY CATEGORY
// ============================================
async function getArticlesByCategory(req, res, id) {
  const { page = 1, limit = 20 } = req.query;

  try {
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data: articles, error, count } = await supabase
      .from('articles')
      .select('*', { count: 'exact' })
      .contains('categories', [id])
      .eq('status', 'processed')
      .range(from, to)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      category: id,
      page: parseInt(page),
      limit: parseInt(limit),
      total: count,
      articles: articles.map(a => ({
        id: a.article_id,
        title: a.canonical_title,
        slug: a.slug,
        summary: a.summary,
        source_domain: a.source_domain,
        created_at: a.created_at,
        categories: a.categories
      }))
    });
  } catch (error) {
    console.error('Get articles by category error:', error);
    res.status(500).json({ error: 'Failed to get articles' });
  }
}

// ============================================
// 🌳 GET CATEGORY TREE
// ============================================
async function getCategoryTree(req, res) {
  try {
    const { data: articles, error } = await supabase
      .from('articles')
      .select('categories')
      .not('categories', 'is', null);

    if (error) throw error;

    const { data: config, error: configError } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', 'category_metadata')
      .single();

    let metadata = {};
    if (!configError && config) {
      metadata = config.value || {};
    }

    const categoryMap = new Map();
    articles.forEach(article => {
      if (article.categories && Array.isArray(article.categories)) {
        article.categories.forEach(cat => {
          const clean = cat.trim();
          if (clean) {
            if (!categoryMap.has(clean)) {
              categoryMap.set(clean, {
                name: clean,
                slug: generateSlug(clean),
                count: 0,
                parent: metadata[clean]?.parent_category || null,
                children: [],
                description: metadata[clean]?.description || null
              });
            }
            categoryMap.get(clean).count++;
          }
        });
      }
    });

    const tree = [];
    const nodes = Array.from(categoryMap.values());
    const rootNodes = nodes.filter(n => !n.parent);
    rootNodes.forEach(root => {
      tree.push(buildTreeNode(root, nodes));
    });
    tree.sort((a, b) => b.count - a.count);

    res.json({
      success: true,
      tree
    });
  } catch (error) {
    console.error('Get category tree error:', error);
    res.status(500).json({ error: 'Failed to get category tree' });
  }
}

// ============================================
// 🔄 REBUILD CATEGORY INDEX
// ============================================
async function rebuildCategoryIndex(req, res) {
  try {
    const { data: articles, error } = await supabase
      .from('articles')
      .select('article_id, categories');

    if (error) throw error;

    const categoryIndex = new Map();
    articles.forEach(article => {
      if (article.categories && Array.isArray(article.categories)) {
        article.categories.forEach(cat => {
          const clean = cat.trim();
          if (clean) {
            if (!categoryIndex.has(clean)) {
              categoryIndex.set(clean, new Set());
            }
            categoryIndex.get(clean).add(article.article_id);
          }
        });
      }
    });

    const indexData = Array.from(categoryIndex.entries()).map(([name, articleSet]) => ({
      name,
      article_ids: Array.from(articleSet),
      count: articleSet.size
    }));

    await supabase
      .from('system_config')
      .upsert({
        key: 'category_index',
        value: indexData,
        updated_at: new Date().toISOString()
      }, { onConflict: 'key' });

    res.json({
      success: true,
      message: 'Category index rebuilt',
      total_categories: indexData.length,
      total_articles: articles.length
    });
  } catch (error) {
    console.error('Rebuild category index error:', error);
    res.status(500).json({ error: 'Failed to rebuild category index' });
  }
}

// ============================================
// 🔀 MERGE CATEGORIES
// ============================================
async function mergeCategories(req, res) {
  const { source_categories, target_category } = req.body;

  if (!source_categories || !Array.isArray(source_categories) || source_categories.length === 0) {
    return res.status(400).json({ error: 'source_categories array required' });
  }

  if (!target_category) {
    return res.status(400).json({ error: 'target_category required' });
  }

  try {
    const { data: articles, error } = await supabase
      .from('articles')
      .select('article_id, categories')
      .contains('categories', source_categories);

    if (error) throw error;

    let updatedCount = 0;
    for (const article of articles) {
      const newCategories = article.categories.map(cat => 
        source_categories.includes(cat) ? target_category : cat
      );
      
      const uniqueCategories = [...new Set(newCategories)]
        .slice(0, MAX_CATEGORIES_PER_ARTICLE);

      if (uniqueCategories.length !== article.categories.length) {
        await supabase
          .from('articles')
          .update({ categories: uniqueCategories })
          .eq('article_id', article.article_id);
        updatedCount++;
      }
    }

    const { data: config, error: configError } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', 'category_metadata')
      .single();

    let metadata = {};
    if (!configError && config) {
      metadata = config.value || {};
    }

    source_categories.forEach(source => {
      if (metadata[source]) {
        if (!metadata[target_category]) {
          metadata[target_category] = {
            description: metadata[source].description,
            aliases: [source, ...(metadata[source].aliases || [])],
            merged_from: [source]
          };
        } else {
          metadata[target_category].aliases = [
            ...(metadata[target_category].aliases || []),
            source,
            ...(metadata[source].aliases || [])
          ];
          metadata[target_category].merged_from = [
            ...(metadata[target_category].merged_from || []),
            source
          ];
        }
        delete metadata[source];
      }
    });

    await supabase
      .from('system_config')
      .upsert({
        key: 'category_metadata',
        value: metadata
      }, { onConflict: 'key' });

    res.json({
      success: true,
      message: `Merged ${source_categories.length} categories into "${target_category}"`,
      target_category,
      merged_categories: source_categories,
      articles_updated: updatedCount
    });
  } catch (error) {
    console.error('Merge categories error:', error);
    res.status(500).json({ error: 'Failed to merge categories' });
  }
}

// ============================================
// 📦 REMOVE CATEGORY FROM ARTICLE
// ============================================
async function removeCategoryFromArticle(req, res) {
  const { article_id, category } = req.body;

  if (!article_id || !category) {
    return res.status(400).json({ error: 'article_id and category required' });
  }

  try {
    const article = await getById('articles', article_id);
    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    if (!article.categories || !article.categories.includes(category)) {
      return res.status(404).json({ error: 'Category not found in article' });
    }

    const newCategories = article.categories.filter(c => c !== category);
    
    await update('articles', article_id, {
      categories: newCategories.length > 0 ? newCategories : null
    });

    res.json({
      success: true,
      message: `Category "${category}" removed from article`,
      article_id,
      remaining_categories: newCategories
    });
  } catch (error) {
    console.error('Remove category from article error:', error);
    res.status(500).json({ error: 'Failed to remove category' });
  }
}

// ============================================
// 🏗️ UPDATE CATEGORY HIERARCHY
// ============================================
async function updateCategoryHierarchy(req, res) {
  const { category_name, parent_category } = req.body;

  if (!category_name) {
    return res.status(400).json({ error: 'category_name required' });
  }

  try {
    const { data: config, error: configError } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', 'category_metadata')
      .single();

    let metadata = {};
    if (!configError && config) {
      metadata = config.value || {};
    }

    if (!metadata[category_name]) {
      metadata[category_name] = {};
    }

    metadata[category_name].parent_category = parent_category || null;
    metadata[category_name].hierarchy_updated_at = new Date().toISOString();

    await supabase
      .from('system_config')
      .upsert({
        key: 'category_metadata',
        value: metadata
      }, { onConflict: 'key' });

    res.json({
      success: true,
      message: `Category hierarchy updated`,
      category: category_name,
      parent: parent_category || 'root'
    });
  } catch (error) {
    console.error('Update category hierarchy error:', error);
    res.status(500).json({ error: 'Failed to update category hierarchy' });
  }
}

// ============================================
// ===== HELPER FUNCTIONS =====
// ============================================

// Generate slug from name
function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100);
}

// Calculate match score for search
function calculateMatchScore(category, searchTerm) {
  const catLower = category.toLowerCase();
  const searchLower = searchTerm.toLowerCase();
  
  if (catLower === searchLower) return 100;
  if (catLower.startsWith(searchLower)) return 80;
  if (catLower.includes(searchLower)) return 60;
  if (searchLower.includes(catLower)) return 40;
  
  const catWords = catLower.split(' ');
  const searchWords = searchLower.split(' ');
  let score = 0;
  
  for (const word of searchWords) {
    for (const catWord of catWords) {
      if (catWord === word) score += 20;
      else if (catWord.includes(word) || word.includes(catWord)) score += 10;
    }
  }
  
  return Math.min(score, 100);
}

// Get existing categories
async function getExistingCategories() {
  const { data: articles, error } = await supabase
    .from('articles')
    .select('categories')
    .not('categories', 'is', null);

  if (error) throw error;

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

// Build category tree node
function buildTreeNode(node, allNodes) {
  const children = allNodes.filter(n => n.parent === node.name);
  return {
    ...node,
    children: children.map(child => buildTreeNode(child, allNodes))
  };
}

// ============================================
// PROMPT BUILDERS
// ============================================

// Build category detection prompt for AI
function buildCategoryDetectionPrompt(content, title, existingCategories, currentCategories) {
  return `
You are an expert content categorizer. Analyze the following content and suggest appropriate categories.

Title: ${title || 'Untitled'}

Content Preview: ${content.substring(0, 2000)}...

Existing Categories in System:
${existingCategories.join(', ')}

Current Categories (if any): ${currentCategories?.join(', ') || 'None'}

Rules:
1. Suggest categories that best represent the content
2. Use existing categories when possible
3. Only create new categories if absolutely necessary
4. Max 5 categories per article
5. Categories should be broad enough to group similar content
6. Avoid creating too many niche categories

Return your response as a JSON array of category names.
`;
}

// Build category suggestion prompt
function buildCategorySuggestionPrompt(content, title, existingCategories, maxSuggestions) {
  return `
You are an expert content categorizer. Suggest appropriate categories for the following content.

Title: ${title || 'Untitled'}

Content Preview: ${content.substring(0, 1500)}...

Existing Categories in System:
${existingCategories.join(', ') || 'None'}

Rules:
1. Suggest ${maxSuggestions} categories that best represent the content
2. Prefer existing categories when possible
3. Only create new categories if absolutely necessary
4. Categories should be broad enough to group similar content
5. Avoid overly specific or niche categories

Return your response as a JSON array of category names.
`;
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
  CATEGORY_SIMILARITY_THRESHOLD
};