import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Markdown from 'react-markdown';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { socket } from '../realtime.jsx';
import { Avatar, Byline, FavoriteButton, FollowButton, FormErrors, TagList, formatDate } from '../components/bits.jsx';

// The person who posts a comment receives it twice: in the HTTP response and
// as a WebSocket event. Whichever arrives second is ignored.
const addOnce = (list, comment) => (list.some((c) => c.id === comment.id) ? list : [comment, ...list]);

export default function Article() {
  const { slug } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [article, setArticle] = useState(null);
  const [comments, setComments] = useState([]);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setArticle(null);
    setMissing(false);
    // The article and its comments are independent, so fetch them in parallel.
    Promise.all([api(`/articles/${slug}`), api(`/articles/${slug}/comments`)])
      .then(([a, c]) => {
        setArticle(a.article);
        setComments(c.comments);
      })
      .catch(() => setMissing(true));
  }, [slug, user?.id]);

  // Live comments: join this article's room and apply events as they arrive.
  useEffect(() => {
    const join = () => socket.emit('article:join', slug);
    const onNew = (comment) => setComments((list) => addOnce(list, comment));
    const onDeleted = ({ id }) => setComments((list) => list.filter((c) => c.id !== id));

    join();
    socket.on('connect', join); // rooms are forgotten on reconnect, so join again
    socket.on('comment:new', onNew);
    socket.on('comment:deleted', onDeleted);
    return () => {
      socket.emit('article:leave', slug);
      socket.off('connect', join);
      socket.off('comment:new', onNew);
      socket.off('comment:deleted', onDeleted);
    };
  }, [slug]);

  if (missing) return <p className="muted center">This article does not exist.</p>;
  if (!article) return <p className="muted center">Loading…</p>;

  const isAuthor = user?.username === article.author.username;

  async function remove() {
    if (!window.confirm('Delete this article permanently?')) return;
    await api(`/articles/${slug}`, { method: 'DELETE' });
    navigate('/');
  }

  async function removeComment(id) {
    await api(`/articles/${slug}/comments/${id}`, { method: 'DELETE' });
    setComments((list) => list.filter((c) => c.id !== id));
  }

  return (
    <>
      <section className="article-head">
        <div className="wrap medium">
          <h1>{article.title}</h1>
          <p className="lede">{article.description}</p>
          <div className="article-meta">
            <Byline author={article.author} date={article.createdAt} />
            <div className="actions">
              {isAuthor ? (
                <>
                  <Link to={`/editor/${slug}`} className="pill">Edit</Link>
                  <button type="button" className="pill pill-danger" onClick={remove}>Delete</button>
                </>
              ) : (
                <FollowButton
                  profile={article.author}
                  onChange={(profile) => setArticle({ ...article, author: profile })}
                />
              )}
              <FavoriteButton article={article} onChange={setArticle} withLabel />
            </div>
          </div>
        </div>
      </section>

      <div className="wrap medium">
        {/* react-markdown renders Markdown to React elements and ignores raw
            HTML, so a body containing <script> cannot run (XSS protection). */}
        <div className="prose"><Markdown>{article.body}</Markdown></div>
        <TagList tags={article.tags} />

        <section className="comments">
          <h2>Comments ({comments.length})</h2>
          {user ? (
            <CommentForm slug={slug} onAdded={(comment) => setComments((list) => addOnce(list, comment))} />
          ) : (
            <p className="muted"><Link to="/login">Sign in</Link> to join the conversation.</p>
          )}
          {comments.map((comment) => (
            <div className="comment" key={comment.id}>
              <p>{comment.body}</p>
              <footer>
                <Avatar user={comment.author} size={22} />
                <Link to={`/profile/${comment.author.username}`}>{comment.author.username}</Link>
                <time dateTime={comment.createdAt}>{formatDate(comment.createdAt)}</time>
                {user?.username === comment.author.username && (
                  <button type="button" className="link-button" onClick={() => removeComment(comment.id)}>Delete</button>
                )}
              </footer>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}

function CommentForm({ slug, onAdded }) {
  const [body, setBody] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { comment } = await api(`/articles/${slug}/comments`, { method: 'POST', body: { body } });
      onAdded(comment);
      setBody('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form comment-form" onSubmit={submit}>
      <FormErrors error={error} />
      <label>
        <span className="sr-only">Your comment</span>
        <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a comment…" required />
      </label>
      <button className="button" disabled={busy}>Post comment</button>
    </form>
  );
}
