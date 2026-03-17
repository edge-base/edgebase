import lunr from 'lunr';
import {
  language,
  originalFetchIndexesByWorker,
  originalSearchByWorker,
  processTreeStatusOfSearchResults,
  SearchDocumentType,
  searchIndexUrl,
  smartQueries,
  sortSearchResults,
  tokenize,
} from './deps';

const devIndexCache = new Map();
let didWarnMissingIndex = false;

function normalizeContextPath(searchContext) {
  if (!searchContext) {
    return '';
  }

  return searchContext.endsWith('/') ? searchContext.slice(0, -1) : searchContext;
}

function matchesSearchContext(url, searchContext) {
  if (!searchContext) {
    return true;
  }

  const context = normalizeContextPath(searchContext);
  return (
    url === context ||
    url.startsWith(`${context}/`) ||
    url.startsWith(`${context}?`) ||
    url.startsWith(`${context}#`)
  );
}

async function loadDevIndexes(baseUrl) {
  const cacheKey = baseUrl;
  let promise = devIndexCache.get(cacheKey);
  if (!promise) {
    promise = (async () => {
      const url = `${baseUrl}${searchIndexUrl.replace('{dir}', '')}`;
      const fullUrl = new URL(url, window.location.origin);

      if (fullUrl.origin !== window.location.origin) {
        throw new Error('Unexpected version url');
      }

      const response = await fetch(fullUrl.toString(), { credentials: 'same-origin' });
      if (!response.ok) {
        throw new Error(`Unable to load dev search index: ${response.status} ${response.statusText}`);
      }

      const json = await response.json();
      const wrappedIndexes = json.map(({ documents, index }, type) => ({
        type,
        documents,
        index: lunr.Index.load(index),
      }));
      const zhDictionary = json.reduce((acc, item) => {
        for (const tuple of item.index.invertedIndex) {
          if (/\p{Unified_Ideograph}/u.test(tuple[0][0])) {
            acc.add(tuple[0]);
          }
        }
        return acc;
      }, new Set());

      return {
        wrappedIndexes,
        zhDictionary: Array.from(zhDictionary),
      };
    })();

    devIndexCache.set(cacheKey, promise);
  }

  return promise;
}

function warnMissingIndex(error) {
  if (didWarnMissingIndex) {
    return;
  }

  didWarnMissingIndex = true;
  console.warn(
    '[docs search] Dev search index is missing. Restart the docs dev server so it can rebuild the local search snapshot.',
    error,
  );
}

export async function fetchIndexesByWorker(baseUrl, searchContext) {
  if (process.env.NODE_ENV === 'production') {
    return originalFetchIndexesByWorker(baseUrl, searchContext);
  }

  try {
    await loadDevIndexes(baseUrl);
  } catch (error) {
    warnMissingIndex(error);
  }
}

export async function searchByWorker(baseUrl, searchContext, input, limit) {
  if (process.env.NODE_ENV === 'production') {
    return originalSearchByWorker(baseUrl, searchContext, input, limit);
  }

  try {
    const rawTokens = tokenize(input, language);
    if (rawTokens.length === 0) {
      return [];
    }

    const { wrappedIndexes, zhDictionary } = await loadDevIndexes(baseUrl);
    const queries = smartQueries(rawTokens, zhDictionary);
    const results = [];

    search: for (const { term, tokens } of queries) {
      for (const { documents, index, type } of wrappedIndexes) {
        const matches = index
          .query((query) => {
            for (const item of term) {
              query.term(item.value, {
                wildcard: item.wildcard,
                presence: item.presence,
                ...(item.editDistance ? { editDistance: item.editDistance } : null),
              });
            }
          })
          .slice(0, Math.max(limit * 8, 50))
          .map((result) => {
            const document = documents.find((doc) => doc.i.toString() === result.ref);
            return {
              document,
              type,
              page:
                type !== SearchDocumentType.Title
                  ? wrappedIndexes[0].documents.find((doc) => doc.i === document.p)
                  : undefined,
              metadata: result.matchData.metadata,
              tokens,
              score: result.score,
            };
          })
          .filter((result) => result.document && matchesSearchContext(result.document.u, searchContext))
          .filter((result) => !results.some((item) => item.document.i.toString() === result.document.i.toString()))
          .slice(0, limit - results.length);

        results.push(...matches);
        if (results.length >= limit) {
          break search;
        }
      }
    }

    sortSearchResults(results);
    processTreeStatusOfSearchResults(results);
    return results.slice(0, limit);
  } catch (error) {
    warnMissingIndex(error);
    return [];
  }
}
