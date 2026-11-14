import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Home from './pages/Home.jsx';
import AuthPage from './pages/AuthPage.jsx';
import Editor from './pages/Editor.jsx';
import Article from './pages/Article.jsx';
import Profile from './pages/Profile.jsx';
import Settings from './pages/Settings.jsx';

// Wraps pages that need a signed-in user. This is only for user experience:
// the real protection is on the server, which rejects requests without a token.
function Private({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="muted center">Loading…</p>;
  return user ? children : <Navigate to="/login" replace />;
}

function Header() {
  const { user } = useAuth();
  return (
    <header className="site-header">
      <div className="wrap header-row">
        <Link to="/" className="brand">Inkwell<span>.</span></Link>
        <nav>
          <NavLink to="/" end>Home</NavLink>
          {user ? (
            <>
              <NavLink to="/editor">Write</NavLink>
              <NavLink to="/settings">Settings</NavLink>
              <NavLink to={`/profile/${user.username}`} className="nav-user">{user.username}</NavLink>
            </>
          ) : (
            <>
              <NavLink to="/login">Sign in</NavLink>
              <NavLink to="/register" className="nav-cta">Get started</NavLink>
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
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/register" element={<AuthPage mode="register" />} />
          <Route path="/editor" element={<Private><Editor /></Private>} />
          <Route path="/editor/:slug" element={<Private><Editor /></Private>} />
          <Route path="/settings" element={<Private><Settings /></Private>} />
          <Route path="/article/:slug" element={<Article />} />
          <Route path="/profile/:username" element={<Profile />} />
          <Route path="*" element={<p className="muted center">Page not found.</p>} />
        </Routes>
      </main>
      <footer className="site-footer">Inkwell — built with React, Express and PostgreSQL.</footer>
    </>
  );
}
