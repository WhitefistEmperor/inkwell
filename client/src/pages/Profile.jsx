import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import ArticleList from '../components/ArticleList.jsx';
import { Avatar, FollowButton } from '../components/bits.jsx';

export default function Profile() {
  const { username } = useParams();
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState('written');

  useEffect(() => {
    setProfile(null);
    setMissing(false);
    setTab('written');
    api(`/profiles/${username}`)
      .then((data) => setProfile(data.profile))
      .catch(() => setMissing(true));
  }, [username, user?.id]);

  if (missing) return <p className="muted center">No user called “{username}”.</p>;
  if (!profile) return <p className="muted center">Loading…</p>;

  const isMe = user?.username === profile.username;

  return (
    <>
      <section className="profile-head">
        <div className="wrap medium">
          <Avatar user={profile} size={88} />
          <h1>{profile.username}</h1>
          {profile.bio && <p>{profile.bio}</p>}
          {isMe ? <Link to="/settings" className="pill">Edit profile</Link> : <FollowButton profile={profile} onChange={setProfile} />}
        </div>
      </section>

      <div className="wrap medium">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'written'} className={tab === 'written' ? 'active' : ''} onClick={() => setTab('written')}>
            Articles
          </button>
          <button role="tab" aria-selected={tab === 'favorites'} className={tab === 'favorites' ? 'active' : ''} onClick={() => setTab('favorites')}>
            Favorites
          </button>
        </div>
        <ArticleList
          filters={tab === 'written' ? { author: profile.username } : { favorited: profile.username }}
          emptyText={tab === 'written' ? 'Nothing published yet.' : 'No favorites yet.'}
        />
      </div>
    </>
  );
}
