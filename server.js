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

// ✅ 닉네임당 비밀번호 확인 함수 (게시글+댓글 통합)
async function checkNickname(author, password) {
  // 게시글에서 먼저 확인
  const postCheck = await pool.query(
    'SELECT password FROM posts WHERE author = $1 ORDER BY id ASC LIMIT 1', [author]
  );
  if (postCheck.rows.length > 0) {
    return postCheck.rows[0].password === password;
  }
  // 댓글에서 확인
  const commentCheck = await pool.query(
    'SELECT password FROM comments WHERE author = $1 ORDER BY id ASC LIMIT 1', [author]
  );
  if (commentCheck.rows.length > 0) {
    return commentCheck.rows[0].password === password;
  }
  return true; // 처음 쓰는 닉네임이면 통과
}

// 1. 게시글 목록
app.get('/api/posts', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM posts ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 2. 게시글 상세
app.get('/api/get-post/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM posts WHERE id = $1', [req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 3. 게시글 작성
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

// 4. 추천/비추천
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

// 5. 댓글 목록
app.get('/api/comments/:postId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM comments WHERE post_id = $1 ORDER BY id ASC',
      [req.params.postId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 6. 댓글 작성
app.post('/api/comments', async (req, res) => {
  const { post_id, author, password, content } = req.body;
  try {
    const ok = await checkNickname(author, password);
    if (!ok) return res.status(403).send("비밀번호 불일치");
    await pool.query(
      'INSERT INTO comments (post_id, author, content, password) VALUES ($1, $2, $3, $4)',
      [post_id, author || '익명', content, password]
    );
    io.emit('update-comments');
    res.sendStatus(200);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
