import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Markdown from 'react-markdown';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { socket } from '../realtime.jsx';
import { FavoriteButton, FollowButton, FormErrors, MarginNote, TagList, PageNote } from '../components/bits.jsx';

// The person who posts a comment receives it twice: in the HTTP response and
// as a WebSocket event. Whichever arrives second is ignored. A comment added
// this way is marked `wet`, so it is drawn in wet ink and dries (see styles.css).
const addOnce = (list, comment) =>
  list.some((c) => c.id === comment.id) ? list : [{ ...comment, wet: true }, ...list];

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
  }, [slug, user?.username]);

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

  if (missing) return <PageNote>This article does not exist. It may have been deleted.</PageNote>;
  if (!article) return <PageNote>Loading…</PageNote>;

  const isAuthor = user?.username === article.author.username;

  async function remove() {
    if (!window.confirm('Delete this article? This cannot be undone.')) return;
    await api(`/articles/${slug}`, { method: 'DELETE' });
    navigate('/');
  }

  async function removeComment(id) {
    await api(`/articles/${slug}/comments/${id}`, { method: 'DELETE' });
    setComments((list) => list.filter((c) => c.id !== id));
  }

  return (
    <>
      <header className="row title-block ruled">
        <MarginNote author={article.author} date={article.createdAt} />
        <div className="measure">
          <h1>{article.title}</h1>
          <p className="lede">{article.description}</p>
          <div className="actions">
            <FavoriteButton article={article} onChange={setArticle} withLabel />
            {isAuthor ? (
              <>
                <Link to={`/editor/${slug}`}>Edit</Link>
                <button type="button" className="text-button danger" onClick={remove}>Delete</button>
              </>
            ) : (
              <FollowButton profile={article.author} onChange={(profile) => setArticle({ ...article, author: profile })} />
            )}
          </div>
        </div>
      </header>

      <div className="row ruled">
        <div className="note" />
        <div className="measure">
          {/* react-markdown renders Markdown to React elements and ignores raw
              HTML, so a body containing <script> cannot run (XSS protection). */}
          <div className="prose"><Markdown>{article.body}</Markdown></div>
          {article.tagList.length > 0 && <div style={{ paddingBottom: '1.5rem' }}><TagList tags={article.tagList} /></div>}
        </div>
      </div>

      <section aria-label="Comments">
        <div className="row comments-head">
          <div className="note" />
          <h2>{comments.length === 1 ? '1 comment' : `${comments.length} comments`}</h2>
        </div>

        {user ? (
          <CommentForm slug={slug} onAdded={(comment) => setComments((list) => addOnce(list, comment))} />
        ) : (
          <div className="row ruled">
            <div className="note" />
            <p className="empty"><Link to="/login">Sign in</Link> to write a comment.</p>
          </div>
        )}

        {comments.map((comment) => (
          <div className={`row comment ruled ${comment.wet ? 'is-wet' : ''}`} key={comment.id}>
            <MarginNote author={comment.author} date={comment.createdAt} />
            <div className="measure">
              <p>{comment.body}</p>
              {user?.username === comment.author.username && (
                <button type="button" className="text-button danger pencil" onClick={() => removeComment(comment.id)}>Delete</button>
              )}
            </div>
          </div>
        ))}
      </section>
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
      const { comment } = await api(`/articles/${slug}/comments`, { method: 'POST', body: { comment: { body } } });
      onAdded(comment);
      setBody('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="ruled" style={{ paddingBottom: '1.25rem' }}>
      <FormErrors error={error} />
      <div className="row field wide">
        <label htmlFor="comment">Your comment</label>
        <div>
          <textarea id="comment" className="ruled-paper" rows={3} value={body} onChange={(e) => setBody(e.target.value)} required />
          <div className="form-end"><button className="button" disabled={busy}>Post comment</button></div>
        </div>
      </div>
    </form>
  );
}
