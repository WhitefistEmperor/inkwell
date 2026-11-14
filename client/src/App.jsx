import { Link, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { useNotifications } from './realtime.jsx';
import { Drop, PageNote } from './components/bits.jsx';
import Home from './pages/Home.jsx';
import AuthPage from './pages/AuthPage.jsx';
import Editor from './pages/Editor.jsx';
import Article from './pages/Article.jsx';
import Profile from './pages/Profile.jsx';
import Settings from './pages/Settings.jsx';
import Notifications from './pages/Notifications.jsx';

// Wraps pages that need a signed-in user. This is only for user experience:
// the real protection is on the server, which rejects requests without a token.
function Private({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <PageNote>Loading…</PageNote>;
  return user ? children : <Navigate to="/login" replace />;
}

function Header() {
  const { user } = useAuth();
  const { unread } = useNotifications();
  const navigate = useNavigate();

  function search(e) {
    e.preventDefault();
    const q = new FormData(e.target).get('q').trim();
    navigate(q ? `/?q=${encodeURIComponent(q)}` : '/');
  }

  return (
    <header className="site-header">
      <div className="header-row">
        <Link to="/" className="brand"><Drop />Inkwell</Link>
        <form className="search" role="search" onSubmit={search}>
          <input name="q" type="search" placeholder="Search articles" aria-label="Search articles" />
        </form>
        <nav>
          {user ? (
            <>
              <NavLink to="/editor">Write</NavLink>
              <NavLink to="/notifications" aria-label={`Notifications, ${unread} unread`}>
                Notifications{unread > 0 && <span className="count">{unread}</span>}
              </NavLink>
              <NavLink to="/settings">Settings</NavLink>
              <NavLink to={`/profile/${user.username}`}>{user.username}</NavLink>
            </>
          ) : (
            <>
              <NavLink to="/login">Sign in</NavLink>
              <NavLink to="/register">Create account</NavLink>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export default function App() {
  return (
    <>
      <Header />
      <main className="sheet">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/register" element={<AuthPage mode="register" />} />
          <Route path="/editor" element={<Private><Editor /></Private>} />
          <Route path="/editor/:slug" element={<Private><Editor /></Private>} />
          <Route path="/settings" element={<Private><Settings /></Private>} />
          <Route path="/notifications" element={<Private><Notifications /></Private>} />
          <Route path="/article/:slug" element={<Article />} />
          <Route path="/profile/:username" element={<Profile />} />
          <Route path="*" element={<PageNote>There is no page at this address.</PageNote>} />
        </Routes>
      </main>
      <footer className="site-footer">Inkwell implements the RealWorld API spec. Built with React, Express and PostgreSQL.</footer>
    </>
  );
}
