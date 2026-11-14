import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import ArticleList from '../components/ArticleList.jsx';

export default function Home() {
  const { user } = useAuth();
  // The selected tab lives in the URL (?tag=sql or ?view=feed), so it
  // survives a refresh and can be shared as a link.
  const [params, setParams] = useSearchParams();
  const tag = params.get('tag');
  const q = params.get('q');
  const view = q ? 'search' : tag ? 'tag' : params.get('view') === 'feed' && user ? 'feed' : 'global';

  const [tags, setTags] = useState([]);
  const [trending, setTrending] = useState([]);
  useEffect(() => {
    api('/tags').then((data) => setTags(data.tags)).catch(() => {});
    api('/articles/trending').then((data) => setTrending(data.articles)).catch(() => {});
  }, []);

  const filters = view === 'search' ? { q } : view === 'tag' ? { tag } : view === 'feed' ? { feed: true } : {};

  return (
    <>
      {!user && (
        <section className="hero">
          <div className="wrap">
            <h1>Ideas worth writing down.</h1>
            <p>Inkwell is a place to publish what you are learning and follow people who do the same.</p>
            <Link to="/register" className="button">Start writing</Link>
          </div>
        </section>
      )}

      <div className="wrap columns">
        <section>
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={view === 'global'} className={view === 'global' ? 'active' : ''} onClick={() => setParams({})}>
              Latest
            </button>
            {user && (
              <button role="tab" aria-selected={view === 'feed'} className={view === 'feed' ? 'active' : ''} onClick={() => setParams({ view: 'feed' })}>
                Following
              </button>
            )}
            {view === 'tag' && <button role="tab" aria-selected="true" className="active">#{tag}</button>}
            {view === 'search' && <button role="tab" aria-selected="true" className="active">Results for “{q}”</button>}
          </div>
          <ArticleList
            filters={filters}
            emptyText={
              view === 'feed' ? 'Follow some writers and their articles will appear here.'
              : view === 'search' ? 'No articles match that search.'
              : 'No articles here yet.'
            }
          />
        </section>

        <aside className="sidebar">
          {trending.length > 0 && (
            <>
              <h3>Trending</h3>
              <ol className="trending">
                {trending.map((article) => (
                  <li key={article.slug}>
                    <Link to={`/article/${article.slug}`}>{article.title}</Link>
                    <span className="muted">{article.author.username} · ♥ {article.favoritesCount}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
          <h3>Popular tags</h3>
          {tags.length ? (
            <ul className="tags">
              {tags.map((name) => (
                <li key={name}><Link to={`/?tag=${encodeURIComponent(name)}`}>#{name}</Link></li>
              ))}
            </ul>
          ) : (
            <p className="muted">No tags yet.</p>
          )}
        </aside>
      </div>
    </>
  );
}
