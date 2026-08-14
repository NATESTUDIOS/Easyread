// utils/models.js

// ============================================
// MODEL CONFIGURATION
// ============================================

export const MODEL_CONFIG = {
  // ---------- GENERATION MODELS (High Quality) ----------
  generation: {
    primary: {
      id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      context: 1000000, // 1M tokens
      speed: 11,
      quality: 5,
      weeklyTokens: '2.5T'
    },
    fallback1: {
      id: 'nvidia/nemotron-3.5-lightning:free',
      context: 1000000,
      speed: 78,
      quality: 4.5,
      weeklyTokens: '128B'
    },
    fallback2: {
      id: 'nvidia/nemotron-3-super-120b-a12b:free',
      context: 262144,
      speed: 38,
      quality: 4,
      weeklyTokens: '380B'
    },
    fallback3: {
      id: 'nvidia/nemotron-3-nano-30b-a3b:free',
      context: 256000,
      speed: 108,
      quality: 3.5,
      weeklyTokens: '51B'
    },
    maxTokens: 4096,
    temperature: 0.7,
    topP: 0.9
  },

  // ---------- FAST GENERATION (Speed First) ----------
  fast: {
    primary: {
      id: 'nvidia/nemotron-3.5-lightning:free',
      context: 1000000,
      speed: 78,
      quality: 4.5,
      weeklyTokens: '128B'
    },
    fallback1: {
      id: 'nvidia/nemotron-3-nano-30b-a3b:free',
      context: 256000,
      speed: 108,
      quality: 3.5,
      weeklyTokens: '51B'
    },
    fallback2: {
      id: 'nvidia/nemotron-3-nano-omni:free',
      context: 256000,
      speed: 95,
      quality: 3.5,
      weeklyTokens: '40.9B'
    },
    maxTokens: 2048,
    temperature: 0.3,
    topP: 0.9
  },

  // ---------- EMBEDDING MODELS ----------
  embedding: {
    primary: {
      id: 'nvidia/llama-nemotron-embed-vl-1b-v2:free',
      context: 131072, // 131K tokens
      dimensions: 2048,
      weeklyTokens: '4.47B'
    },
    fallback: {
      id: 'nvidia/nemotron-3-embed-1b:free',
      context: 32768, // 33K tokens
      dimensions: 768,
      weeklyTokens: '6.89B'
    },
    maxTokens: 131072
  },

  // ---------- TASK TO MODEL GROUP MAPPING ----------
  tasks: {
    // Generation tasks (high quality)
    content_processing: 'generation',
    explanation: 'generation',
    deep_dive: 'generation',

    // Fast tasks (speed first)
    user_questions: 'fast',
    category_detection: 'fast',
    summarization: 'fast',
    rating_analysis: 'fast',

    // Embedding tasks
    embedding: 'embedding'
  }
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get model configuration for a specific task
 */
export function getModelConfig(task) {
  const taskType = MODEL_CONFIG.tasks[task] || 'generation';
  return MODEL_CONFIG[taskType];
}

/**
 * Get all model IDs in fallback order
 */
export function getModelIds(task) {
  const config = getModelConfig(task);
  const models = [];

  if (config.primary) models.push(config.primary.id);
  if (config.fallback1) models.push(config.fallback1.id);
  if (config.fallback2) models.push(config.fallback2.id);
  if (config.fallback3) models.push(config.fallback3.id);

  return models;
}

/**
 * Get the primary model for a task
 */
export function getPrimaryModel(task) {
  const config = getModelConfig(task);
  return config.primary?.id || config.id;
}

/**
 * Check if a model is free
 */
export function isFreeModel(modelId) {
  return modelId.includes(':free');
}

/**
 * Get model details by ID
 */
export function getModelDetails(modelId) {
  const allConfigs = [
    MODEL_CONFIG.generation,
    MODEL_CONFIG.fast,
    MODEL_CONFIG.embedding
  ];

  for (const config of allConfigs) {
    const fields = ['primary', 'fallback1', 'fallback2', 'fallback3'];
    for (const field of fields) {
      if (config[field] && config[field].id === modelId) {
        return {
          ...config[field],
          maxTokens: config.maxTokens,
          temperature: config.temperature
        };
      }
    }
  }
  return null;
}

// ============================================
// EXPORT
// ============================================

export default {
  MODEL_CONFIG,
  getModelConfig,
  getModelIds,
  getPrimaryModel,
  isFreeModel,
  getModelDetails
};
