import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import ArticleList from '../components/ArticleList.jsx';

export default function Home() {
  const { user } = useAuth();
  // The selected view lives in the URL (?tag=sql, ?q=index or ?view=feed), so
  // it survives a refresh and can be shared as a link.
  const [params, setParams] = useSearchParams();
  const tag = params.get('tag');
  const q = params.get('q');
  const view = q ? 'search' : tag ? 'tag' : params.get('view') === 'feed' && user ? 'feed' : 'latest';

  const [tags, setTags] = useState([]);
  const [trending, setTrending] = useState([]);
  useEffect(() => {
    api('/tags').then((data) => setTags(data.tags.slice(0, 20))).catch(() => {});
    api('/articles/trending').then((data) => setTrending(data.articles)).catch(() => {});
  }, []);

  const filters = view === 'search' ? { q } : view === 'tag' ? { tag } : view === 'feed' ? { feed: true } : {};
  const emptyText =
    view === 'feed' ? 'Nobody you follow has written yet. Follow a writer from their profile and their articles appear here.'
    : view === 'search' ? `Nothing matches “${q}”. Try a different word.`
    : view === 'tag' ? `Nothing is tagged #${tag} yet.`
    : 'Nothing has been written here yet.';

  const tab = (name, label, onClick) => (
    <button role="tab" aria-selected={view === name} className={view === name ? 'active' : ''} onClick={onClick}>{label}</button>
  );

  return (
    <>
      <div className="with-aside">
        <section>
          <div className="row ruled">
            <div className="note" />
            <div className="tabs" role="tablist">
              {tab('latest', 'Latest', () => setParams({}))}
              {user && tab('feed', 'Following', () => setParams({ view: 'feed' }))}
              {view === 'tag' && tab('tag', `#${tag}`)}
              {view === 'search' && tab('search', `Results for “${q}”`)}
            </div>
          </div>
          <ArticleList filters={filters} emptyText={emptyText} />
        </section>

        <aside className="aside">
          {trending.length > 0 && (
            <section>
              <h2>Trending</h2>
              <ol className="ranked">
                {trending.map((article) => (
                  <li key={article.slug}>
                    <div>
                      <Link to={`/article/${article.slug}`}>{article.title}</Link>
                      <small>{article.author.username}, {article.favoritesCount} {article.favoritesCount === 1 ? 'favorite' : 'favorites'}</small>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {tags.length > 0 && (
            <section>
              <h2>Tags</h2>
              <ul className="tags">
                {tags.map((name) => (
                  <li key={name}><Link to={`/?tag=${encodeURIComponent(name)}`}>#{name}</Link></li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
