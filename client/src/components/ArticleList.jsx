// A paginated list of articles. The same component powers the latest list,
// the personal feed, tag and search results and both profile tabs: the parent
// only passes different `filters`.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, toQuery } from '../api.js';
import { FavoriteButton, MarginNote, PageNote as Note, TagList } from './bits.jsx';

const PAGE_SIZE = 5;

// The server marks matched words as [[word]]. Splitting on the markers gives
// alternating plain / matched pieces, which are rendered as text and <mark>.
// No HTML from the article body is ever injected, so this cannot cause XSS.
function Snippet({ text }) {
  return (
    <p className="snippet">
      …{text.split(/\[\[|\]\]/).map((piece, i) => (i % 2 ? <mark key={i}>{piece}</mark> : piece))}…
    </p>
  );
}

export default function ArticleList({ filters, emptyText = 'Nothing has been written here yet.' }) {
  const [page, setPage] = useState(0);
  const [state, setState] = useState({ status: 'loading', articles: [], articlesCount: 0 });

  // A string version of the filters, so the effect below re-runs only when
  // the filters really change (objects are re-created on every render).
  const filterKey = JSON.stringify(filters);

  // Changing the filter goes back to the first page.
  useEffect(() => setPage(0), [filterKey]);

  useEffect(() => {
    let cancelled = false; // ignore a slow response that arrives after a newer request
    const { feed, ...rest } = JSON.parse(filterKey);
    const path = (feed ? '/articles/feed' : '/articles') + toQuery({ ...rest, limit: PAGE_SIZE, offset: page * PAGE_SIZE });

    setState((s) => ({ ...s, status: 'loading' }));
    api(path)
      .then((data) => !cancelled && setState({ status: 'ready', ...data }))
      .catch(() => !cancelled && setState({ status: 'error', articles: [], articlesCount: 0 }));
    return () => {
      cancelled = true;
    };
  }, [filterKey, page]);

  // After a favorite toggle, swap in the server's updated copy of that one article.
  // (The list response has no body or snippet, so keep the fields we already have.)
  const replace = (updated) =>
    setState((s) => ({ ...s, articles: s.articles.map((a) => (a.slug === updated.slug ? { ...a, ...updated } : a)) }));

  if (state.status === 'error') return <Note>The articles could not be loaded. Check that the API is running, then reload.</Note>;
  if (state.status === 'loading' && !state.articles.length) return <Note>Loading…</Note>;
  if (!state.articles.length) return <Note>{emptyText}</Note>;

  const pageCount = Math.ceil(state.articlesCount / PAGE_SIZE);

  return (
    <div className={state.status === 'loading' ? 'is-loading' : ''}>
      {state.articles.map((article) => (
        <article className="row entry ruled" key={article.slug}>
          <MarginNote author={article.author} date={article.createdAt} />
          <div className="measure">
            <h2><Link to={`/article/${article.slug}`}>{article.title}</Link></h2>
            <p className="summary">{article.description}</p>
            {article.snippet && <Snippet text={article.snippet} />}
            <div className="foot">
              <FavoriteButton article={article} onChange={replace} />
              <TagList tags={article.tagList} />
            </div>
          </div>
        </article>
      ))}

      {pageCount > 1 && (
        <div className="row">
          <div className="note" />
          <nav className="pages" aria-label="Pages">
            <span>Page</span>
            {Array.from({ length: pageCount }, (_, i) => (
              <button key={i} type="button" className={i === page ? 'current' : ''} aria-current={i === page ? 'page' : undefined} onClick={() => setPage(i)}>
                {i + 1}
              </button>
            ))}
          </nav>
        </div>
      )}
    </div>
  );
}
