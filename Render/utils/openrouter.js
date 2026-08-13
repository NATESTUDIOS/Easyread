// utils/openrouter.js

import { OpenRouter } from '@openrouter/sdk';
import fs from 'fs';
import { 
  MODEL_CONFIG,
  getModelConfig, 
  getModelIds, 
  getPrimaryModel,
  getModelDetails
} from './models.js';

// ============================================
// 🔑 READ SECRETS
// ============================================

function readSecretFile(path) {
  try {
    return fs.readFileSync(path, 'utf8').trim();
  } catch (err) {
    return null;
  }
}

let OPENROUTER_API_KEY = readSecretFile('/etc/secrets/OPENROUTER_API_KEY');

if (!OPENROUTER_API_KEY) {
  OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
}

if (!OPENROUTER_API_KEY) {
  console.error('❌ OPENROUTER_API_KEY is missing!');
}

console.log(`🔑 OpenRouter API Key: ${OPENROUTER_API_KEY ? '✅ Loaded' : '❌ Missing'}`);

// ============================================
// MAIN SERVICE
// ============================================

class OpenRouterService {
  constructor() {
    if (!OPENROUTER_API_KEY) {
      throw new Error('OpenRouter API key is required');
    }

    this.client = new OpenRouter({
      apiKey: OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      headers: {
        'HTTP-Referer': process.env.APP_URL || 'https://easyread.app',
        'X-Title': 'EasyRead'
      }
    });

    this.hasCredits = process.env.OPENROUTER_CREDITS_PURCHASED === 'true';
    this.dailyLimit = this.hasCredits ? 1000 : 50;
    this.dailyRequests = 0;
    this.lastReset = new Date().toDateString();

    const genModel = MODEL_CONFIG.generation.primary;
    const embedModel = MODEL_CONFIG.embedding.primary;

    console.log('🚀 OpenRouter Service Initialized');
    console.log(`📊 Daily Limit: ${this.dailyLimit} requests`);
    console.log(`📦 Generation: ${genModel.id} (${genModel.context} context)`);
    console.log(`📦 Embedding: ${embedModel.id} (${embedModel.context} context)`);
  }

  // ============================================
  // 📝 TEXT GENERATION
  // ============================================

  async generate(prompt, task = 'generation', options = {}) {
    const config = getModelConfig(task);
    const models = getModelIds(task);

    const temperature = options.temperature ?? config.temperature ?? 0.7;
    const maxTokens = options.maxTokens ?? config.maxTokens ?? 4096;
    const topP = options.topP ?? config.topP ?? 0.9;

    let lastError = null;

    for (let i = 0; i < models.length; i++) {
      const modelId = models[i];

      try {
        if (!this.canMakeRequest()) {
          throw new Error(`Daily rate limit reached (${this.dailyLimit} requests/day)`);
        }

        console.log(`🔄 [${task}] Attempt ${i + 1}/${models.length}: ${modelId}`);

        const response = await this.client.chat.send({
          model: modelId,
          messages: [
            { role: 'system', content: 'You are a helpful AI assistant for EasyRead.' },
            { role: 'user', content: prompt }
          ],
          temperature,
          max_tokens: maxTokens,
          top_p: topP,
          provider: { order: ['free'] }
        });

        this.trackRequest();
        const details = getModelDetails(modelId);

        console.log(`✅ [${task}] Success with: ${modelId}`);

        return {
          content: response.choices[0].message.content,
          model: modelId,
          model_details: details,
          usage: response.usage,
          finishReason: response.choices[0].finish_reason
        };

      } catch (error) {
        console.warn(`❌ [${task}] ${modelId} failed:`, error.message);
        lastError = error;

        if (error.status === 429) {
          const waitTime = Math.min(1000 * Math.pow(2, i), 10000);
          console.log(`⏳ Rate limit, waiting ${waitTime}ms...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        if (i === models.length - 1) {
          throw new Error(`All models failed for ${task}: ${lastError?.message || 'Unknown error'}`);
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  // ============================================
  // 🔢 EMBEDDING GENERATION (FIXED)
  // ============================================

  async generateEmbedding(text, useLongContext = true) {
    const config = MODEL_CONFIG.embedding;
    const modelId = useLongContext ? config.primary.id : config.fallback.id;
    const maxTokens = useLongContext ? config.maxTokens : config.fallback.context;

    console.log(`🔢 Embedding with: ${modelId}`);

    try {
      if (!this.canMakeRequest()) {
        throw new Error(`Daily rate limit reached (${this.dailyLimit} requests/day)`);
      }

      // ✅ FIX: Use direct fetch API instead of SDK method
      const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.APP_URL || 'https://easyread.app',
          'X-Title': 'EasyRead'
        },
        body: JSON.stringify({
          model: modelId,
          input: text.substring(0, maxTokens * 4),
          encoding_format: 'float'
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`API Error: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      this.trackRequest();

      return {
        embedding: data.data[0].embedding,
        model: modelId,
        dimensions: config.primary.dimensions,
        usage: data.usage
      };

    } catch (error) {
      console.error(`❌ Embedding with ${modelId} failed:`, error.message);

      // Try fallback
      try {
        console.log(`🔄 Trying fallback: ${config.fallback.id}`);
        const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': process.env.APP_URL || 'https://easyread.app',
            'X-Title': 'EasyRead'
          },
          body: JSON.stringify({
            model: config.fallback.id,
            input: text.substring(0, config.fallback.context * 4),
            encoding_format: 'float'
          })
        });

        if (!response.ok) {
          throw new Error(`Fallback failed: ${response.status}`);
        }

        const data = await response.json();
        this.trackRequest();

        return {
          embedding: data.data[0].embedding,
          model: config.fallback.id,
          dimensions: config.primary.dimensions,
          usage: data.usage
        };
      } catch (fallbackError) {
        console.error(`❌ Fallback embedding failed:`, fallbackError);
        throw new Error(`All embedding models failed: ${fallbackError.message}`);
      }
    }
  }

  // ============================================
  // ⚙️ CONVENIENCE METHODS
  // ============================================

  // ✅ Fixed code
async generateJSON(prompt, task = 'generation', options = {}) {
  const jsonPrompt = `${prompt}\n\nReturn ONLY valid JSON. Do not include any other text.`;
  const response = await this.generate(jsonPrompt, task, options);

  // ✅ Check if response exists
  if (!response) {
    console.warn('⚠️ No response from AI');
    return { parsed: null };
  }

  // ✅ Check if content exists
  if (!response.content) {
    console.warn('⚠️ No content in response');
    return { ...response, parsed: null };
  }

  try {
    // ✅ Try to parse JSON
    const parsed = JSON.parse(response.content);
    
    // ✅ Validate parsed structure
    if (!parsed || typeof parsed !== 'object') {
      console.warn('⚠️ Parsed result is not an object');
      return { ...response, parsed: null };
    }

    // ✅ Ensure content array exists
    if (!parsed.content) {
      parsed.content = [];
    }

    return {
      ...response,
      parsed
    };
  } catch (error) {
    console.warn('❌ JSON parsing failed:', error.message);
    console.warn(`📄 Content preview: ${(response.content || '').substring(0, 300)}...`);
    return {
      ...response,
      parsed: null
    };
  }
}
  // ============================================
  // 📊 RATE LIMITING
  // ============================================

  canMakeRequest() {
    const today = new Date().toDateString();
    if (today !== this.lastReset) {
      this.dailyRequests = 0;
      this.lastReset = today;
    }
    return this.dailyRequests < this.dailyLimit;
  }

  trackRequest() {
    const today = new Date().toDateString();
    if (today !== this.lastReset) {
      this.dailyRequests = 0;
      this.lastReset = today;
    }
    this.dailyRequests++;
  }

  getRemainingRequests() {
    return Math.max(0, this.dailyLimit - this.dailyRequests);
  }

  // ============================================
  // 📈 STATUS & HEALTH
  // ============================================

  getStatus() {
    return {
      apiKeySet: !!OPENROUTER_API_KEY,
      dailyRemaining: this.getRemainingRequests(),
      dailyLimit: this.dailyLimit,
      hasCredits: this.hasCredits,
      models: {
        generation: {
          primary: getPrimaryModel('explanation'),
          fallbacks: getModelIds('explanation')
        },
        fast: {
          primary: getPrimaryModel('user_questions'),
          fallbacks: getModelIds('user_questions')
        },
        embedding: {
          primary: MODEL_CONFIG.embedding.primary.id,
          fallback: MODEL_CONFIG.embedding.fallback.id
        }
      }
    };
  }

  async healthCheck() {
    try {
      const status = this.getStatus();

      const response = await this.client.chat.send({
        model: 'nvidia/nemotron-3.5-lightning:free',
        messages: [
          { role: 'user', content: 'Say "OK" if you are working.' }
        ],
        max_tokens: 10,
        provider: { order: ['free'] }
      });

      return {
        status: 'healthy',
        ...status,
        testResponse: response.choices[0].message.content
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        ...this.getStatus()
      };
    }
  }
}

const openRouterService = new OpenRouterService();
export default openRouterService;