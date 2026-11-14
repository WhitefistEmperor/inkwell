// A paginated list of article previews. The same component powers the global
// list, the personal feed, tag pages and both profile tabs: the parent only
// passes different `filters`.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, toQuery } from '../api.js';
import { Byline, FavoriteButton, TagList } from './bits.jsx';

const PAGE_SIZE = 5;

// The server marks matched words as [[word]]. Splitting on the markers gives
// alternating plain / matched pieces, which are rendered as text and <mark>.
// No HTML from the article body is ever injected, so this cannot cause XSS.
function Snippet({ text }) {
  return (
    <p className="snippet">
      … {text.split(/\[\[|\]\]/).map((piece, i) => (i % 2 ? <mark key={i}>{piece}</mark> : piece))} …
    </p>
  );
}

export default function ArticleList({ filters, emptyText = 'No articles here yet.' }) {
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
  const replace = (updated) =>
    setState((s) => ({ ...s, articles: s.articles.map((a) => (a.slug === updated.slug ? updated : a)) }));

  if (state.status === 'error') return <p className="muted">Could not load articles. Is the API running?</p>;
  if (state.status === 'loading' && !state.articles.length) return <p className="muted">Loading articles…</p>;
  if (!state.articles.length) return <p className="muted">{emptyText}</p>;

  const pageCount = Math.ceil(state.articlesCount / PAGE_SIZE);

  return (
    <div className={state.status === 'loading' ? 'is-loading' : ''}>
      {state.articles.map((article) => (
        <article className="preview" key={article.slug}>
          <div className="preview-top">
            <Byline author={article.author} date={article.createdAt} />
            <FavoriteButton article={article} onChange={replace} />
          </div>
          <Link to={`/article/${article.slug}`} className="preview-link">
            <h2>{article.title}</h2>
            <p>{article.description}</p>
            {article.snippet && <Snippet text={article.snippet} />}
          </Link>
          <div className="preview-bottom">
            <Link to={`/article/${article.slug}`} className="read-more">Read more →</Link>
            <TagList tags={article.tagList} />
          </div>
        </article>
      ))}

      {pageCount > 1 && (
        <nav className="pagination" aria-label="Pages">
          {Array.from({ length: pageCount }, (_, i) => (
            <button key={i} type="button" className={i === page ? 'current' : ''} aria-current={i === page ? 'page' : undefined} onClick={() => setPage(i)}>
              {i + 1}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
