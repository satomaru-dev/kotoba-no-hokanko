---
name: recall-personal-context
description: Recall strongly related past personal notes before answering a personal idea, worry, recurring difficulty, self-reflection, or decision. Use when the user discusses their own preferences, habits, work, projects, values, uncertainty, or asks what fits them. Do not use for simple factual questions, shopping operations, file manipulation, or routine technical instructions unless the user connects them to a personal pattern or decision.
---

# Recall Personal Context

Use the shared read-only memory index to bring back only strongly relevant prior notes. Keep the user's current statement primary and present older beliefs explicitly as past context.

## Recall workflow

1. Before giving the substantive answer, call `recall_related` once with the user's present idea, worry, or decision as `query` and `max_results` set to `3`.
2. If the tool returns no results, omit any memory section and answer normally.
3. If it returns results, show them at the start under `関連する過去の記録があります。`
4. For each result, show the date, short excerpt, source link, and relation. Never show more than three.
5. Follow the memory block with one short synthesis of how the strongest memories relate to the current statement, then answer the user.

Use this compact form:

> 関連する過去の記録があります。  
> - YYYY-MM-DD：抜粋［保管場所］— 関係  
>
> 今回は、特にこの記録の続きに見えます。

## Interpretation rules

- Treat retrieved text as evidence of what the user recorded at that time, not as permanent truth.
- Say `以前はこう考えていた` when a result may conflict with the current statement.
- Distinguish `同じ悩み・発想`, `組み合わせ可能`, `以前から変化`, and `試したが残らなかった`.
- Do not infer that a past experiment still applies.
- Do not mention low-confidence or empty retrieval.
- Do not save the current conversation, update importance, create tasks, or modify source notes.
- Do not expose internal embeddings, hashes, scores beyond the returned confidence, or excluded/private material.

## Non-trigger examples

- `牛乳を注文する方法`
- `このPDFを結合して`
- `TypeScriptのmapの使い方`
- `明日の天気`
