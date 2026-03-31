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

// 메인 페이지(목록)
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// 상세 페이지(읽기) - 어떤 번호로 들어와도 index.html을 보내고 프론트에서 처리
app.get('/post/:id', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// API: 게시글 목록
app.get('/api/posts', async (req, res) => {
  const result = await pool.query('SELECT id, author, title, likes, dislikes, created_at FROM posts ORDER BY id DESC');
  res.json(result.rows);
});

// API: 게시글 상세 내용
app.get('/api/posts/:id', async (req, res) => {
  const result = await pool.query('SELECT * FROM posts WHERE id = $1', [req.params.id]);
  res.json(result.rows[0]);
});

// API: 게시글 저장
app.post('/api/posts', async (req, res) => {
  const { author, password, title, content } = req.body;
  const result = await pool.query(
    'INSERT INTO posts (author, password, title, content) VALUES ($1, $2, $3, $4) RETURNING *',
    [author, password, title, content]
  );
  io.emit('new post'); // 목록 업데이트 신호
  res.json(result.rows[0]);
});

// API: 좋아요/싫어요
app.post('/api/posts/:id/vote', async (req, res) => {
  const { type } = req.body; // 'likes' 또는 'dislikes'
  const column = type === 'up' ? 'likes' : 'dislikes';
  const result = await pool.query(`UPDATE posts SET ${column} = ${column} + 1 WHERE id = $1 RETURNING *`, [req.params.id]);
  res.json(result.rows[0]);
});

// API: 댓글 목록 & 저장
app.get('/api/comments/:postId', async (req, res) => {
  const result = await pool.query('SELECT * FROM comments WHERE post_id = $1 ORDER BY id ASC', [req.params.postId]);
  res.json(result.rows);
});
app.post('/api/comments', async (req, res) => {
  const { post_id, author, content } = req.body;
  const result = await pool.query('INSERT INTO comments (post_id, author, content) VALUES ($1, $2, $3) RETURNING *', [post_id, author, content]);
  res.json(result.rows[0]);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
