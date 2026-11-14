// Fills an empty database with demo users and articles: `npm run seed`.
// Every demo account uses the password "password123".
import bcrypt from 'bcryptjs';
import { pool } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { createArticle } from '../src/articles.service.js';

await runMigrations();

const existing = await pool.query('SELECT count(*)::int AS n FROM users');
if (existing.rows[0].n > 0) {
  console.log('Database already has users; skipping seed.');
  await pool.end();
  process.exit(0);
}

const hash = await bcrypt.hash('password123', 10);
const users = {};
for (const [username, bio] of [
  ['meera', 'Backend engineer. Writes about databases.'],
  ['kabir', 'Frontend developer and occasional illustrator.'],
  ['ananya', 'Learning systems programming in public.'],
  ['dev', 'Notes from running things in production.'],
  ['zoya', 'Second-year student. Algorithms and interviews.'],
]) {
  const { rows } = await pool.query(
    'INSERT INTO users (username, email, password_hash, bio) VALUES ($1, $2, $3, $4) RETURNING id',
    [username, `${username}@example.com`, hash, bio],
  );
  users[username] = rows[0].id;
}

// [author, title, summary, tags, body]. Listed oldest first.
const posts = [
  ['zoya', 'Big O without the fear', 'What the notation is really counting.', ['algorithms'],
    'Big O describes how the work grows as the input grows. It ignores constants on purpose.\n\n- `O(1)`: the same work for any input\n- `O(log n)`: halve the problem each step\n- `O(n)`: touch everything once\n- `O(n log n)`: a good sort\n- `O(n²)`: every pair'],
  ['ananya', 'What happens when you type a URL', 'DNS, TCP, TLS and HTTP, in the order they happen.', ['networking', 'http'],
    '1. **DNS** turns the name into an address.\n2. **TCP** opens a reliable connection.\n3. **TLS** agrees on keys and proves who the server is.\n4. **HTTP** finally sends the request.\n\nEach step exists because the one before it cannot do that job.'],
  ['dev', 'Logs you will thank yourself for', 'Write log lines for the person debugging at 3am.', ['backend', 'operations'],
    'A good log line answers three questions: what happened, to which thing, and why it matters.\n\nInclude an id you can search for. Never log passwords or tokens.'],
  ['kabir', 'Flexbox or grid?', 'A rule of thumb that holds up most of the time.', ['css', 'frontend'],
    'Use **flexbox** when the content decides the layout: a row of buttons, a nav bar.\n\nUse **grid** when the layout decides where content goes: a page with a margin column and a main column.'],
  ['meera', 'Primary keys: serial or UUID?', 'The trade-offs, stated plainly.', ['postgres', 'databases'],
    'A serial integer is small, ordered and fast to index. A UUID can be created anywhere without asking the database and does not leak how many rows you have.\n\nInkwell uses serial ids internally and random slugs in URLs.'],
  ['zoya', 'Two pointers, one idea', 'A pattern that turns many O(n²) loops into O(n).', ['algorithms', 'interviews'],
    'Keep two indexes into a sorted array and move one of them based on a comparison. Because each index only moves forward, the whole thing is linear.'],
  ['ananya', 'Processes and threads', 'What the operating system gives you, and what it costs.', ['operating-systems'],
    'A process has its own memory. Threads share memory inside one process, which makes them cheap to create and easy to get wrong.\n\nNode.js runs your JavaScript on one thread and hands slow work to the system.'],
  ['dev', 'Environment variables are configuration', 'Keep secrets out of the repository.', ['backend', 'security'],
    'Anything that changes between your laptop and production belongs in the environment: database URL, JWT secret, allowed origin.\n\nCommit a `.env.example`, never the real `.env`.'],
  ['kabir', 'useEffect is for synchronising', 'Not for "run this after render".', ['react', 'frontend'],
    'An effect keeps something outside React in step with your state: a subscription, a socket, a document title.\n\nReturn a cleanup function. If you cannot say what the effect synchronises with, you may not need it.'],
  ['meera', 'Why your query is slow: a first look at indexes', 'What an index is, and when PostgreSQL decides to use one.', ['postgres', 'databases'],
    'An index is a **sorted lookup structure**. Without one, the database reads every row.\n\n## The idea\n\nThink of the index at the back of a book: you find the word, then jump to the page.\n\n```sql\nCREATE INDEX articles_author_idx ON articles (author_id);\n```\n\n> Measure first. `EXPLAIN ANALYZE` tells you what the planner really did.'],
  ['zoya', 'Hash maps from scratch', 'Buckets, collisions and why lookups are usually O(1).', ['algorithms', 'data-structures'],
    'A hash function turns a key into a bucket number. Two keys can land in the same bucket, so each bucket holds a short list.\n\nWhen the table gets too full it grows and every key is placed again.'],
  ['ananya', 'The event loop, drawn on paper', 'One thread, a queue, and a rule about when to take from it.', ['javascript', 'nodejs'],
    'JavaScript runs one thing at a time. When the stack is empty, the loop takes the next callback from the queue.\n\nThat is why a synchronous wait freezes everything: the stack never empties, so nothing else can run.'],
  ['dev', 'Rate limiting in one page', 'Protect login endpoints from guessing.', ['backend', 'security'],
    'Count requests per client per time window, and refuse when the count is too high.\n\nFor a login form, 20 tries in 15 minutes stops password guessing without bothering real users.'],
  ['kabir', 'Lifting state up, and when to stop', 'Where should a piece of React state live?', ['react', 'frontend'],
    'Keep state **as low as possible**, and lift it only when two components need the same value.\n\nWhen many distant components need it (like the signed-in user), reach for Context.'],
  ['meera', 'Transactions in plain words', 'All or nothing: what BEGIN and COMMIT actually promise.', ['postgres', 'backend'],
    'A transaction groups several statements so they **all succeed or all fail**.\n\n1. `BEGIN`\n2. do the work\n3. `COMMIT` (or `ROLLBACK` if anything went wrong)\n\nInkwell uses one when saving an article together with its tags.'],
  ['zoya', 'Recursion is a stack you did not write', 'Every recursive call waits on the one below it.', ['algorithms'],
    'Each call is pushed on the call stack and waits for the next to return. A base case is what lets the stack unwind.\n\nIf you can write it recursively, you can write it with your own stack.'],
  ['ananya', 'Reading a stack trace', 'Start from the top line you wrote.', ['debugging'],
    'The first line is the error. Below it is the path the program took. Skip the lines inside libraries and find the first file that is yours.'],
  ['dev', 'What CI is for', 'A machine that runs your tests so you cannot forget.', ['testing', 'operations'],
    'Continuous integration runs the same checks on every push: install, test, build.\n\nIts value is that it is boring and always on. A red build stops a broken change before anyone else pulls it.'],
  ['kabir', 'Accessible forms in five rules', 'Labels, focus, errors, order and names.', ['accessibility', 'frontend'],
    '1. Every input has a real `<label>`.\n2. Focus is always visible.\n3. Errors say what is wrong and are announced.\n4. Tab order follows reading order.\n5. Buttons say what they do.'],
  ['meera', 'Many-to-many needs a third table', 'Why favorites and follows are tables of pairs.', ['databases', 'postgres'],
    'A user favorites many articles; an article is favorited by many users. Neither side can hold a single foreign key.\n\nA junction table stores one row per pair, and a composite primary key stops duplicates.'],
  ['zoya', 'Binary search and its off-by-one', 'Decide what your bounds mean, then never break it.', ['algorithms', 'interviews'],
    'Pick an invariant, for example "the answer is in `[lo, hi)`". Every update must keep it true. Most bugs come from mixing two conventions.'],
  ['ananya', 'WebSockets next to HTTP', 'When the server needs to speak first.', ['networking', 'realtime'],
    'HTTP is a question and an answer. A WebSocket is a line that stays open, so the server can send something the moment it happens.\n\nUse it for live comments and notifications. Keep the database as the source of truth.'],
  ['dev', 'Migrations are version control for your schema', 'Small numbered files, applied once, in order.', ['databases', 'operations'],
    'Each change to the schema is a file. A table records which files have run. Everyone, including production, ends up with the same schema by running the same files.'],
  ['kabir', 'Controlled inputs in React', 'Why the input value comes from state.', ['react'],
    'In a controlled input, React state is the single source of truth: `value={form.title}` and `onChange` updates the state.'],
  ['meera', 'Full-text search without a search engine', 'tsvector, a GIN index, and ranking.', ['postgres', 'search'],
    'PostgreSQL can turn text into a list of word stems (`tsvector`) and index it with GIN, an inverted index.\n\n`ts_rank` orders results; weights let a title match beat a body match.'],
  ['zoya', 'Graphs: BFS first', 'Shortest path in an unweighted graph, with a queue.', ['algorithms', 'data-structures'],
    'Breadth-first search visits nodes in order of distance. Use a queue and a visited set. The first time you reach a node is the shortest way to it.'],
  ['ananya', 'A gentle introduction to JWT', 'What is inside a JSON Web Token, and what is not.', ['auth', 'backend'],
    'A JWT has three parts: header, payload and signature.\n\nThe payload is only *encoded*, not encrypted, so never put secrets in it. The signature is what stops anyone from changing the payload.'],
  ['dev', 'REST status codes you will actually use', '200, 201, 204, 400, 401, 403, 404, 409, 422.', ['backend', 'http'],
    '- **401** means "I do not know who you are".\n- **403** means "I know who you are, and you may not do this".\n- **409** means the request conflicts with existing data, such as a duplicate email.\n- **422** means the JSON was valid but the values were not.'],
  ['kabir', 'CSS custom properties as design tokens', 'Name the decision once, use it everywhere.', ['css', 'frontend'],
    'Put colours and sizes in variables on `:root`. A media query can then change one variable and the whole layout follows.\n\nInkwell narrows its margin column on phones by changing a single `--gutter` value.'],
  ['meera', 'The N+1 query problem', 'One query for the list, then one more per row.', ['databases', 'performance'],
    'Loading 10 articles and then asking for each author separately costs 11 queries.\n\nJoin or use subqueries so the database returns everything in one round trip.'],
  ['zoya', 'What I learned from failing a coding round', 'Say what you are thinking, out loud, the whole time.', ['interviews'],
    'I solved the problem in my head and typed in silence. The interviewer could not tell a wrong turn from a plan.\n\nNow I state the brute force first, then improve it while talking.'],
  ['ananya', 'Spring physics for interfaces', 'Stiffness, damping, and why it feels alive.', ['animation', 'frontend'],
    'A spring pulls a value toward its target with a force proportional to the distance, while damping resists speed.\n\nStep it several times per frame and the motion stays smooth at any frame rate.'],
];

for (const [author, title, description, tags, body] of posts) {
  await createArticle(users[author], { title, description, body, tagList: tags });
}

// Spread the publication dates over the past month, newest last in the list
// above, so the feed and the trending list have something to order.
await pool.query(`
  UPDATE articles a SET created_at = now() - (interval '22 hours' * r.n), updated_at = now() - (interval '22 hours' * r.n)
  FROM (SELECT id, (count(*) OVER ()) - row_number() OVER (ORDER BY id) AS n FROM articles) r
  WHERE a.id = r.id`);

const follow = (a, b) => pool.query('INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2)', [users[a], users[b]]);
await follow('kabir', 'meera');
await follow('zoya', 'meera');
await follow('ananya', 'dev');

console.log(`Seeded ${Object.keys(users).length} users and ${posts.length} articles. Sign in as meera@example.com / password123`);
await pool.end();
