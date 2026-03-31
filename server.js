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

// 메인 페이지
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// 게시글 저장
app.post('/api/posts', async (req, res) => {
  try {
    const { author, password, title, content } = req.body;
    const result = await pool.query(
      'INSERT INTO posts (author, password, title, content) VALUES ($1, $2, $3, $4) RETURNING *',
      [author, password, title, content]
    );
    io.emit('new post', result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 댓글 목록 가져오기
app.get('/api/comments/:postId', async (req, res) => {
  const result = await pool.query('SELECT * FROM comments WHERE post_id = $1 ORDER BY created_at ASC', [req.params.postId]);
  res.json(result.rows);
});

// 댓글 저장
app.post('/api/comments', async (req, res) => {
  const { post_id, author, content } = req.body;
  const result = await pool.query('INSERT INTO comments (post_id, author, content) VALUES ($1, $2, $3) RETURNING *', [post_id, author, content]);
  io.emit('new comment', result.rows[0]);
  res.json(result.rows[0]);
});

// 초기 데이터 로드
io.on('connection', async (socket) => {
  const result = await pool.query('SELECT * FROM posts ORDER BY created_at DESC LIMIT 50');
  socket.emit('load posts', result.rows);
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on ${PORT}`));
