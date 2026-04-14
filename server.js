const express = require('express');
const { Pool } = require('pg');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const cors = require('cors');
app.use(cors({ origin: 'my-community-8a9k.onrender.com' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(express.json());
app.use(express.static('public'));

// 게시글 목록 가져오기
app.get('/api/posts', async (req, res) => {
  const result = await pool.query('SELECT * FROM posts ORDER BY id DESC');
  res.json(result.rows);
});

// 게시글 상세보기
app.get('/api/get-post/:id', async (req, res) => {
  const result = await pool.query('SELECT * FROM posts WHERE id = $1', [req.params.id]);
  res.json(result.rows[0]);
});

// 게시글 작성
app.post('/api/posts', async (req, res) => {
  const { title, content } = req.body;
  await pool.query('INSERT INTO posts (title, content) VALUES ($1, $2)', [title, content]);
  io.emit('update');
  res.sendStatus(200);
});

// 댓글 가져오기
app.get('/api/comments/:postId', async (req, res) => {
  const result = await pool.query('SELECT * FROM comments WHERE post_id = $1 ORDER BY id ASC', [req.params.postId]);
  res.json(result.rows);
});

// 댓글 작성 (비밀번호 검증 로직 포함)
app.post('/api/comments', async (req, res) => {
  const { post_id, author, content, password } = req.body;
  try {
    // 1. 해당 닉네임의 기존 비밀번호 확인
    const check = await pool.query(
      'SELECT password FROM comments WHERE author = $1 ORDER BY id DESC LIMIT 1',
      [author]
    );

    // 2. 닉네임 주인이 맞는지 검사
    if (check.rows.length > 0 && check.rows[0].password) {
      if (check.rows[0].password !== password) {
        return res.status(403).send("비밀번호 불일치");
      }
    }

    // 3. 통과 시 저장
    await pool.query(
      'INSERT INTO comments (post_id, author, content, password) VALUES ($1, $2, $3, $4)',
      [post_id, author, content, password]
    );
    io.emit('update-comments');
    res.sendStatus(200);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
