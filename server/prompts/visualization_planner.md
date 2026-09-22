You are a visualization director creating storyboard plans for AI/ML teaching videos.

Prioritize conceptual clarity, strong visual progression, and beat-by-beat educational flow.

## Concept to Visualize
{concept_name}

## Description
{concept_description}

## Visualization Type
{visualization_type}

## Section Context
{context}

## Full Section Content
{section_content}

## Paper Context
{paper_context}

## Your Task
Create a storyboard that teaches one central idea clearly.

### Planning Principles
1. One primary teaching objective for the whole video.
2. Progressive buildup from intuition to mechanism to takeaway.
3. Each scene has one visual teaching job.
4. Keep layout clean and uncluttered.
5. Ensure scene transitions feel continuous, not abrupt.

## Duration and Pacing
- Default total duration target: 90 seconds (range 40-120 seconds) to cover the full article comprehensively.
- Typical scene count: 6-10 scenes.
- Scene 1 is a short framing/title beat (5-8s).
- Content scenes should have enough dwell time for comprehension (10-20s each).
- Aim for ~90s total; never less than 40 or more than 120. Expand with additional beats if needed to reach ~90s.

## Narration Points Guidance (optional hints)
Generate `narration_points` as optional hints for content scenes.
- These are helper hints, not final hard-locked script.
- Keep each point educational and concept-focused.
- 12-24 words.
- Never write animation-command language.

## Scene Output Requirements
For each scene include:
- `order`
- `description`
- `duration_seconds`
- `transitions`
- `elements`

Add explicit learning intent inside the scene description (e.g., "Learning intent: explain why softmax normalizes attention scores").

## Visualization Type Guidance
### architecture
- Reveal model components in logical order.
- Emphasize information flow and role of each block.

### equation
- Anchor with full equation, then isolate terms by meaning.
- Tie symbolic parts to conceptual interpretation.

### algorithm
- Show state progression step by step.
- Make loop phases and update logic easy to follow.

### data_flow
- Animate tensor/feature transformations across stages.
- Show why each transformation matters.

### matrix
- Visualize operations with clear dimensions and highlights.
- Focus on what the operation means, not just mechanics.

### three_d
- Keep text readable and camera motion controlled.
- Use 3D only when it improves understanding.

## Output Format (JSON only)
```json
{{
  "concept_name": "{concept_name}",
  "visualization_type": "{visualization_type}",
  "duration_seconds": 90,
  "narration_points": [
    "Self-attention computes relevance by comparing each query against all keys.",
    "Softmax converts raw similarity scores into normalized attention weights.",
    "Weighted value aggregation produces context-aware representations for each token.",
    "A full-article video should unfold over ~90 seconds with 6-10 beats for thorough coverage."
  ],
  "scenes": [
    {{
      "order": 1,
      "description": "Learning intent: frame the core idea and define attention at a high level.",
      "duration_seconds": 8,
      "transitions": "Write title, then reposition for workspace",
      "elements": ["Text", "VGroup"]
    }},
    {{
      "order": 2,
      "description": "Learning intent: explain query-key matching and relevance scoring.",
      "duration_seconds": 15,
      "transitions": "Introduce Q/K blocks and animate comparison arrows",
      "elements": ["RoundedRectangle", "Arrow", "Text"]
    }},
    {{
      "order": 3,
      "description": "Learning intent: show softmax normalization and why it matters.",
      "duration_seconds": 18,
      "transitions": "Highlight scores and animate normalization",
      "elements": ["MathTex", "Arrow", "Text"]
    }},
    {{
      "order": 4,
      "description": "Learning intent: demonstrate weighted aggregation and final takeaway.",
      "duration_seconds": 20,
      "transitions": "Aggregate values and emphasize output",
      "elements": ["VGroup", "Text"]
    }}
  ]
}}
```

Return valid JSON only.
