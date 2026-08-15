// utils/supabase.js
import { createClient } from '@supabase/supabase-js';

// ============================================
// 🔌 SINGLETON SUPABASE CLIENT
// ============================================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('❌ Missing Supabase credentials in environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

console.log('✅ Supabase client initialized');

// ============================================
// 🗄️ DATABASE OPERATIONS
// ============================================

/**
 * Get the correct primary key column name for a table
 * Maps table names to their actual primary key column names
 */
function getPrimaryKeyColumn(table) {
  // Map of table names to their primary key column names
  const columnMap = {
    'articles': 'article_id',
    'users': 'user_id',
    'profiles': 'profile_id',
    'bookmarks': 'bookmark_id',
    'ratings': 'rating_id',
    'explanation_views': 'view_id',
    'deep_dives': 'deep_dive_id',
    'processing_jobs': 'job_id',
    'reading_history': 'history_id',
    'usage': 'usage_id',
    'credit_transactions': 'transaction_id',
    'article_versions': 'version_id',
    'reading_progress': 'progress_id',
    'system_config': 'key',
  };
  
  return columnMap[table] || `${table}_id`;
}

/**
 * Get all records from a table
 */
export async function getAll(table, options = {}) {
  try {
    let query = supabase.from(table).select('*');
    
    if (options.orderBy) {
      query = query.order(options.orderBy, { 
        ascending: options.ascending || false 
      });
    }
    
    if (options.limit) {
      query = query.limit(options.limit);
    }
    
    if (options.offset) {
      query = query.range(options.offset, options.offset + options.limit - 1);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    return data;
  } catch (error) {
    console.error(`[getAll] Failed for table "${table}":`, error);
    throw new Error(`Failed to fetch from ${table}: ${error.message}`);
  }
}

/**
 * Get a record by ID
 */
export async function getById(table, id, idColumn = getPrimaryKeyColumn(table)) {
  try {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq(idColumn, id)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') return null; // Record not found
      throw error;
    }
    return data;
  } catch (error) {
    if (error.code === 'PGRST116') return null;
    console.error(`[getById] Failed for ${table}.${idColumn}=${id}:`, error);
    throw new Error(`Failed to fetch from ${table}: ${error.message}`);
  }
}

/**
 * Get records by a specific column value
 */
export async function getByColumn(table, column, value) {
  try {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq(column, value);
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error(`[getByColumn] Failed for ${table}.${column}=${value}:`, error);
    throw new Error(`Failed to fetch from ${table}: ${error.message}`);
  }
}

/**
 * Insert a record
 */
export async function insert(table, data, returning = true) {
  try {
    let query = supabase.from(table).insert(data);
    
    if (returning) {
      query = query.select();
    }
    
    const { data: result, error } = await query;
    if (error) throw error;
    return returning ? result[0] : result;
  } catch (error) {
    console.error(`[insert] Failed for table "${table}":`, error);
    throw new Error(`Failed to insert into ${table}: ${error.message}`);
  }
}

/**
 * Insert multiple records
 */
export async function insertMany(table, dataArray) {
  try {
    const { data, error } = await supabase
      .from(table)
      .insert(dataArray)
      .select();
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error(`[insertMany] Failed for table "${table}":`, error);
    throw new Error(`Failed to insert multiple records into ${table}: ${error.message}`);
  }
}

/**
 * Update a record
 */
export async function update(table, id, data, idColumn = getPrimaryKeyColumn(table)) {
  try {
    const { data: result, error } = await supabase
      .from(table)
      .update(data)
      .eq(idColumn, id)
      .select();
    
    if (error) throw error;
    return result[0];
  } catch (error) {
    console.error(`[update] Failed for ${table}.${idColumn}=${id}:`, error);
    throw new Error(`Failed to update ${table}: ${error.message}`);
  }
}

/**
 * Update records by a condition
 */
export async function updateWhere(table, condition, data) {
  try {
    let query = supabase.from(table).update(data);
    
    for (const [key, value] of Object.entries(condition)) {
      query = query.eq(key, value);
    }
    
    const { data: result, error } = await query.select();
    if (error) throw error;
    return result;
  } catch (error) {
    console.error(`[updateWhere] Failed for table "${table}":`, error);
    throw new Error(`Failed to update ${table}: ${error.message}`);
  }
}

/**
 * Delete a record
 */
export async function deleteRecord(table, id, idColumn = getPrimaryKeyColumn(table)) {
  try {
    const { data, error } = await supabase
      .from(table)
      .delete()
      .eq(idColumn, id)
      .select();
    
    if (error) throw error;
    return data[0];
  } catch (error) {
    console.error(`[deleteRecord] Failed for ${table}.${idColumn}=${id}:`, error);
    throw new Error(`Failed to delete from ${table}: ${error.message}`);
  }
}

/**
 * Check if a record exists
 */
export async function exists(table, column, value) {
  try {
    const { data, error } = await supabase
      .from(table)
      .select(column)
      .eq(column, value)
      .limit(1);
    
    if (error) throw error;
    return data.length > 0;
  } catch (error) {
    console.error(`[exists] Failed for ${table}.${column}=${value}:`, error);
    throw new Error(`Failed to check existence in ${table}: ${error.message}`);
  }
}

/**
 * Count records in a table
 */
export async function count(table, condition = {}) {
  try {
    let query = supabase.from(table).select('*', { count: 'exact', head: true });
    
    for (const [key, value] of Object.entries(condition)) {
      query = query.eq(key, value);
    }
    
    const { count, error } = await query;
    if (error) throw error;
    return count;
  } catch (error) {
    console.error(`[count] Failed for table "${table}":`, error);
    throw new Error(`Failed to count records in ${table}: ${error.message}`);
  }
}

// ============================================
// 🧠 VECTOR OPERATIONS
// ============================================

/**
 * Perform vector similarity search on articles
 */
export async function findSimilarArticles(embedding, threshold = 0.7, limit = 5) {
  try {
    const { data, error } = await supabase.rpc('match_articles', {
      query_embedding: embedding,
      match_threshold: threshold,
      match_count: limit
    });
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('[findSimilarArticles] Failed:', error);
    throw new Error(`Failed to find similar articles: ${error.message}`);
  }
}

/**
 * Perform vector similarity search on explanations
 */
export async function findSimilarExplanations(embedding, threshold = 0.7, limit = 5) {
  try {
    const { data, error } = await supabase.rpc('match_explanations', {
      query_embedding: embedding,
      match_threshold: threshold,
      match_count: limit
    });
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('[findSimilarExplanations] Failed:', error);
    throw new Error(`Failed to find similar explanations: ${error.message}`);
  }
}

// ============================================
// 📁 FILE OPERATIONS
// ============================================

/**
 * Upload a file to Supabase Storage
 */
export async function uploadFile(bucket, path, file) {
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(path, file);
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error(`[uploadFile] Failed for ${bucket}/${path}:`, error);
    throw new Error(`Failed to upload file: ${error.message}`);
  }
}

/**
 * Get a public URL for a file
 */
export function getPublicUrl(bucket, path) {
  try {
    const { data } = supabase.storage
      .from(bucket)
      .getPublicUrl(path);
    
    return data.publicUrl;
  } catch (error) {
    console.error(`[getPublicUrl] Failed for ${bucket}/${path}:`, error);
    throw new Error(`Failed to get public URL: ${error.message}`);
  }
}

/**
 * Delete a file from storage
 */
export async function deleteFile(bucket, path) {
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .remove([path]);
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error(`[deleteFile] Failed for ${bucket}/${path}:`, error);
    throw new Error(`Failed to delete file: ${error.message}`);
  }
}

// ============================================
// 🔑 API KEY HELPER - For Supabase Validation
// ============================================
export async function registerApiKey() {
  try {
    const apiKey = process.env.ADMIN_API_KEY;
    const serverName = process.env.SERVER_NAME || 'server1';

    if (!apiKey) {
      console.warn('⚠️ ADMIN_API_KEY not set, skipping registration');
      return false;
    }

    const { data, error } = await supabase
      .from('system_config')
      .upsert({
        key: 'api_keys',
        value: {
          [apiKey]: {
            key: apiKey,
            server: serverName,
            registered_at: Date.now(),
            last_used: Date.now(),
            active: true
          }
        }
      }, { onConflict: 'key' })
      .select();

    if (error) throw error;
    
    console.log(`✅ API Key registered for ${serverName}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to register API key:', error.message);
    return false;
  }
}

// ============================================
// 🚀 AUTO-REGISTER ON STARTUP
// ============================================
// Auto-register API key on startup if ADMIN_API_KEY is set
if (process.env.ADMIN_API_KEY) {
  registerApiKey().catch(console.error);
}

// ============================================
// 📦 EXPORTS - MATCHING FIREBASE STYLE
// ============================================
export const db = supabase;
export { supabase };

// Default export for convenience
export default {
  supabase,
  db: supabase,
  getAll,
  getById,
  getByColumn,
  insert,
  insertMany,
  update,
  updateWhere,
  delete: deleteRecord,
  exists,
  count,
  findSimilarArticles,
  findSimilarExplanations,
  uploadFile,
  getPublicUrl,
  deleteFile,
  registerApiKey
};