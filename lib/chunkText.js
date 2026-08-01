// Découpe un texte long en morceaux traduisibles indépendamment, en coupant
// de préférence aux frontières de paragraphe puis de phrase, jamais au milieu
// d'un mot. Fonction pure, sans dépendance réseau — facile à tester isolément.

function chunkText(text, maxChunkChars = 3500) {
  if (typeof text !== 'string') {
    throw new TypeError('text doit être une chaîne de caractères');
  }
  if (maxChunkChars <= 0) {
    throw new RangeError('maxChunkChars doit être positif');
  }

  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChunkChars) return [trimmed];

  const paragraphs = trimmed.split(/\n{2,}/);
  const chunks = [];
  let current = '';

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;

    if (candidate.length <= maxChunkChars) {
      current = candidate;
      continue;
    }

    // Le paragraphe ne rentre pas avec ce qu'on a déjà accumulé : on vide,
    // puis si le paragraphe seul est encore trop long, on le découpe par phrase.
    flush();

    if (para.length <= maxChunkChars) {
      current = para;
      continue;
    }

    const sentences = para.split(/(?<=[.!?])\s+/);
    let sentenceBuffer = '';
    for (const sentence of sentences) {
      const sCandidate = sentenceBuffer ? `${sentenceBuffer} ${sentence}` : sentence;
      if (sCandidate.length <= maxChunkChars) {
        sentenceBuffer = sCandidate;
        continue;
      }
      if (sentenceBuffer) {
        chunks.push(sentenceBuffer.trim());
        sentenceBuffer = '';
      }
      if (sentence.length <= maxChunkChars) {
        sentenceBuffer = sentence;
      } else {
        // Phrase elle-même trop longue (texte sans ponctuation) : découpe brute
        // par tranches de maxChunkChars, sans couper un mot en deux si possible.
        let rest = sentence;
        while (rest.length > maxChunkChars) {
          let cut = rest.lastIndexOf(' ', maxChunkChars);
          if (cut <= 0) cut = maxChunkChars;
          chunks.push(rest.slice(0, cut).trim());
          rest = rest.slice(cut).trim();
        }
        sentenceBuffer = rest;
      }
    }
    if (sentenceBuffer) current = sentenceBuffer;
  }

  flush();
  return chunks;
}

module.exports = { chunkText };
