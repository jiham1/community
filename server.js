const express = require('express');
const { Pool } = require('pg');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(express.json());

app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));
app.get('/post/:id', (req, res) => res.sendFile(__dirname + '/index.html'));

async function checkNickname(author, password) {
  const postCheck = await pool.query(
    'SELECT password FROM posts WHERE author = $1 ORDER BY id ASC LIMIT 1', [author]
  );
  if (postCheck.rows.length > 0) return postCheck.rows[0].password === password;
  const commentCheck = await pool.query(
    'SELECT password FROM comments WHERE author = $1 ORDER BY id ASC LIMIT 1', [author]
  );
  if (commentCheck.rows.length > 0) return commentCheck.rows[0].password === password;
  return true;
}

// 삭제 기준 공식
function deleteThreshold(views) {
  return Math.floor(views * (1 / (views + 7) + 1 / 2)) + 1;
}

// 1. 게시글 목록
app.get('/api/posts', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT posts.*, COUNT(comments.id) AS comment_count
      FROM posts
      LEFT JOIN comments ON comments.post_id = posts.id
      GROUP BY posts.id
      ORDER BY posts.id DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 2. 인기글
app.get('/api/posts/hot', async (req, res) => {
  try {
    const thresholdResult = await pool.query(`
      SELECT PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY (likes - dislikes)) AS threshold
      FROM posts
    `);
    const dynamicThreshold = thresholdResult.rows[0].threshold || 5;
    const threshold = Math.max(5, dynamicThreshold);
    const result = await pool.query(`
      SELECT posts.*, COUNT(comments.id) AS comment_count
      FROM posts
      LEFT JOIN comments ON comments.post_id = posts.id
      WHERE (posts.likes - posts.dislikes) >= $1
      GROUP BY posts.id
      ORDER BY (posts.likes - posts.dislikes) DESC
    `, [threshold]);
    res.json({ posts: result.rows, threshold });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 3. 게시글 상세 (조회수 +1)
app.get('/api/get-post/:id', async (req, res) => {
  try {
    await pool.query('UPDATE posts SET views = views + 1 WHERE id = $1', [req.params.id]);
    const result = await pool.query('SELECT * FROM posts WHERE id = $1', [req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 4. 게시글 작성
app.post('/api/posts', async (req, res) => {
  const { title, content, author, password } = req.body;
  try {
    const ok = await checkNickname(author, password);
    if (!ok) return res.status(403).send("비밀번호 불일치");
    await pool.query(
      'INSERT INTO posts (title, content, author, password) VALUES ($1, $2, $3, $4)',
      [title, content, author || '익명', password]
    );
    io.emit('update');
    res.sendStatus(200);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 5. 추천/비추천
app.post('/api/vote/:id', async (req, res) => {
  const { type } = req.body;
  const col = type === 'up' ? 'likes' : 'dislikes';
  try {
    const result = await pool.query(
      `UPDATE posts SET ${col} = ${col} + 1 WHERE id = $1 RETURNING likes, dislikes`,
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 6. 삭제 투표
app.post('/api/posts/:id/delete-vote', async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE posts SET delete_votes = delete_votes + 1 WHERE id = $1 RETURNING delete_votes, views',
      [req.params.id]
    );
    const { delete_votes, views } = result.rows[0];
    const threshold = deleteThreshold(views);
    if (delete_votes >= threshold) {
      await pool.query('DELETE FROM posts WHERE id = $1', [req.params.id]);
      io.emit('update');
      return res.json({ deleted: true });
    }
    res.json({ deleted: false, delete_votes, threshold });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 7. 댓글 목록 (대댓글 트리)
app.get('/api/comments/:postId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM comments WHERE post_id = $1 ORDER BY id ASC',
      [req.params.postId]
    );
    const all = result.rows;
    const map = {};
    const roots = [];
    all.forEach(c => { map[c.id] = { ...c, replies: [] }; });
    all.forEach(c => {
      if (c.parent_id) {
        if (map[c.parent_id]) map[c.parent_id].replies.push(map[c.id]);
      } else {
        roots.push(map[c.id]);
      }
    });
    res.json(roots);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 8. 댓글/대댓글 작성
app.post('/api/comments', async (req, res) => {
  const { post_id, author, password, content, parent_id } = req.body;
  try {
    const ok = await checkNickname(author, password);
    if (!ok) return res.status(403).send("비밀번호 불일치");
    await pool.query(
      'INSERT INTO comments (post_id, author, content, password, parent_id) VALUES ($1, $2, $3, $4, $5)',
      [post_id, author || '익명', content, password, parent_id || null]
    );
    io.emit('update-comments');
    res.sendStatus(200);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
