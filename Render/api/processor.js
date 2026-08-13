// processor.js
// EasyRead Processor - Complete AI processing service for Render

import { createClient } from '@supabase/supabase-js';
import openRouter from './utils/openrouter.js';
import crypto from 'crypto';

// ============================================
// CONFIGURATION
// ============================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

// ============================================
// INITIALIZE SUPABASE
// ============================================

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// ============================================
// LOGGING
// ============================================

function log(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = {
    info: '📘',
    success: '✅',
    error: '❌',
    warn: '⚠️',
    ai: '🤖',
    embed: '🧠',
    store: '💾',
    process: '⚙️'
  }[type] || '📘';
  console.log(`${timestamp} ${prefix} ${message}`);
}

// ============================================
// MAIN PROCESSOR LOOP
// ============================================

async function main() {
  log('🤖 EasyRead Processor Started', 'info');
  
  // Get status from openRouter
  const status = openRouter.getStatus();
  log(`📊 Daily Limit: ${status.dailyLimit} requests (${status.dailyRemaining} remaining)`, 'info');
  log(`📦 Embedding Model: ${status.models.embedding.primary}`, 'info');
  log(`📦 Generation Model: ${status.models.generation.primary}`, 'info');

  // Continuous polling
  while (true) {
    try {
      await processPendingArticles();
    } catch (error) {
      log(`Processor error: ${error.message}`, 'error');
    }
    await sleep(5000);
  }
}

// ============================================
// PROCESS PENDING ARTICLES
// ============================================

async function processPendingArticles() {
  // Get articles that need processing (status = 'processing' or 'pending')
  const { data: articles, error } = await supabase
    .from('articles')
    .select('*')
    .in('status', ['processing', 'pending'])
    .limit(3);

  if (error) {
    log(`Failed to fetch articles: ${error.message}`, 'error');
    return;
  }

  if (!articles || articles.length === 0) {
    return;
  }

  log(`📋 Found ${articles.length} articles to process`, 'info');

  for (const article of articles) {
    await processArticle(article);
  }
}

// ============================================
// PROCESS SINGLE ARTICLE
// ============================================

async function processArticle(article) {
  const articleId = article.article_id;
  log(`🔄 Processing article ${articleId}: "${article.canonical_title}"`, 'process');

  try {
    // STEP 1: Get existing categories
    log(`📂 Fetching existing categories...`, 'info');
    const existingCategories = await getExistingCategories();

    // STEP 2: Build Base Article with AI using openRouter
    log(`📝 Generating Base Article...`, 'ai');
    const baseArticle = await generateBaseArticle(article, existingCategories);
    
    if (!baseArticle) {
      throw new Error('Failed to generate Base Article');
    }
    log(`✅ Base Article generated: "${baseArticle.title}"`, 'success');

    // STEP 3: Generate embedding using openRouter
    log(`🧠 Generating embedding...`, 'embed');
    const embeddingResult = await openRouter.generateEmbedding(
      baseArticle.content,
      true // useLongContext
    );
    
    if (!embeddingResult || !embeddingResult.embedding) {
      throw new Error('Failed to generate embedding');
    }
    log(`✅ Embedding generated (${embeddingResult.dimensions} dimensions)`, 'embed');

    // STEP 4: Update article in database
    log(`💾 Saving Base Article to database...`, 'store');
    const updatedArticle = await saveBaseArticle(articleId, baseArticle, embeddingResult.embedding);
    log(`✅ Article ${updatedArticle.article_id} saved`, 'store');

    // STEP 5: Update processing job status
    await updateJobStatus(articleId, 'processing', 'success');

    // STEP 6: Get all active profiles
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('status', 'active');

    if (profileError) {
      log(`Failed to fetch profiles: ${profileError.message}`, 'error');
    }

    // STEP 7: Generate Explanation Views for each profile using openRouter
    if (profiles && profiles.length > 0) {
      log(`📋 Generating ${profiles.length} explanation views...`, 'info');
      
      for (const profile of profiles) {
        await generateExplanationView(updatedArticle, profile, baseArticle);
      }
    }

    // STEP 8: Update embedding status
    await updateJobStatus(articleId, 'embedding', 'success');

    // STEP 9: Mark article as fully processed
    await supabase
      .from('articles')
      .update({
        status: 'processed',
        updated_at: new Date().toISOString()
      })
      .eq('article_id', articleId);

    // STEP 10: Update job storage status
    await updateJobStatus(articleId, 'storage', 'success');

    log(`✅ Article ${articleId} fully processed`, 'success');

  } catch (error) {
    log(`❌ Article ${articleId} failed: ${error.message}`, 'error');
    
    await supabase
      .from('articles')
      .update({
        status: 'failed',
        updated_at: new Date().toISOString()
      })
      .eq('article_id', articleId);
    
    await updateJobStatus(articleId, 'error', error.message);
  }
}

// ============================================
// STEP 1: GET EXISTING CATEGORIES
// ============================================

async function getExistingCategories() {
  const { data: articles, error } = await supabase
    .from('articles')
    .select('categories')
    .not('categories', 'is', null);

  if (error) {
    log(`Failed to fetch categories: ${error.message}`, 'warn');
    return [];
  }

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

// ============================================
// STEP 2: GENERATE BASE ARTICLE
// ============================================

async function generateBaseArticle(article, existingCategories) {
  const prompt = buildBaseArticlePrompt(article, existingCategories);

  try {
    // Use openRouter's generateJSON method
    const response = await openRouter.generateJSON(prompt, 'content_processing', {
      temperature: 0.7,
      maxTokens: 8192
    });

    if (!response || !response.parsed) {
      throw new Error('Failed to parse AI response');
    }

    const parsed = response.parsed;

    // Validate required fields
    const required = ['title', 'content', 'summary', 'categories'];
    for (const field of required) {
      if (!parsed[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Ensure categories are valid (max 5)
    const validCategories = parsed.categories
      .filter(c => c && typeof c === 'string' && c.trim().length > 0)
      .slice(0, 5);

    // Convert content to string if array
    let contentString = parsed.content;
    if (Array.isArray(contentString)) {
      contentString = contentString
        .map(section => `## ${section.heading || 'Section'}\n\n${section.body || ''}`)
        .join('\n\n');
    }

    return {
      canonical_topic: parsed.canonical_topic || parsed.title,
      title: parsed.title,
      content: contentString,
      summary: parsed.summary || '',
      categories: validCategories.length > 0 ? validCategories : ['General'],
      estimated_read_time_minutes: parsed.estimated_read_time_minutes || 
        Math.ceil(contentString.split(/\s+/).length / 200),
      source_facts: parsed.source_facts || [],
      model_used: response.model
    };

  } catch (error) {
    log(`AI generation failed: ${error.message}`, 'error');
    return null;
  }
}

// ============================================
// STEP 3: GENERATE EXPLANATION VIEW
// ============================================

async function generateExplanationView(article, profile, baseArticle) {
  try {
    // Check if explanation already exists
    const { data: existing, error: checkError } = await supabase
      .from('explanation_views')
      .select('view_id')
      .eq('article_id', article.article_id)
      .eq('profile_id', profile.profile_id)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      log(`Check error: ${checkError.message}`, 'warn');
    }

    if (existing) {
      log(`⏭️ Explanation already exists for profile: ${profile.name}`, 'info');
      return;
    }

    log(`📝 Generating explanation for profile: ${profile.name}`, 'ai');

    const prompt = buildExplanationPrompt(baseArticle, profile);
    
    // Use openRouter's generateJSON method
    const response = await openRouter.generateJSON(prompt, 'explanation', {
      temperature: 0.7,
      maxTokens: 4096
    });

    if (!response || !response.parsed) {
      throw new Error('Failed to parse explanation response');
    }

    const parsed = response.parsed;

    // Validate
    if (!parsed.title || !parsed.content) {
      throw new Error('Missing required fields in explanation');
    }

    // Convert content to string
    let contentString = parsed.content;
    if (Array.isArray(contentString)) {
      contentString = contentString
        .map(section => `## ${section.heading || 'Section'}\n\n${section.body || ''}`)
        .join('\n\n');
    }

    // Generate embedding for explanation using openRouter
    log(`🧠 Generating embedding for explanation...`, 'embed');
    const embeddingResult = await openRouter.generateEmbedding(
      contentString,
      true
    );

    // Save explanation view
    const { data: view, error: saveError } = await supabase
      .from('explanation_views')
      .insert({
        article_id: article.article_id,
        profile_id: profile.profile_id,
        title: parsed.title,
        content: contentString,
        summary: parsed.summary || '',
        article_version: article.version || 1,
        profile_version: 1,
        embedding: embeddingResult ? embeddingResult.embedding : null,
        view_count: 0,
        rating_avg: 0,
        rating_count: 0,
        generated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (saveError) {
      throw new Error(`Failed to save explanation: ${saveError.message}`);
    }

    log(`✅ Explanation saved for profile: ${profile.name}`, 'success');

  } catch (error) {
    log(`❌ Failed to generate explanation for ${profile.name}: ${error.message}`, 'error');
  }
}

// ============================================
// SAVE BASE ARTICLE
// ============================================

async function saveBaseArticle(articleId, baseArticle, embedding) {
  const { data, error } = await supabase
    .from('articles')
    .update({
      canonical_title: baseArticle.title,
      base_content: baseArticle.content,
      summary: baseArticle.summary,
      categories: baseArticle.categories,
      embedding: embedding,
      status: 'processing',
      updated_at: new Date().toISOString()
    })
    .eq('article_id', articleId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to save article: ${error.message}`);
  }

  return data;
}

// ============================================
// UPDATE JOB STATUS
// ============================================

async function updateJobStatus(articleId, stage, status) {
  try {
    // Find the job for this article
    const { data: jobs, error } = await supabase
      .from('processing_jobs')
      .select('job_id, stages')
      .eq('article_id', articleId)
      .order('started_at', { ascending: false })
      .limit(1);

    if (error || !jobs || jobs.length === 0) {
      return;
    }

    const job = jobs[0];
    const stages = job.stages || {};
    stages[stage] = status;

    await supabase
      .from('processing_jobs')
      .update({
        current_stage: stage,
        stages: stages,
        status: status === 'success' ? 'processing' : 'failed'
      })
      .eq('job_id', job.job_id);

  } catch (error) {
    log(`Failed to update job status: ${error.message}`, 'warn');
  }
}

// ============================================
// SLEEP UTILITY
// ============================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// PROMPT BUILDERS
// ============================================

function buildBaseArticlePrompt(article, existingCategories) {
  const sourceInfo = `
URL: ${article.source_url || 'Not available'}
Domain: ${article.source_domain || 'Not available'}
Source Title: ${article.source_title || article.canonical_title || 'Not available'}
Retrieved At: ${article.retrieved_at || new Date().toISOString()}
`;

  const existingCategoriesText = existingCategories.length > 0 
    ? existingCategories.join(', ') 
    : 'None yet. You may create new categories if necessary.';

  return `You are the EasyRead Base Article Builder.

Your job is to transform reliable source content into a clear, structured, factual, profile-agnostic EasyRead Base Article.

The Base Article is the canonical knowledge layer of EasyRead.

It must explain WHAT the source says and WHAT the subject means without adapting the explanation to a user's personal interests, hobbies, profession, or Explanation Profile.

A Base Article must be understandable on its own.

==================================================
CORE PRINCIPLE
==================================================

BUILD THE KNOWLEDGE ONCE.

The Base Article is the factual foundation from which EasyRead can later create:

- Explanation Views
- Profile-based explanations
- Deep Dives
- Search results
- Related knowledge

Therefore:

FACTUAL KNOWLEDGE belongs in the Base Article.

PERSONALIZED EXPLANATION belongs in the Explanation View.

Never mix the two.

==================================================
INPUT
==================================================

SOURCE INFORMATION

${sourceInfo}

SOURCE CONTENT

${article.base_content.substring(0, 10000)}

==================================================
STEP 1 — UNDERSTAND THE SOURCE
==================================================

First determine internally:

1. What is the main subject?
2. What is the central idea?
3. What important concepts are discussed?
4. What facts support those concepts?
5. What relationships exist between the concepts?
6. What definitions are necessary?
7. What examples does the source provide?
8. What limitations, exceptions or conditions are important?
9. What information is uncertain or unsupported?

Do not expose this analysis.

==================================================
STEP 2 — DETERMINE THE CANONICAL TOPIC
==================================================

Identify the underlying knowledge represented by the source.

Create:

canonical_topic

This should describe the subject itself rather than the wording of the source.

Example:

Source:
"How Rising Interest Rates Affect Your Mortgage"

Canonical topic:
"How interest rates affect borrowing and mortgages"

Do not make the canonical topic unnecessarily specific if the source covers a broader concept.

==================================================
STEP 3 — CREATE THE TITLE
==================================================

Create a title that:

- Is clear
- Creates curiosity
- Represents the actual subject
- Does not use misleading clickbait
- Does not exaggerate
- Is understandable to a beginner
- Does not feel academically intimidating

The title should make the reader curious enough to understand the subject.

==================================================
STEP 4 — BUILD THE CONTENT
==================================================

Transform the source into a structured explanation.

Do NOT simply summarize the source paragraph-by-paragraph.

Reorganize information when doing so improves understanding.

Build the explanation progressively.

Prefer this general progression:

1. What is it?
2. Why does it matter?
3. How does it work?
4. What are its important parts?
5. How do the parts connect?
6. What happens in practice?
7. What important exceptions or limitations exist?
8. What should the reader remember?

Use the order that best fits the subject.

==================================================
EASYREAD WRITING STANDARD
==================================================

Every section should be tested against:

"Would this make sense to someone reading it on their phone while half-paying attention on a bus?"

If not, rewrite it.

The writing should be:

- Clear
- Warm
- Human
- Conversational
- Easy to scan
- Mobile-friendly
- Memorable
- Accurate

Avoid unnecessary academic language.

Do not make the content childish.

Simple language must still preserve the depth of the subject.

==================================================
TECHNICAL TERMS
==================================================

Do not remove necessary technical terminology.

Instead:

1. Introduce the technical term.
2. Explain what it means in simple language.
3. Explain why it matters.
4. Use it correctly afterward.

Example:

"Liquidity is simply how easily an asset can be converted into cash without significantly reducing its value."

==================================================
EXAMPLES
==================================================

Use examples when they improve understanding.

Examples may come from:

- The source
- Simple everyday situations
- Straightforward hypothetical scenarios

Do not invent real-world facts and present them as factual.

Clearly distinguish hypothetical examples from real events.

Do not add examples merely to make the article longer.

==================================================
SOURCE FIDELITY
==================================================

The source is the primary factual basis.

DO NOT:

- Invent facts
- Invent statistics
- Invent dates
- Invent names
- Invent events
- Invent quotations
- Invent relationships
- Fill knowledge gaps with guesses

If the source does not provide enough information, do not fabricate the missing information.

The Base Article may reorganize and clarify the source, but must not materially change its meaning.

==================================================
FACTUAL CONFIDENCE
==================================================

When information is source-specific, preserve attribution.

Prefer:

"The source explains that..."

"According to the source..."

"The article reports..."

when appropriate.

Do not present an uncertain source claim as independently verified fact.

==================================================
CATEGORIES
==================================================

Assign the article to relevant existing Topic Categories.

Existing Categories: ${existingCategoriesText}

Maximum:

5 categories.

Prefer existing categories over creating new ones.

Do not create unnecessary niche categories.

For example, do not create:

"Beginner Investment Concepts"

if:

"Finance"

already accurately represents the subject.

Only suggest a new category if no existing category adequately represents the topic.

==================================================
SUMMARY
==================================================

Create a concise "So basically..." summary.

The summary should:

- Capture the central idea
- Connect the important concepts
- Help the reader remember the subject

Do not simply repeat the introduction.

==================================================
READING TIME
==================================================

Estimate reading time based on the final generated content.

Return the estimate in minutes.

==================================================
QUALITY CONTROL
==================================================

Before returning the result, silently check:

1. Is the article factually faithful to the source?
2. Did I accidentally invent information?
3. Is the central concept clear?
4. Are important concepts missing?
5. Are technical terms explained?
6. Is the structure logical?
7. Is unnecessary repetition removed?
8. Is it easy to scan on a phone?
9. Is the title accurate?
10. Are categories appropriate?
11. Are there no more than 5 categories?
12. Is the summary useful?
13. Does the article remain profile-agnostic?

If any answer is no, revise the article.

==================================================
OUTPUT
==================================================

Return ONLY valid JSON.

{
  "canonical_topic": "...",
  "title": "...",
  "content": [
    {
      "heading": "...",
      "body": "..."
    }
  ],
  "summary": "...",
  "categories": [
    "..."
  ],
  "estimated_read_time_minutes": 5,
  "source_facts": [
    "..."
  ]
}

Do not return Markdown.

Do not return commentary.

Do not explain your reasoning.

==================================================
FINAL PRINCIPLE
==================================================

The Base Article is not supposed to be the most entertaining version of the knowledge.

It is supposed to be the most useful, accurate and reusable foundation for explaining that knowledge to different people.`;
}

// ============================================
// BUILD EXPLANATION PROMPT
// ============================================

function buildExplanationPrompt(baseArticle, profile) {
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
${baseArticle.title}

Canonical Topic:
${baseArticle.canonical_topic || baseArticle.title}

Content:
${baseArticle.content.substring(0, 8000)}

Summary:
${baseArticle.summary}

Categories:
${baseArticle.categories.join(', ')}


EXPLANATION PROFILE

Name:
${profile.name}

Description:
${profile.description}

Rules:
${profile.rules || 'No specific rules'}

Profile Version:
1

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

// ============================================
// PROCESS SIGNALS
// ============================================

process.on('SIGTERM', () => {
  log('Received SIGTERM, shutting down...', 'warn');
  process.exit(0);
});

process.on('SIGINT', () => {
  log('Received SIGINT, shutting down...', 'warn');
  process.exit(0);
});

// ============================================
// START
// ============================================

main().catch(error => {
  log(`Fatal error: ${error.message}`, 'error');
  process.exit(1);
});
