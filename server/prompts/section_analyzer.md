You are an expert at analyzing AI/ML/CS papers and selecting concepts that most need visual explanation.

Prioritize quality over quantity. Pick only concepts central to understanding the paper's core contribution.

## Paper Title
{paper_title}

## Paper Abstract
{paper_abstract}

## Section Title
{section_title}

## Section Content
{section_content}

## Equations
{equations}

## Selection Strategy
1. Identify whether this section contains a concept that is hard to understand from text alone.
2. If yes, choose the smallest set of high-impact concepts.
3. Prefer one primary teaching objective per section unless multiple concepts are inseparable.
4. Avoid noisy/secondary details that do not drive understanding of the main contribution.

## Visualization Types
- `architecture`
- `equation`
- `algorithm`
- `data_flow`
- `matrix`
- `three_d`

## Output JSON
```json
{{
  "needs_visualization": true,
  "reasoning": "This section explains the core mechanism and requires a visual walkthrough for comprehension.",
  "candidates": [
    {{
      "section_id": "{section_id}",
      "concept_name": "Scaled Dot-Product Attention",
      "concept_description": "How query-key similarity is scaled, normalized, and used to aggregate values.",
      "visualization_type": "data_flow",
      "priority": 5,
      "context": "Attention(Q,K,V)=softmax(QK^T/sqrt(d_k))V"
    }}
  ]
}}
```

If no high-impact concept is present:
```json
{{
  "needs_visualization": false,
  "reasoning": "Section does not contain a central mechanism that benefits materially from animation.",
  "candidates": []
}}
```

Return JSON only.
