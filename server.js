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

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// 글 저장 (content 포함)
app.post('/api/posts', async (req, res) => {
  const { author, password, title, content } = req.body;
  const result = await pool.query(
    'INSERT INTO posts (author, password, title, content) VALUES ($1, $2, $3, $4) RETURNING *',
    [author, password, title, content]
  );
  io.emit('new post', result.rows[0]); // 실시간 전송
  res.json(result.rows[0]);
});

// 댓글 로드
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

// 초기 접속 시 모든 데이터(content 포함) 로드
io.on('connection', async (socket) => {
  const result = await pool.query('SELECT * FROM posts ORDER BY created_at DESC LIMIT 50');
  socket.emit('load posts', result.rows);
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
