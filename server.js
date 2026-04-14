const express = require('express');
const { Pool } = require('pg');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// DB 연결 설정
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(express.json());
app.use(express.static('public'));

// 1. 게시글 목록 가져오기
app.get('/api/posts', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM posts ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 2. 게시글 상세보기
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
  const { title, content, author } = req.body;
  try {
    await pool.query(
      'INSERT INTO posts (title, content, author) VALUES ($1, $2, $3)', 
      [title, content, author || '익명']
    );
    io.emit('update');
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  }
});

// 4. 댓글 목록 가져오기
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

// 5. 댓글 작성 (비밀번호 확인 로직 포함)
app.post('/api/comments', async (req, res) => {
  const { post_id, author, content, password } = req.body;
  try {
    const check = await pool.query(
      'SELECT password FROM comments WHERE author = $1 ORDER BY id DESC LIMIT 1', 
      [author]
    );

    if (check.rows.length > 0 && check.rows[0].password) {
      if (check.rows[0].password !== password) {
        return res.status(403).send("비밀번호 불일치");
      }
    }

    await pool.query(
      'INSERT INTO comments (post_id, author, content, password) VALUES ($1, $2, $3, $4)',
      [post_id, author || '익명', content, password]
    );
    io.emit('update-comments');
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  }
});

// 서버 실행
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
