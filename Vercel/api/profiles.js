// api/profiles.js
// EasyRead Profile Management - Admin only CRUD operations

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

// ============================================
// CONSTANTS
// ============================================
const MAX_NAME_LENGTH = 20;
const MIN_DESCRIPTION_WORDS = 10;
const MAX_DESCRIPTION_WORDS = 700;

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
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-admin-key'
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
        return await handleGet(req, res, action);
      case 'POST':
        return await handlePost(req, res, action);
      case 'PUT':
        return await handlePut(req, res, action);
      case 'DELETE':
        return await handleDelete(req, res, action);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// ============================================
// GET HANDLER
// ============================================
async function handleGet(req, res, action) {
  const { id, name } = req.query;

  // Get all profiles (public)
  if (!action || action === 'list') {
    return await listProfiles(req, res);
  }

  // Get single profile by ID
  if (action === 'get' && id) {
    return await getProfileById(req, res, id);
  }

  // Get profile by name
  if (action === 'get-by-name' && name) {
    return await getProfileByName(req, res, name);
  }

  // Get default profile
  if (action === 'default') {
    return await getDefaultProfile(req, res);
  }

  // Get profile stats
  if (action === 'stats') {
    return await getProfileStats(req, res);
  }

  return res.status(400).json({ error: 'Invalid action or missing parameters' });
}

// ============================================
// POST HANDLER
// ============================================
async function handlePost(req, res, action) {
  const adminKey = req.headers['x-admin-key'];

  // Create profile - Admin only
  if (action === 'create') {
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized. Admin key required.' });
    }
    return await createProfile(req, res);
  }

  return res.status(400).json({ error: 'Invalid action' });
}

// ============================================
// PUT HANDLER
// ============================================
async function handlePut(req, res, action) {
  const adminKey = req.headers['x-admin-key'];

  // Update profile - Admin only
  if (action === 'update') {
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized. Admin key required.' });
    }
    return await updateProfile(req, res);
  }

  // Set default profile - Admin only
  if (action === 'set-default') {
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized. Admin key required.' });
    }
    return await setDefaultProfile(req, res);
  }

  return res.status(400).json({ error: 'Invalid action' });
}

// ============================================
// DELETE HANDLER
// ============================================
async function handleDelete(req, res, action) {
  const adminKey = req.headers['x-admin-key'];

  // Delete profile - Admin only
  if (action === 'delete') {
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized. Admin key required.' });
    }
    return await deleteProfile(req, res);
  }

  return res.status(400).json({ error: 'Invalid action' });
}

// ============================================
// ===== IMPLEMENTATION FUNCTIONS =====
// ============================================

// ============================================
// 📋 LIST PROFILES
// ============================================
async function listProfiles(req, res) {
  try {
    // Use supabase directly instead of getAll to avoid issues
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('status', 'active')
      .order('profile_id', { ascending: true });

    if (error) throw error;

    // Get usage count for each profile
    const { data: views, error: viewError } = await supabase
      .from('explanation_views')
      .select('profile_id');

    if (viewError) throw viewError;

    const usageCount = {};
    views?.forEach(v => {
      usageCount[v.profile_id] = (usageCount[v.profile_id] || 0) + 1;
    });

    const profilesWithUsage = profiles.map(profile => ({
      ...profile,
      usage_count: usageCount[profile.profile_id] || 0
    }));

    return res.json({
      success: true,
      profiles: profilesWithUsage,
      total: profilesWithUsage.length
    });

  } catch (error) {
    console.error('List profiles error:', error);
    return res.status(500).json({ error: 'Failed to list profiles' });
  }
}

// ============================================
// 📄 GET PROFILE BY ID
// ============================================
async function getProfileById(req, res, id) {
  try {
    // Use supabase directly
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('profile_id', parseInt(id))
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Profile not found' });
      }
      throw error;
    }

    // Get usage count
    const { count, error: countError } = await supabase
      .from('explanation_views')
      .select('view_id', { count: 'exact', head: true })
      .eq('profile_id', parseInt(id));

    if (countError) throw countError;

    return res.json({
      success: true,
      profile: {
        ...profile,
        usage_count: count || 0
      }
    });

  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json({ error: 'Failed to get profile' });
  }
}

// ============================================
// 🔍 GET PROFILE BY NAME
// ============================================
async function getProfileByName(req, res, name) {
  try {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('*')
      .ilike('name', name)
      .limit(1);

    if (error) throw error;

    if (!profiles || profiles.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const profile = profiles[0];

    // Get usage count
    const { count, error: countError } = await supabase
      .from('explanation_views')
      .select('view_id', { count: 'exact', head: true })
      .eq('profile_id', profile.profile_id);

    if (countError) throw countError;

    return res.json({
      success: true,
      profile: {
        ...profile,
        usage_count: count || 0
      }
    });

  } catch (error) {
    console.error('Get profile by name error:', error);
    return res.status(500).json({ error: 'Failed to get profile' });
  }
}

// ============================================
// ⭐ GET DEFAULT PROFILE
// ============================================
async function getDefaultProfile(req, res) {
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('is_default', true)
      .eq('status', 'active')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Fallback: get first active profile
        const { data: fallback, error: fallbackError } = await supabase
          .from('profiles')
          .select('*')
          .eq('status', 'active')
          .limit(1)
          .single();

        if (fallbackError) {
          return res.status(404).json({ error: 'No active profiles found' });
        }
        return res.json({ success: true, profile: fallback });
      }
      throw error;
    }

    return res.json({ success: true, profile });

  } catch (error) {
    console.error('Get default profile error:', error);
    return res.status(500).json({ error: 'Failed to get default profile' });
  }
}

// ============================================
// 📊 GET PROFILE STATS
// ============================================
async function getProfileStats(req, res) {
  try {
    // Total profiles
    const { count: totalProfiles, error: countError } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');

    if (countError) throw countError;

    // Profiles with usage
    const { data: views, error: viewError } = await supabase
      .from('explanation_views')
      .select('profile_id')
      .not('profile_id', 'is', null);

    if (viewError) throw viewError;

    const usageCount = {};
    views?.forEach(v => {
      usageCount[v.profile_id] = (usageCount[v.profile_id] || 0) + 1;
    });

    // Most used profile
    let mostUsed = null;
    let mostUsedCount = 0;
    for (const [id, count] of Object.entries(usageCount)) {
      if (count > mostUsedCount) {
        mostUsedCount = count;
        mostUsed = parseInt(id);
      }
    }

    let mostUsedProfile = null;
    if (mostUsed) {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('profile_id, name')
        .eq('profile_id', mostUsed)
        .single();

      if (!profileError) {
        mostUsedProfile = profile;
      }
    }

    return res.json({
      success: true,
      stats: {
        total_profiles: totalProfiles || 0,
        total_usage: views?.length || 0,
        most_used_profile: mostUsedProfile,
        usage_by_profile: usageCount
      }
    });

  } catch (error) {
    console.error('Get profile stats error:', error);
    return res.status(500).json({ error: 'Failed to get profile stats' });
  }
}

// ============================================
// 🆕 CREATE PROFILE (Admin only)
// ============================================
async function createProfile(req, res) {
  const { name, description, rules } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Profile name required' });
  }

  if (name.length > MAX_NAME_LENGTH) {
    return res.status(400).json({ error: `Name must be ${MAX_NAME_LENGTH} characters or less` });
  }

  if (!description) {
    return res.status(400).json({ error: 'Description required' });
  }

  const wordCount = description.split(/\s+/).length;
  if (wordCount < MIN_DESCRIPTION_WORDS) {
    return res.status(400).json({ 
      error: `Description must be at least ${MIN_DESCRIPTION_WORDS} words (currently ${wordCount})` 
    });
  }

  if (wordCount > MAX_DESCRIPTION_WORDS) {
    return res.status(400).json({ 
      error: `Description must be ${MAX_DESCRIPTION_WORDS} words or less (currently ${wordCount})` 
    });
  }

  try {
    // Check if profile name already exists
    const { data: existing, error: checkError } = await supabase
      .from('profiles')
      .select('profile_id')
      .eq('name', name)
      .limit(1);

    if (checkError) throw checkError;

    if (existing && existing.length > 0) {
      return res.status(409).json({ error: `Profile "${name}" already exists` });
    }

    // Create profile
    const { data: profile, error: insertError } = await supabase
      .from('profiles')
      .insert({
        name: name.trim(),
        description: description.trim(),
        rules: rules || null,
        status: 'active',
        is_system: false,
        is_default: false,
        created_by: 'admin'
      })
      .select()
      .single();

    if (insertError) throw insertError;

    return res.status(201).json({
      success: true,
      message: `Profile "${name}" created successfully`,
      profile
    });

  } catch (error) {
    console.error('Create profile error:', error);
    return res.status(500).json({ error: 'Failed to create profile' });
  }
}

// ============================================
// ✏️ UPDATE PROFILE (Admin only)
// ============================================
async function updateProfile(req, res) {
  const { id } = req.query;
  const { name, description, rules, status } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Profile ID required' });
  }

  try {
    // Get existing profile
    const { data: profile, error: getError } = await supabase
      .from('profiles')
      .select('*')
      .eq('profile_id', parseInt(id))
      .single();

    if (getError) {
      if (getError.code === 'PGRST116') {
        return res.status(404).json({ error: 'Profile not found' });
      }
      throw getError;
    }

    // Check if system profile
    if (profile.is_system && status === 'inactive') {
      return res.status(400).json({ 
        error: 'System profiles cannot be deactivated' 
      });
    }

    // Validate name if provided
    if (name) {
      if (name.length > MAX_NAME_LENGTH) {
        return res.status(400).json({ 
          error: `Name must be ${MAX_NAME_LENGTH} characters or less` 
        });
      }

      // Check if name already taken by another profile
      const { data: existing, error: checkError } = await supabase
        .from('profiles')
        .select('profile_id')
        .eq('name', name)
        .neq('profile_id', parseInt(id))
        .limit(1);

      if (checkError) throw checkError;

      if (existing && existing.length > 0) {
        return res.status(409).json({ error: `Profile "${name}" already exists` });
      }
    }

    // Validate description if provided
    if (description) {
      const wordCount = description.split(/\s+/).length;
      if (wordCount < MIN_DESCRIPTION_WORDS) {
        return res.status(400).json({ 
          error: `Description must be at least ${MIN_DESCRIPTION_WORDS} words` 
        });
      }
      if (wordCount > MAX_DESCRIPTION_WORDS) {
        return res.status(400).json({ 
          error: `Description must be ${MAX_DESCRIPTION_WORDS} words or less` 
        });
      }
    }

    // Build update data
    const updateData = {
      updated_at: new Date().toISOString()
    };

    if (name) updateData.name = name.trim();
    if (description) updateData.description = description.trim();
    if (rules !== undefined) updateData.rules = rules || null;
    if (status) updateData.status = status;

    // Don't allow deactivating default profile
    if (status === 'inactive' && profile.is_default) {
      return res.status(400).json({ 
        error: 'Cannot deactivate the default profile' 
      });
    }

    const { data: updated, error: updateError } = await supabase
      .from('profiles')
      .update(updateData)
      .eq('profile_id', parseInt(id))
      .select()
      .single();

    if (updateError) throw updateError;

    return res.json({
      success: true,
      message: 'Profile updated successfully',
      profile: updated
    });

  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
}

// ============================================
// 👑 SET DEFAULT PROFILE (Admin only)
// ============================================
async function setDefaultProfile(req, res) {
  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Profile ID required' });
  }

  try {
    // Check if profile exists and is active
    const { data: profile, error: getError } = await supabase
      .from('profiles')
      .select('*')
      .eq('profile_id', parseInt(id))
      .single();

    if (getError) {
      if (getError.code === 'PGRST116') {
        return res.status(404).json({ error: 'Profile not found' });
      }
      throw getError;
    }

    if (profile.status !== 'active') {
      return res.status(400).json({ error: 'Cannot set inactive profile as default' });
    }

    // Remove current default
    const { error: resetError } = await supabase
      .from('profiles')
      .update({ is_default: false })
      .eq('is_default', true);

    if (resetError) throw resetError;

    // Set new default
    const { data: updated, error: updateError } = await supabase
      .from('profiles')
      .update({ is_default: true })
      .eq('profile_id', parseInt(id))
      .select()
      .single();

    if (updateError) throw updateError;

    return res.json({
      success: true,
      message: `"${updated.name}" set as default profile`,
      profile: updated
    });

  } catch (error) {
    console.error('Set default profile error:', error);
    return res.status(500).json({ error: 'Failed to set default profile' });
  }
}

// ============================================
// 🗑️ DELETE PROFILE (Admin only)
// ============================================
async function deleteProfile(req, res) {
  const { id, force } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Profile ID required' });
  }

  try {
    // Get profile
    const { data: profile, error: getError } = await supabase
      .from('profiles')
      .select('*')
      .eq('profile_id', parseInt(id))
      .single();

    if (getError) {
      if (getError.code === 'PGRST116') {
        return res.status(404).json({ error: 'Profile not found' });
      }
      throw getError;
    }

    // Check if system profile
    if (profile.is_system) {
      return res.status(400).json({ 
        error: 'System profiles cannot be deleted' 
      });
    }

    // Check if default profile
    if (profile.is_default) {
      return res.status(400).json({ 
        error: 'The default profile cannot be deleted. Set another profile as default first.' 
      });
    }

    // Check if profile is in use
    const { count, error: countError } = await supabase
      .from('explanation_views')
      .select('view_id', { count: 'exact', head: true })
      .eq('profile_id', parseInt(id));

    if (countError) throw countError;

    if (count > 0 && !force) {
      return res.status(409).json({
        error: `Profile is in use by ${count} explanations`,
        usage_count: count,
        force_required: true,
        message: 'Use force=true to delete and reassign or delete associated explanations'
      });
    }

    // If force, delete associated explanations first
    if (force && count > 0) {
      const { error: deleteError } = await supabase
        .from('explanation_views')
        .delete()
        .eq('profile_id', parseInt(id));

      if (deleteError) throw deleteError;
    }

    // Delete profile
    await deleteRecord('profiles', id);

    return res.json({
      success: true,
      message: `Profile "${profile.name}" deleted successfully`,
      deleted_explanations: force ? count : 0
    });

  } catch (error) {
    console.error('Delete profile error:', error);
    return res.status(500).json({ error: 'Failed to delete profile' });
  }
}