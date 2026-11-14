// The landing screen signed-out visitors see: a black page, the wordmark, and
// a shelf of 3D books that are the latest articles.
import { Suspense, lazy, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';

// React.lazy splits Three.js into its own file, fetched only when this renders.
const Shelf = lazy(() => import('./Shelf.jsx'));

export default function Cover() {
  const navigate = useNavigate();
  const [articles, setArticles] = useState([]);
  const [tags, setTags] = useState([]);
  const [hovered, setHovered] = useState(null);

  useEffect(() => {
    api('/articles?limit=32').then((data) => setArticles(data.articles)).catch(() => {});
    api('/tags').then((data) => setTags(data.tags.slice(0, 8))).catch(() => {});
  }, []);

  return (
    <section className="cover-hero">
      <h1 className="sr-only">Inkwell, a notebook for what you are learning</h1>
      <p className="cover-word" aria-hidden="true">Inkwell</p>

      <div className="cover-line">
        <p>A notebook for what you are learning.</p>
        {tags.length > 0 && (
          <ul>
            {tags.map((tag) => (
              <li key={tag}><Link to={`/?tag=${encodeURIComponent(tag)}`}>{tag}</Link></li>
            ))}
          </ul>
        )}
      </div>

      {articles.length > 0 && (
        <Suspense fallback={null}>
          <Shelf articles={articles} onHover={setHovered} onOpen={(article) => navigate(`/article/${article.slug}`)} />
        </Suspense>
      )}

      <p className="cover-caption">
        {hovered ? <><strong>{hovered.title}</strong> by {hovered.author.username}</> : 'Every book on the shelf is an article. Pick one up.'}
      </p>
    </section>
  );
}
