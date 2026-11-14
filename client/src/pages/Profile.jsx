import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import ArticleList from '../components/ArticleList.jsx';
import { Avatar, FollowButton, PageNote } from '../components/bits.jsx';

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
  }, [username, user?.username]);

  if (missing) return <PageNote>Nobody here is called “{username}”.</PageNote>;
  if (!profile) return <PageNote>Loading…</PageNote>;

  const isMe = user?.username === profile.username;

  return (
    <>
      <header className="row person">
        <div className="note"><Avatar user={profile} size={72} /></div>
        <div>
          <h1>{profile.username}</h1>
          {profile.bio && <p className="bio">{profile.bio}</p>}
          <div className="actions">
            {isMe ? <Link to="/settings">Edit profile</Link> : <FollowButton profile={profile} onChange={setProfile} />}
          </div>
        </div>
      </header>

      <div className="row ruled">
        <div className="note" />
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'written'} className={tab === 'written' ? 'active' : ''} onClick={() => setTab('written')}>
            Articles
          </button>
          <button role="tab" aria-selected={tab === 'favorites'} className={tab === 'favorites' ? 'active' : ''} onClick={() => setTab('favorites')}>
            Favorites
          </button>
        </div>
      </div>
      <ArticleList
        filters={tab === 'written' ? { author: profile.username } : { favorited: profile.username }}
        emptyText={tab === 'written' ? `${profile.username} has not published anything yet.` : `${profile.username} has not favorited anything yet.`}
      />
    </>
  );
}
