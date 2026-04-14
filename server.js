const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const cors = require('cors');
app.use(cors()); // 모든 도메인 허용 (테스트용)
// 또는 특정 도메인만 허용
// app.use(cors({ origin: 'my-community-8a9k.onrender.com' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(express.static(__dirname));
app.use(express.json());

// 메인 및 게시글 상세 주소 처리
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/post/:id', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// API: 목록 (번호 안 쓰고 id로만 식별)
app.get('/api/posts', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, author, title, likes, created_at FROM posts ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) { res.status(500).json([]); }
});

// API: 상세 내용
app.get('/api/get-post/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM posts WHERE id = $1', [req.params.id]);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).send("Error"); }
});

// API: 글 저장
app.post('/api/posts', async (req, res) => {
  try {
    const { author, password, title, content } = req.body;
    await pool.query('INSERT INTO posts (author, password, title, content) VALUES ($1, $2, $3, $4)', [author || '익명', password, title, content]);
    io.emit('update');
    res.sendStatus(200);
  } catch (err) { res.status(500).send(err.message); }
});

// API: 추천/비추천
app.post('/api/vote/:id', async (req, res) => {
  try {
    const column = req.body.type === 'up' ? 'likes' : 'dislikes';
    const result = await pool.query(`UPDATE posts SET ${column} = ${column} + 1 WHERE id = $1 RETURNING *`, [req.params.id]);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).send("Error"); }
});

// API: 댓글
app.get('/api/comments/:postId', async (req, res) => {
  const result = await pool.query('SELECT * FROM comments WHERE post_id = $1 ORDER BY id ASC', [req.params.postId]);
  res.json(result.rows);
});
app.post('/api/comments', async (req, res) => {
  const { post_id, author, content } = req.body;
  await pool.query('INSERT INTO comments (post_id, author, content) VALUES ($1, $2, $3)', [post_id, author || '익명', content]);
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server is running!'));
