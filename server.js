const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(express.static(__dirname));
app.use(express.json());

// 메인 및 상세 페이지 접속 시 무조건 index.html 보냄
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/post/:id', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// [API] 게시글 목록 (번호 제외, 추천수 포함)
app.get('/api/posts', async (req, res) => {
  const result = await pool.query('SELECT id, author, title, likes, created_at FROM posts ORDER BY id DESC');
  res.json(result.rows);
});

// [API] 게시글 상세 내용 (내용이 안 뜨는 문제 해결 핵심)
app.get('/api/get-post/:id', async (req, res) => {
  const result = await pool.query('SELECT * FROM posts WHERE id = $1', [req.params.id]);
  res.json(result.rows[0]);
});

// [API] 글 저장
app.post('/api/posts', async (req, res) => {
  const { author, password, title, content } = req.body;
  await pool.query('INSERT INTO posts (author, password, title, content) VALUES ($1, $2, $3, $4)', [author, password, title, content]);
  io.emit('update'); // 목록 갱신 신호
  res.sendStatus(200);
});

// [API] 추천/비추천
app.post('/api/vote/:id', async (req, res) => {
  const column = req.body.type === 'up' ? 'likes' : 'dislikes';
  const result = await pool.query(`UPDATE posts SET ${column} = ${column} + 1 WHERE id = $1 RETURNING *`, [req.params.id]);
  res.json(result.rows[0]);
});

// [API] 댓글 목록 및 저장
app.get('/api/comments/:postId', async (req, res) => {
  const result = await pool.query('SELECT * FROM comments WHERE post_id = $1 ORDER BY id ASC', [req.params.postId]);
  res.json(result.rows);
});
app.post('/api/comments', async (req, res) => {
  const { post_id, author, content } = req.body;
  await pool.query('INSERT INTO comments (post_id, author, content) VALUES ($1, $2, $3)', [post_id, author, content]);
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
