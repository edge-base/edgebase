import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Head from '@docusaurus/Head';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import { translate } from '@docusaurus/Translate';
import { usePluralForm } from '@docusaurus/theme-common';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import clsx from 'clsx';
import { fetchIndexesByWorker, searchByWorker } from '../search-local/devSearchByWorker';
import {
  concatDocumentPath,
  highlight,
  highlightStemmed,
  getStemmedPositions,
  LoadingRing,
  Mark,
  normalizeContextByPath,
  searchContextByPaths,
  SearchDocumentType,
  useAllContextsWithNoSearchContext,
  useSearchQuery,
} from '../search-local/deps';
import styles from '@easyops-cn/docusaurus-search-local/dist/client/client/theme/SearchPage/SearchPage.module.css';

export default function SearchPage() {
  return (
    <Layout>
      <SearchPageContent />
    </Layout>
  );
}

function SearchPageContent() {
  const {
    siteConfig: { baseUrl },
    i18n: { currentLocale },
  } = useDocusaurusContext();
  const { selectMessage } = usePluralForm();
  const {
    searchValue,
    searchContext,
    searchVersion,
    updateSearchPath,
    updateSearchContext,
  } = useSearchQuery();
  const [searchQuery, setSearchQuery] = useState(searchValue);
  const [searchResults, setSearchResults] = useState();
  const versionUrl = `${baseUrl}${searchVersion}`;

  const pageTitle = useMemo(
    () =>
      searchQuery
        ? translate(
            {
              id: 'theme.SearchPage.existingResultsTitle',
              message: 'Search results for "{query}"',
            },
            { query: searchQuery },
          )
        : translate({
            id: 'theme.SearchPage.emptyResultsTitle',
            message: 'Search the documentation',
          }),
    [searchQuery],
  );

  useEffect(() => {
    updateSearchPath(searchQuery);
    if (searchQuery) {
      (async () => {
        const results = await searchByWorker(versionUrl, searchContext, searchQuery, 100);
        setSearchResults(results);
      })();
    } else {
      setSearchResults(undefined);
    }
  }, [searchQuery, versionUrl, searchContext]);

  const handleSearchInputChange = useCallback((event) => {
    setSearchQuery(event.target.value);
  }, []);

  useEffect(() => {
    if (searchValue && searchValue !== searchQuery) {
      setSearchQuery(searchValue);
    }
  }, [searchValue, searchQuery]);

  const [searchWorkerReady, setSearchWorkerReady] = useState(false);

  useEffect(() => {
    async function doFetchIndexes() {
      if (
        !Array.isArray(searchContextByPaths) ||
        searchContext ||
        useAllContextsWithNoSearchContext
      ) {
        await fetchIndexesByWorker(versionUrl, searchContext);
      }
      setSearchWorkerReady(true);
    }
    doFetchIndexes();
  }, [searchContext, versionUrl]);

  return (
    <>
      <Head>
        <meta property="robots" content="noindex, follow" />
        <title>{pageTitle}</title>
      </Head>

      <div className="container margin-vert--lg">
        <h1>{pageTitle}</h1>

        <div className="row">
          <div
            className={clsx('col', {
              [styles.searchQueryColumn]: Array.isArray(searchContextByPaths),
              'col--9': Array.isArray(searchContextByPaths),
              'col--12': !Array.isArray(searchContextByPaths),
            })}
          >
            <input
              type="search"
              name="q"
              className={styles.searchQueryInput}
              aria-label="Search"
              onChange={handleSearchInputChange}
              value={searchQuery}
              autoComplete="off"
              autoFocus
            />
          </div>
          {Array.isArray(searchContextByPaths) ? (
            <div className={clsx('col', 'col--3', 'padding-left--none', styles.searchContextColumn)}>
              <select
                name="search-context"
                className={styles.searchContextInput}
                id="context-selector"
                value={searchContext}
                onChange={(event) => updateSearchContext(event.target.value)}
              >
                {useAllContextsWithNoSearchContext ? (
                  <option value="">
                    {translate({
                      id: 'theme.SearchPage.searchContext.everywhere',
                      message: 'Everywhere',
                    })}
                  </option>
                ) : null}
                {searchContextByPaths.map((context) => {
                  const { label, path } = normalizeContextByPath(context, currentLocale);
                  return (
                    <option key={path} value={path}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </div>
          ) : null}
        </div>

        {!searchWorkerReady && searchQuery ? (
          <div>
            <LoadingRing />
          </div>
        ) : null}

        {searchResults
          ? searchResults.length > 0
            ? (
              <p>
                {selectMessage(
                  searchResults.length,
                  translate(
                    {
                      id: 'theme.SearchPage.documentsFound.plurals',
                      message: '1 document found|{count} documents found',
                    },
                    { count: searchResults.length },
                  ),
                )}
              </p>
              )
            : (
              <p>
                {translate({
                  id: 'theme.SearchPage.noResultsText',
                  message: 'No documents were found',
                })}
              </p>
              )
          : null}

        <section>
          {searchResults
            ? searchResults.map((item) => (
                <SearchResultItem key={item.document.i} searchResult={item} />
              ))
            : null}
        </section>
      </div>
    </>
  );
}

function SearchResultItem({ searchResult: { document, type, page, tokens, metadata } }) {
  const isTitle = type === SearchDocumentType.Title;
  const isKeywords = type === SearchDocumentType.Keywords;
  const isDescription = type === SearchDocumentType.Description;
  const isDescriptionOrKeywords = isDescription || isKeywords;
  const isTitleRelated = isTitle || isDescriptionOrKeywords;
  const isContent = type === SearchDocumentType.Content;
  const pathItems = (isTitle ? document.b : page.b).slice();
  const articleTitle = isContent || isDescriptionOrKeywords ? document.s : document.t;

  if (!isTitleRelated) {
    pathItems.push(page.t);
  }

  let search = '';
  if (Mark && tokens.length > 0) {
    const params = new URLSearchParams();
    for (const token of tokens) {
      params.append('_highlight', token);
    }
    search = `?${params.toString()}`;
  }

  return (
    <article className={styles.searchResultItem}>
      <h2>
        <Link
          to={document.u + search + (document.h || '')}
          dangerouslySetInnerHTML={{
            __html:
              isContent || isDescriptionOrKeywords
                ? highlight(articleTitle, tokens)
                : highlightStemmed(articleTitle, getStemmedPositions(metadata, 't'), tokens, 100),
          }}
        />
      </h2>
      {pathItems.length > 0 ? (
        <p className={styles.searchResultItemPath}>{concatDocumentPath(pathItems)}</p>
      ) : null}
      {isContent || isDescription ? (
        <p
          className={styles.searchResultItemSummary}
          dangerouslySetInnerHTML={{
            __html: highlightStemmed(document.t, getStemmedPositions(metadata, 't'), tokens, 100),
          }}
        />
      ) : null}
    </article>
  );
}
