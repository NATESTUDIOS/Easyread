// utils/supabase.js
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// ============================================
// 🔑 READ SECRETS (Render Compatible)
// ============================================

function readSecretFile(path) {
  try {
    return fs.readFileSync(path, 'utf8').trim();
  } catch (err) {
    return null;
  }
}

// Try Render secret files first, then fallback to env vars
let supabaseUrl = readSecretFile('/etc/secrets/SUPABASE_URL');
let supabaseKey = readSecretFile('/etc/secrets/SUPABASE_SERVICE_ROLE_KEY');

// Fallback to environment variables if secret files don't exist
if (!supabaseUrl) {
  supabaseUrl = process.env.SUPABASE_URL;
}

if (!supabaseKey) {
  supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
}

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials!');
  console.error('   Check: /etc/secrets/SUPABASE_URL and /etc/secrets/SUPABASE_SERVICE_ROLE_KEY');
  console.error('   Or set: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment');
  throw new Error('Missing Supabase credentials');
}

// ============================================
// 🔌 SINGLETON SUPABASE CLIENT
// ============================================

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
 * Get all records from a table
 */
export async function getAll(table, options = {}) {
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
}

/**
 * Get a record by ID
 */
export async function getById(table, id, idColumn = `${table}_id`) {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq(idColumn, id)
    .single();
  
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

/**
 * Get records by a specific column value
 */
export async function getByColumn(table, column, value) {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq(column, value);
  
  if (error) throw error;
  return data;
}

/**
 * Insert a record
 */
export async function insert(table, data, returning = true) {
  let query = supabase.from(table).insert(data);
  
  if (returning) {
    query = query.select();
  }
  
  const { data: result, error } = await query;
  if (error) throw error;
  return returning ? result[0] : result;
}

/**
 * Insert multiple records
 */
export async function insertMany(table, dataArray) {
  const { data, error } = await supabase
    .from(table)
    .insert(dataArray)
    .select();
  
  if (error) throw error;
  return data;
}

/**
 * Update a record
 */
export async function update(table, id, data, idColumn = `${table}_id`) {
  const { data: result, error } = await supabase
    .from(table)
    .update(data)
    .eq(idColumn, id)
    .select();
  
  if (error) throw error;
  return result[0];
}

/**
 * Update records by a condition
 */
export async function updateWhere(table, condition, data) {
  let query = supabase.from(table).update(data);
  
  for (const [key, value] of Object.entries(condition)) {
    query = query.eq(key, value);
  }
  
  const { data: result, error } = await query.select();
  if (error) throw error;
  return result;
}

/**
 * Delete a record
 */
export async function deleteRecord(table, id, idColumn = `${table}_id`) {
  const { data, error } = await supabase
    .from(table)
    .delete()
    .eq(idColumn, id)
    .select();
  
  if (error) throw error;
  return data[0];
}

/**
 * Check if a record exists
 */
export async function exists(table, column, value) {
  const { data, error } = await supabase
    .from(table)
    .select(column)
    .eq(column, value)
    .limit(1);
  
  if (error) throw error;
  return data.length > 0;
}

/**
 * Count records in a table
 */
export async function count(table, condition = {}) {
  let query = supabase.from(table).select('*', { count: 'exact', head: true });
  
  for (const [key, value] of Object.entries(condition)) {
    query = query.eq(key, value);
  }
  
  const { count, error } = await query;
  if (error) throw error;
  return count;
}

// ============================================
// 🧠 VECTOR OPERATIONS
// ============================================

/**
 * Perform vector similarity search on articles
 */
export async function findSimilarArticles(embedding, threshold = 0.7, limit = 5) {
  const { data, error } = await supabase.rpc('match_articles', {
    query_embedding: embedding,
    match_threshold: threshold,
    match_count: limit
  });
  
  if (error) throw error;
  return data;
}

/**
 * Perform vector similarity search on explanations
 */
export async function findSimilarExplanations(embedding, threshold = 0.7, limit = 5) {
  const { data, error } = await supabase.rpc('match_explanations', {
    query_embedding: embedding,
    match_threshold: threshold,
    match_count: limit
  });
  
  if (error) throw error;
  return data;
}

// ============================================
// 📁 FILE OPERATIONS
// ============================================

/**
 * Upload a file to Supabase Storage
 */
export async function uploadFile(bucket, path, file) {
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(path, file);
  
  if (error) throw error;
  return data;
}

/**
 * Get a public URL for a file
 */
export function getPublicUrl(bucket, path) {
  const { data } = supabase.storage
    .from(bucket)
    .getPublicUrl(path);
  
  return data.publicUrl;
}

/**
 * Delete a file from storage
 */
export async function deleteFile(bucket, path) {
  const { data, error } = await supabase.storage
    .from(bucket)
    .remove([path]);
  
  if (error) throw error;
  return data;
}

// ============================================
// 🔑 API KEY HELPER - For Supabase Validation
// ============================================
export async function registerApiKey() {
  try {
    const apiKey = process.env.ADMIN_API_KEY;
    const serverName = process.env.SERVER_NAME || 'render-server';

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
// ✅ UNCOMMENT THIS LINE FOR RENDER:
// registerApiKey().catch(console.error);

// ============================================
// 📦 EXPORTS
// ============================================
export const db = supabase;
export { supabase };

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